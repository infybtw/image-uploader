import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { buildUserscript } from "../scripts/build-userscript";
import manifest from "../extension/manifest.json";
import { uploadImage } from "../src/upload";
import { UPLOAD_ENDPOINT } from "../src/shared";
import {
  createUserscriptFetch,
  type UserscriptRequest,
  type UserscriptRequestDetails,
} from "../src/userscript-request";

const image = { name: "pasted-image.png", mimeType: "image/png", base64: "AAEC/w==" };
const success = { data: { link: "http://twir.app/u/AbC12345" } };

describe("Tampermonkey upload transport", () => {
  test("sends an anonymous multipart request and reuses upload response validation", async () => {
    const request = mock((details: UserscriptRequestDetails) => {
      details.onload({
        status: 200,
        responseText: JSON.stringify(success),
        finalUrl: UPLOAD_ENDPOINT,
      });
      return { abort() {} };
    });
    expect(await uploadImage(image, createUserscriptFetch(request))).toBe(
      "https://twir.app/u/AbC12345",
    );
    const [details] = request.mock.calls[0]!;
    expect(details.url).toBe(UPLOAD_ENDPOINT);
    expect(details.method).toBe("POST");
    expect(details.anonymous).toBe(true);
    expect(details.redirect).toBe("error");
    expect(details.headers).toEqual({ Referer: "" });
    expect([...details.data.keys()]).toEqual(["file"]);
    const file = details.data.get("file") as File;
    expect(file.name).toBe("pasted-image.png");
    expect(file.type).toBe("image/png");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0, 1, 2, 255]);
  });

  for (const [status, body, finalUrl, message] of [
    [429, "", UPLOAD_ENDPOINT, "Too many uploads"],
    [200, "invalid", UPLOAD_ENDPOINT, "invalid JSON"],
    [200, '{"data":{"link":"https://evil.com/u/a"}}', UPLOAD_ENDPOINT, "unexpected link"],
    [200, JSON.stringify(success), "https://evil.com/", "redirected"],
  ] as const) {
    test(`rejects ${message}`, async () => {
      const request: UserscriptRequest = (details) => {
        details.onload({ status, responseText: body, finalUrl });
        return { abort() {} };
      };
      await expect(uploadImage(image, createUserscriptFetch(request))).rejects.toThrow(message);
    });
  }

  for (const callback of ["onerror", "onabort", "ontimeout"] as const) {
    test(`handles ${callback}`, async () => {
      const request: UserscriptRequest = (details) => {
        details[callback]();
        return { abort() {} };
      };
      await expect(uploadImage(image, createUserscriptFetch(request))).rejects.toThrow(
        callback === "onerror" ? "could not connect" : "60 seconds",
      );
    });
  }

  test("reports denied permissions and other synchronous Tampermonkey errors", async () => {
    const request: UserscriptRequest = () => {
      throw new Error("Permission denied");
    };
    await expect(uploadImage(image, createUserscriptFetch(request))).rejects.toThrow(
      "Permission denied",
    );
  });

  test("aborts the request when the deadline expires, even without native timeout support", async () => {
    const controller = new AbortController();
    let callbacks: UserscriptRequestDetails;
    const abort = mock(() => callbacks.onabort());
    const request: UserscriptRequest = (details) => {
      callbacks = details;
      return { abort };
    };
    const pending = createUserscriptFetch(request)(UPLOAD_ENDPOINT, {
      body: new FormData(),
      signal: controller.signal,
    });
    const reason = new DOMException("Deadline exceeded", "TimeoutError");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  test("does not start an already canceled request", async () => {
    const request = mock(() => ({ abort() {} }));
    await expect(
      createUserscriptFetch(request)(UPLOAD_ENDPOINT, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  test("removes the deadline listener after a completed upload", async () => {
    const controller = new AbortController();
    const abort = mock(() => {});
    const request: UserscriptRequest = (details) => {
      details.onload({ status: 200, responseText: "{}", finalUrl: UPLOAD_ENDPOINT });
      return { abort };
    };
    await createUserscriptFetch(request)(UPLOAD_ENDPOINT, { signal: controller.signal });
    controller.abort();
    expect(abort).not.toHaveBeenCalled();
  });

  test("never sends invalid images", async () => {
    const request = mock(() => ({ abort() {} }));
    await expect(uploadImage({}, createUserscriptFetch(request))).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

test("userscript is a self-contained installable bundle without extension runtime APIs", async () => {
  const directory = await mkdtemp("/tmp/opencode/imageuploader-userscript-");
  try {
    const output = await buildUserscript(directory);
    expect(output).toBe(join(directory, "imageuploader.user.js"));
    const script = await Bun.file(output).text();
    expect(script.startsWith("// ==UserScript==\n")).toBe(true);
    for (const line of [
      `// @version      ${manifest.version}`,
      "// @updateURL    https://github.com/infybtw/image-uploader/releases/latest/download/imageuploader.meta.js",
      "// @downloadURL  https://github.com/infybtw/image-uploader/releases/latest/download/imageuploader.user.js",
      "// @match        https://*.twitch.tv/*",
      "// @match        https://*.kick.com/*",
      "// @connect      twir.app",
      "// @grant        GM_xmlhttpRequest",
      "// @grant        GM.setClipboard",
      "// @sandbox      DOM",
      "// @run-at       document-start",
      "// ==/UserScript==",
    ]) {
      expect(script).toContain(line);
    }
    const metadata = await Bun.file(join(directory, "imageuploader.meta.js")).text();
    expect(metadata).toBe(`${script.split("// ==/UserScript==")[0]}// ==/UserScript==\n`);
    expect(script).not.toMatch(/chrome\.runtime|browser\.runtime|__UPLOAD_TIMEOUT_MS__/);
    expect(script).not.toContain("execCommand");
    expect(script).not.toContain("captureInsertionPoint");
    expect(script).not.toContain("@require");
    expect(script).not.toMatch(/^\s*(?:import|export)\s/m);

    for (const href of [
      "https://www.twitch.tv/channel",
      "https://kick.com/channel",
      "https://evil.com/",
    ]) {
      const addEventListener = mock(() => {});
      // No browser/chrome runtime, network API or clipboard access is available.
      runInNewContext(script, {
        URL,
        location: { href },
        document: { addEventListener, readyState: "loading" },
      });
      expect(addEventListener.mock.calls.length).toBe(href.includes("evil.com") ? 0 : 2);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
