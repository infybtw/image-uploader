import { describe, expect, mock, test } from "bun:test";
import { getPreviewPageUrl, loadPreviewPage, MAX_PREVIEW_PAGE_SIZE } from "../src/preview-page";
import {
  createUserscriptPreviewLoader,
  type UserscriptPreviewRequestDetails,
} from "../src/userscript-preview";

const post = "https://img.hishi.icu/post/nw8nBYytbd";
const html =
  '<meta property="og:image" content="https://pic.hishi.icu/media/v2/thumbs/example.webp">';

describe("metadata page URL validation", () => {
  for (const url of [
    post,
    "https://example.com/article",
    "https://another.example/gallery/photo?id=42&token=abc",
    "http://example.com:8080/share/abc",
  ]) {
    test(`accepts ${url} and removes fragments only`, () => {
      expect(getPreviewPageUrl(url)).toBe(url);
      expect(getPreviewPageUrl(`${url}#top`)).toBe(url);
    });
  }
  for (const url of [
    "https://user@example.com/image",
    "https://user:password@example.com/image",
    "file:///photo.png",
    "ftp://example.com/photo.png",
    "data:text/html,<meta>",
    "javascript:alert(1)",
    "not a URL",
    null,
  ]) {
    test(`does not fetch ${url}`, async () => {
      const fetcher = mock(async () => new Response(html));
      expect(await loadPreviewPage(url, fetcher)).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    });
  }
});

describe("background metadata loading", () => {
  test("loads bounded HTML anonymously, without referrer, following redirects", async () => {
    const fetcher = mock(
      async (_url: string, _init: RequestInit) =>
        new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    );
    expect(await loadPreviewPage(post, fetcher)).toEqual({ html, url: post });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(post);
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.redirect).toBe("follow");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  test("keeps the final page URL for relative images after redirects", async () => {
    const finalUrl = "https://another.example/gallery/post";
    const response = new Response(html, { headers: { "Content-Type": "text/html" } });
    Object.defineProperty(response, "url", { value: finalUrl });
    expect(await loadPreviewPage("https://short.example/abc", async () => response)).toEqual({
      html,
      url: finalUrl,
    });
  });
  for (const [status, type, body] of [
    [404, "text/html", html],
    [200, "application/json", "{}"],
    [200, "text/html", "x".repeat(MAX_PREVIEW_PAGE_SIZE + 1)],
  ] as const) {
    test(`ignores HTTP ${status}, ${type}, ${body.length} bytes`, async () => {
      expect(
        await loadPreviewPage(
          post,
          async () =>
            new Response(body, {
              status,
              headers: { "Content-Type": type },
            }),
        ),
      ).toBeNull();
    });
  }
  test("network errors fail silently", async () => {
    expect(
      await loadPreviewPage(post, async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });
});

describe("userscript metadata loading", () => {
  test("uses an anonymous GET for any HTTP(S) page, but never unsafe URLs", async () => {
    const request = mock((details: UserscriptPreviewRequestDetails) => {
      details.onload({ status: 200, finalUrl: post, responseText: html });
      return { abort() {} };
    });
    const load = createUserscriptPreviewLoader(request);
    expect(await load("javascript:alert(1)")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(await load("https://example.com/article")).toEqual({ html, url: post });
    const [details] = request.mock.calls[0]!;
    expect(details.method).toBe("GET");
    expect(details.anonymous).toBe(true);
    expect(details.url).toBe("https://example.com/article");
    expect(details.redirect).toBe("follow");
    expect(details.headers.Referer).toBe("");
    expect("data" in details).toBe(false);
  });
  for (const [status, finalUrl, responseText] of [
    [403, post, html],
    [200, "file:///private.html", html],
    [200, post, "я".repeat(MAX_PREVIEW_PAGE_SIZE)],
  ] as const) {
    test(`rejects invalid response: ${status}, ${finalUrl}, ${responseText.length} characters`, async () => {
      const load = createUserscriptPreviewLoader((details) => {
        details.onload({ status, finalUrl, responseText });
        return { abort() {} };
      });
      expect(await load(post)).toBeNull();
    });
  }
  for (const callback of ["onerror", "onabort", "ontimeout"] as const) {
    test(`${callback} fails silently`, async () => {
      const load = createUserscriptPreviewLoader((details) => {
        details[callback]();
        return { abort() {} };
      });
      expect(await load(post)).toBeNull();
    });
  }
  test("enforces a deadline even when the transport ignores native timeouts", async () => {
    const abort = mock(() => {});
    const load = createUserscriptPreviewLoader(() => ({ abort }), 1);
    expect(await load(post)).toBeNull();
    expect(abort).toHaveBeenCalledTimes(1);
  });
  test("permission errors fail silently", async () => {
    const load = createUserscriptPreviewLoader(() => {
      throw new Error("Permission denied");
    });
    expect(await load(post)).toBeNull();
  });
});
