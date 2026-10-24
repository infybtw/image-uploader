import { errorMessage, isAllowedPage, type UploadReply } from "./shared";
import { uploadImage } from "./upload";

const activeTabs = new Set<number>();

browser.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!message || typeof message !== "object" || !("type" in message) || message.type !== "upload-image") {
    return undefined;
  }
  return handleUpload(message, sender);
});

async function handleUpload(message: object, sender: browser.runtime.MessageSender): Promise<UploadReply> {
  const tabId = sender.tab?.id;
  if (sender.id !== browser.runtime.id || typeof tabId !== "number" || !sender.url || !isAllowedPage(sender.url)) {
    return { ok: false, error: "Uploads are only allowed on Twitch and Kick." };
  }
  if (activeTabs.has(tabId)) return { ok: false, error: "An image is already being uploaded in this tab." };
  activeTabs.add(tabId);
  try {
    const url = await uploadImage("image" in message ? message.image : undefined);
    return { ok: true, url };
  } catch (error) {
    console.error("[ImageUploader] Upload failed", error);
    return { ok: false, error: errorMessage(error) };
  } finally {
    activeTabs.delete(tabId);
  }
}
