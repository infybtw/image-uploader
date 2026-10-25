import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  errorMessage,
  getChatPreviewUrl,
  getUploaderImageUrl,
  isAllowedPage,
  validateImage,
} from "../src/shared";

describe("chat preview candidates", () => {
  for (const value of [
    "https://images.example.com/photo.png",
    "https://example.com/image?id=123&signature=abc#frame",
    "http://example.com:8080/redirect",
    "https://twir.app/u/AbC123?size=large",
    "https://example.com/page",
  ]) {
    test(`preserves ${value} for browser image detection`, () => {
      expect(getChatPreviewUrl(value)).toBe(value);
    });
  }
  for (const value of [
    "javascript:alert(1)",
    "data:image/png;base64,AA==",
    "blob:https://example.com/id",
    "file:///image.png",
    "ftp://example.com/image.png",
    "https://user:password@example.com/image",
    "https://user@example.com/image",
    "not a URL",
  ]) {
    test(`ignores ${value}`, () => expect(getChatPreviewUrl(value)).toBeNull());
  }
});

describe("Uploader preview links", () => {
  test("recognizes Uploader IDs and normalizes to HTTPS without query or fragment", () => {
    expect(getUploaderImageUrl("https://twir.app/u/AbC_123-xyz")).toBe(
      "https://twir.app/u/AbC_123-xyz",
    );
    expect(getUploaderImageUrl("http://twir.app/u/AbC123?tracking=1#hash")).toBe(
      "https://twir.app/u/AbC123",
    );
  });
  for (const value of [
    "https://twir.app/",
    "https://twir.app/uploader",
    "https://twir.app/h/AbC123",
    "https://twir.app/s/AbC123",
    "https://twir.app/api/v1/uploader/files/delete?id=AbC123",
    "https://twir.app/u/",
    "https://twir.app/u/AbC123/other",
    "https://twir.app/u/AbC123.png",
    "https://twir.app/u/%22onerror=alert(1)",
    "https://twir.app.evil.com/u/AbC123",
    "https://www.twir.app/u/AbC123",
    "https://user:password@twir.app/u/AbC123",
    "https://twir.app:8080/u/AbC123",
    "ftp://twir.app/u/AbC123",
    "javascript:alert(1)",
    "not a URL",
  ]) {
    test(`ignores ${value}`, () => expect(getUploaderImageUrl(value)).toBeNull());
  }
});

describe("site allowlist", () => {
  for (const url of [
    "https://twitch.tv/name",
    "https://www.twitch.tv/popout/name/chat",
    "https://kick.com/name",
    "https://www.kick.com/",
  ]) {
    test(`allows ${url}`, () => expect(isAllowedPage(url)).toBe(true));
  }
  for (const url of [
    "http://twitch.tv",
    "https://twitch.tv.evil.com",
    "https://notkick.com",
    "https://evil.com/kick.com",
    "https://twir.app",
    "file:///twitch.tv",
    "not a url",
  ]) {
    test(`rejects ${url}`, () => expect(isAllowedPage(url)).toBe(false));
  }
});

describe("error descriptions", () => {
  test("preserves standard errors and their type", () => {
    expect(errorMessage(new Error("Upload failed"))).toBe("Upload failed");
    expect(errorMessage(new TypeError("file.arrayBuffer is not a function"))).toBe(
      "TypeError: file.arrayBuffer is not a function",
    );
    expect(errorMessage(new DOMException("Operation failed", "NotAllowedError"))).toBe(
      "NotAllowedError: Operation failed",
    );
  });
  test("preserves Firefox rejection strings and plain objects", () => {
    expect(errorMessage("Could not establish connection. Receiving end does not exist.")).toBe(
      "Could not establish connection. Receiving end does not exist.",
    );
    expect(errorMessage({ message: "Extension context invalidated." })).toBe(
      "Extension context invalidated.",
    );
    expect(errorMessage({ name: "NetworkError", message: "Failed to fetch" })).toBe(
      "NetworkError: Failed to fetch",
    );
  });
  test("preserves errors from a different realm", () => {
    const error = runInNewContext('new TypeError("Cross-realm failure")');
    expect(error instanceof Error).toBe(false);
    expect(errorMessage(error)).toBe("TypeError: Cross-realm failure");
  });
  test("shows structured errors and reports empty rejection values", () => {
    expect(errorMessage({ reason: "Upload rejected", code: 403 })).toBe(
      '{"reason":"Upload rejected","code":403}',
    );
    expect(errorMessage(null)).toContain("null");
    expect(errorMessage(undefined)).toContain("undefined");
    expect(errorMessage(403)).toContain("403");
  });
  test("doesn't throw when an error cannot be inspected", () => {
    const error = Object.defineProperty({}, "message", {
      get() {
        throw new Error("Blocked");
      },
    });
    expect(errorMessage(error)).toBe("Could not read the error details.");
  });
});

describe("image validation", () => {
  test("accepts every documented format and the size boundary", () => {
    for (const type of IMAGE_TYPES.keys())
      expect(() => validateImage(type, MAX_IMAGE_SIZE)).not.toThrow();
  });
  test("rejects SVG, non-images, empty files and oversized files", () => {
    for (const type of ["image/svg+xml", "text/plain", ""])
      expect(() => validateImage(type, 10)).toThrow();
    for (const size of [0, -1, NaN, Infinity, 1.5, MAX_IMAGE_SIZE + 1])
      expect(() => validateImage("image/png", size)).toThrow();
  });
});
