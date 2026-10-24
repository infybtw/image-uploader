import { IMAGE_TYPES, validateImage, type ImagePayload } from "./shared";

// Read only the image items in this paste event, never the global clipboard.
export function getPastedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const images = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return images.length ? images : Array.from(data.files).filter((file) => file.type.startsWith("image/"));
}

export async function serializeImage(file: File, Reader: typeof FileReader = FileReader): Promise<ImagePayload> {
  validateImage(file.type, file.size);
  const mimeType = file.type;
  // Blob.arrayBuffer() may return a page-realm Promise. Awaiting it from Firefox's
  // isolated content script can fail when Promise reads its inaccessible constructor.
  // FileReader callbacks keep the Promise in the extension's own realm instead.
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => {
      const result = reader.result;
      const separator = typeof result === "string" ? result.indexOf(";base64,") : -1;
      if (typeof result !== "string" || separator === -1) {
        reject(new Error("Firefox did not return base64-encoded image data."));
        return;
      }
      resolve({
        name: `pasted-image.${IMAGE_TYPES.get(mimeType)}`,
        mimeType,
        base64: result.slice(separator + ";base64,".length),
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Firefox could not read the image from the clipboard."));
    reader.onabort = () => reject(new Error("Reading the clipboard image was canceled."));
    reader.readAsDataURL(file);
  });
}
