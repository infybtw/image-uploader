import { describe, expect, mock, test } from "bun:test";
import { decodeImage, parseUploadUrl, uploadImage } from "../src/upload";
import { getPastedImages, serializeImage } from "../src/clipboard";
import { UPLOAD_ENDPOINT } from "../src/shared";

const image = { name: "pasted-image.png", mimeType: "image/png", base64: "AAEC/w==" };
const success = { data: { link: "https://twir.app/u/AbC12345" } };

// Bun has no FileReader. Browser integration tests exercise the native implementation.
class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  readAsDataURL(file: Blob) {
    void Blob.prototype.arrayBuffer.call(file).then((buffer) => {
      this.result = `data:${file.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload?.();
    });
  }
}
const Reader = TestFileReader as unknown as typeof FileReader;

describe("message serialization", () => {
  test("binary image roundtrip, including non-ASCII bytes and chunk boundaries", async () => {
    const bytes = Uint8Array.from({ length: 20_000 }, (_, i) => i % 256);
    const file = new File([bytes], "private-original-name.png", { type: "image/png" });
    const payload = await serializeImage(file, Reader);
    expect(payload.name).toBe("pasted-image.png");
    expect(new Uint8Array(await decodeImage(payload).arrayBuffer())).toEqual(bytes);
  });
  test("does not call the clipboard File's cross-realm arrayBuffer method", async () => {
    const file = new File([new Uint8Array([0, 1, 2, 255])], "clipboard.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value() {
        throw new Error('Permission denied to access property "constructor"');
      },
    });
    expect((await serializeImage(file, Reader)).base64).toBe(image.base64);
  });
  test("preserves FileReader errors", async () => {
    class BrokenReader extends TestFileReader {
      override readAsDataURL() {
        this.error = new DOMException("Clipboard file is not readable", "NotReadableError");
        this.onerror?.();
      }
    }
    await expect(
      serializeImage(decodeImage(image), BrokenReader as unknown as typeof FileReader),
    ).rejects.toThrow("Clipboard file is not readable");
  });
  test("handles aborted reads and malformed FileReader results", async () => {
    class AbortedReader extends TestFileReader {
      override readAsDataURL() {
        this.onabort?.();
      }
    }
    class InvalidReader extends TestFileReader {
      override readAsDataURL() {
        this.result = "invalid";
        this.onload?.();
      }
    }
    await expect(
      serializeImage(decodeImage(image), AbortedReader as unknown as typeof FileReader),
    ).rejects.toThrow("canceled");
    await expect(
      serializeImage(decodeImage(image), InvalidReader as unknown as typeof FileReader),
    ).rejects.toThrow("base64");
  });
  test("rejects malformed messages before making any requests", () => {
    for (const payload of [
      null,
      {},
      { ...image, mimeType: "image/svg+xml" },
      { ...image, base64: "???=" },
      { ...image, base64: "" },
      { ...image, base64: "abc" },
      { ...image, name: 1 },
    ]) {
      expect(() => decodeImage(payload)).toThrow();
    }
  });
});

describe("clipboard filtering", () => {
  test("ignores an empty or text-only clipboard", () => {
    expect(getPastedImages(null)).toEqual([]);
    expect(
      getPastedImages({
        items: [{ kind: "string", type: "text/plain" }],
        files: [],
      } as unknown as DataTransfer),
    ).toEqual([]);
  });
  test("prefers image items and doesn't duplicate files", () => {
    const file = decodeImage(image);
    const data = {
      items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      files: [file],
    } as unknown as DataTransfer;
    expect(getPastedImages(data)).toEqual([file]);
  });
  test("falls back to the file list", () => {
    const file = decodeImage(image);
    const text = new File(["hi"], "test.txt", { type: "text/plain" });
    expect(getPastedImages({ items: [], files: [text, file] } as unknown as DataTransfer)).toEqual([
      file,
    ]);
  });
});

describe("response links", () => {
  test("uses data.link and upgrades the documented HTTP response to HTTPS", () => {
    expect(parseUploadUrl(success)).toBe("https://twir.app/u/AbC12345");
    expect(parseUploadUrl({ data: { link: "http://twir.app/u/AbC12345?x=y#hash" } })).toBe(
      "https://twir.app/u/AbC12345",
    );
  });
  test("never inserts arbitrary or executable links", () => {
    for (const link of [
      "javascript:alert(1)",
      "https://evil.com/u/a",
      "https://twir.app.evil.com/u/a",
      "https://twir.app/api/v1/uploader/files/delete",
      "https://user:pass@twir.app/u/a",
      "https://twir.app:8080/u/a",
      "/u/a",
      "bad",
    ]) {
      expect(() => parseUploadUrl({ data: { link } })).toThrow();
    }
    for (const value of [null, {}, { data: {} }, { data: { link: 123 } }])
      expect(() => parseUploadUrl(value)).toThrow();
  });
});

describe("anonymous upload", () => {
  test("posts a file with no cookies, authorization header, referrer or redirects", async () => {
    const fetcher = mock(async (_url: string, _init: RequestInit) => Response.json(success));
    expect(await uploadImage(image, fetcher)).toBe(success.data.link);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(UPLOAD_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.redirect).toBe("error");
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["file"]);
    const file = form.get("file") as File;
    expect(file.type).toBe("image/png");
    expect(file.name).toBe(image.name);
    expect(file.size).toBe(4);
  });
  for (const [status, message] of [
    [401, "authentication"],
    [403, "rejected"],
    [413, "size limit"],
    [415, "format"],
    [429, "Please wait"],
    [500, "HTTP 500"],
  ] as const) {
    test(`handles HTTP ${status}`, async () => {
      await expect(
        uploadImage(image, async () => new Response("error", { status })),
      ).rejects.toThrow(message);
    });
  }
  test("handles network errors", async () => {
    await expect(
      uploadImage(image, async () => {
        throw new TypeError("offline");
      }),
    ).rejects.toThrow("Check your network connection");
    await expect(
      uploadImage(image, async () => {
        throw { message: "NetworkError when attempting to fetch resource." };
      }),
    ).rejects.toThrow("NetworkError when attempting to fetch resource.");
  });
  test("handles timeouts", async () => {
    await expect(
      uploadImage(image, async () => {
        throw new DOMException("timeout", "TimeoutError");
      }),
    ).rejects.toThrow("60 seconds");
  });
  test("reports Chrome's shorter service-worker timeout", async () => {
    await expect(
      uploadImage(
        image,
        async () => {
          throw new DOMException("timeout", "TimeoutError");
        },
        25_000,
      ),
    ).rejects.toThrow("25 seconds");
  });
  test("handles invalid JSON and missing links", async () => {
    await expect(uploadImage(image, async () => new Response("<html>oops</html>"))).rejects.toThrow(
      "JSON",
    );
    await expect(uploadImage(image, async () => Response.json({ data: {} }))).rejects.toThrow(
      "image link",
    );
  });
  test("does not fetch invalid images", async () => {
    const fetcher = mock(async () => Response.json(success));
    await expect(uploadImage({}, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
