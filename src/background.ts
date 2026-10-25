import { errorMessage, isAllowedPage, type UploadReply } from "./shared";
import { uploadImage } from "./upload";
import { browser, type Browser } from "wxt/browser";
import { loadPreviewPage, type PreviewPageReply } from "./preview-page";

const activeTabs = new Set<number>();

export function registerBackground() {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "preview-page"
    ) {
      const allowed =
        sender.id === browser.runtime.id &&
        typeof sender.tab?.id === "number" &&
        sender.url &&
        isAllowedPage(sender.url);
      void (
        allowed
          ? loadPreviewPage("url" in message ? message.url : undefined)
          : Promise.resolve(null)
      ).then((page) => sendResponse({ page } satisfies PreviewPageReply));
      return true;
    }
    if (
      !message ||
      typeof message !== "object" ||
      !("type" in message) ||
      message.type !== "upload-image"
    ) {
      return undefined;
    }
    // Callback responses also work when Chrome's Promise-listener rollout is disabled.
    void handleUpload(message, sender).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: errorMessage(error) } satisfies UploadReply);
    });
    return true;
  });
}

async function handleUpload(
  message: object,
  sender: Browser.runtime.MessageSender,
): Promise<UploadReply> {
  const tabId = sender.tab?.id;
  if (
    sender.id !== browser.runtime.id ||
    typeof tabId !== "number" ||
    !sender.url ||
    !isAllowedPage(sender.url)
  ) {
    return { ok: false, error: "Uploads are only allowed on Twitch and Kick." };
  }
  if (activeTabs.has(tabId))
    return { ok: false, error: "An image is already being uploaded in this tab." };
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
