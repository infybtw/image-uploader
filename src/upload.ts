import { MAX_IMAGE_SIZE, UPLOAD_ENDPOINT, errorMessage, validateImage } from "./shared";

export function decodeImage(payload: unknown): File {
  if (!payload || typeof payload !== "object") throw new Error("Invalid image data.");
  const { name, mimeType, base64 } = payload as Record<string, unknown>;
  if (typeof name !== "string" || name.length > 255 || typeof mimeType !== "string" || typeof base64 !== "string") {
    throw new Error("Invalid image data.");
  }
  if (base64.length > 4 * Math.ceil(MAX_IMAGE_SIZE / 3)) throw new Error("The image exceeds the 25 MiB size limit.");
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error("The image is corrupted.");
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("The image is corrupted.");
  }
  validateImage(mimeType, binary.length);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new File([bytes], name, { type: mimeType });
}

export function parseUploadUrl(body: unknown): string {
  const link = (body as { data?: { link?: unknown } } | null)?.data?.link;
  if (typeof link !== "string") throw new Error("Twir did not return an image link.");
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Twir returned an invalid link.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "twir.app" || url.port || url.username || url.password || !/^\/u\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error("Twir returned an unexpected link.");
  }
  // The public API examples currently use http; never insert an insecure URL.
  url.protocol = "https:";
  url.search = "";
  url.hash = "";
  return url.href;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function uploadImage(payload: unknown, fetcher: Fetch = fetch): Promise<string> {
  const file = decodeImage(payload);
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetcher(UPLOAD_ENDPOINT, {
      method: "POST",
      body: form,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new Error("Twir did not respond within 60 seconds. Please try again.");
    }
    throw new Error(`Could not connect to Twir. Check your network connection and permission to access twir.app.\n${errorMessage(error)}`);
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "Twir requires authentication. Anonymous uploads are currently unavailable.",
      403: "Twir rejected the anonymous upload.",
      413: "Twir rejected the file: the image exceeds the size limit.",
      415: "Twir does not support this image format.",
      429: "Too many uploads. Please wait and try again.",
    };
    throw new Error(messages[response.status] ?? `Twir error: HTTP ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Twir returned invalid JSON.");
  }
  return parseUploadUrl(body);
}
