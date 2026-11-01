import { errorMessage, isAllowedPage, type UploadReply } from "./shared";
import { decodeImage, uploadFile, UploadHttpError } from "./upload";
import { browser, type Browser } from "wxt/browser";
import { loadPreviewPage, type PreviewPageReply } from "./preview-page";
import { isAccountAction, type AccountReply } from "./accounts";
import { createTwirAuth } from "./twir-auth";
import { createAuthStore } from "./twir-auth-store";

const activeTabs = new Set<number>();
const auth = createTwirAuth({
  store: createAuthStore(browser.storage.session),
  redirectUri: () => browser.identity.getRedirectURL(),
  launch: (url) => browser.identity.launchWebAuthFlow({ url, interactive: true }),
});

export function registerBackground() {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      isAccountAction(message.type)
    ) {
      const action = message.type;
      const allowed =
        sender.id === browser.runtime.id &&
        typeof sender.tab?.id === "number" &&
        sender.frameId === 0 &&
        !!sender.url &&
        isAllowedPage(sender.url);
      void (async (): Promise<AccountReply> => {
        if (!allowed)
          return { ok: false, error: "Account controls are only available on Twitch and Kick." };
        try {
          if (action === "twir-connect") await auth.connect();
          const result = action === "twir-disconnect" ? await auth.disconnect() : undefined;
          return { ok: true, status: await auth.status(), ...result };
        } catch (error) {
          return { ok: false, error: errorMessage(error) };
        }
      })().then(sendResponse);
      return true;
    }
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
    const image = "image" in message ? message.image : undefined;
    const file = decodeImage(image); // Validate before reading credentials or refreshing a token.
    const access = await auth.accessToken();
    try {
      const url = await uploadFile(file, undefined, undefined, access?.token);
      return { ok: true, url };
    } catch (error) {
      if (access && error instanceof UploadHttpError && error.status === 401)
        await auth.rejectAccess(access);
      throw error;
    }
  } catch (error) {
    console.error("[Viewer Companion] Upload failed", error);
    return { ok: false, error: errorMessage(error) };
  } finally {
    activeTabs.delete(tabId);
  }
}
