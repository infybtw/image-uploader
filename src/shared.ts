export const UPLOAD_ENDPOINT = "https://twir.app/api/v1/uploader/files";
export const SITE_MATCHES = ["https://*.twitch.tv/*", "https://*.kick.com/*"];
export const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
export const IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
]);

export interface ImagePayload {
  name: string;
  mimeType: string;
  base64: string;
}

export interface UploadMessage {
  type: "upload-image";
  image: ImagePayload;
}

export type UploadReply = { ok: true; url: string } | { ok: false; error: string };

export function isAllowedPage(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      protocol === "https:" &&
      ["twitch.tv", "kick.com"].some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

export function validateImage(type: string, size: number): void {
  if (!IMAGE_TYPES.has(type)) {
    throw new Error("Supported formats: PNG, JPEG, GIF, WebP, AVIF, and BMP.");
  }
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("The image is empty or corrupted.");
  if (size > MAX_IMAGE_SIZE) throw new Error("The image exceeds the 25 MiB size limit.");
}

export function errorMessage(error: unknown): string {
  // Firefox can reject with strings, plain objects, or errors from another realm.
  // An instanceof Error check loses their actual messages.
  try {
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object") {
      const { name, message } = error as { name?: unknown; message?: unknown };
      if (typeof message === "string" && message.trim()) {
        return typeof name === "string" && name && name !== "Error"
          ? `${name}: ${message}`
          : message;
      }
      if (typeof name === "string" && name) return name;
      const details = JSON.stringify(error);
      if (details && details !== "{}") return details;
    }
    return `Error with no description (${String(error)}).`;
  } catch {
    return "Could not read the error details.";
  }
}
