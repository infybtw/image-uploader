import { getPastedImages, serializeImage } from "./clipboard";
import { findEditor } from "./editor";
import { createNotice } from "./notice";
import { findTwitchChatInput } from "./notice-placement";
import { errorMessage, isAllowedPage, validateImage, type ImagePayload } from "./shared";
import type { WriteText } from "./copy-button";
import { registerChatPreviews } from "./chat-previews";
import type { ResolvePreviewPage } from "./preview-page";

export function registerPasteHandler(
  upload: (image: ImagePayload) => Promise<string>,
  writeText?: WriteText,
  resolvePage?: ResolvePreviewPage,
) {
  let busy = false;

  if (isAllowedPage(location.href)) {
    registerChatPreviews(resolvePage);
    document.addEventListener(
      "paste",
      (event) => {
        if (!event.isTrusted || event.defaultPrevented) return;
        const editor = findEditor(event.composedPath()[0] ?? event.target);
        if (!editor) return;
        const files = getPastedImages(event.clipboardData);
        if (!files.length) return; // Never interfere with normal text pastes.
        event.preventDefault();
        event.stopImmediatePropagation();
        // Keep this synchronous: the browser's normal paste must already be cancelled.
        if (busy) return;
        const notify = createNotice(writeText, findTwitchChatInput(editor));
        busy = true;
        void (async () => {
          const urls: string[] = [];
          let stage = "Validating images";
          try {
            for (const file of files) validateImage(file.type, file.size);
            for (const [index, file] of files.entries()) {
              notify(
                `Uploading ${index + 1}/${files.length}… The image will be accessible via a public link.`,
                [],
                true,
              );
              stage = `Reading image ${index + 1}/${files.length}`;
              const image = await serializeImage(file);
              stage = `Uploading image ${index + 1}/${files.length}`;
              urls.push(await upload(image));
            }
            notify("Uploaded. Copy the link:", urls, true);
          } catch (error) {
            console.error(`[ImageUploader] ${stage}`, error);
            notify(
              `${stage}: ${errorMessage(error)}${urls.length ? "\nImages already uploaded:" : ""}`,
              urls,
              true,
            );
          } finally {
            busy = false;
          }
        })();
      },
      true,
    );
  }
}
