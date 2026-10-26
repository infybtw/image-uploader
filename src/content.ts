import { getPastedImages, serializeImage } from "./clipboard";
import { captureInsertionPoint, findEditor } from "./editor";
import { createNotice } from "./notice";
import { findChatInput } from "./notice-placement";
import { errorMessage, isAllowedPage, validateImage, type ImagePayload } from "./shared";
import type { WriteText } from "./copy-button";
import { registerChatPreviews } from "./chat-previews";
import type { ResolvePreviewPage } from "./preview-page";
import { createSettings, DEFAULT_SETTINGS, type SettingsController } from "./settings";
import { registerSettingsUi } from "./settings-ui";

export const AUTO_INSERT_DISMISS_MS = 3_000;

export function registerPasteHandler(
  upload: (image: ImagePayload) => Promise<string>,
  writeText?: WriteText,
  resolvePage?: ResolvePreviewPage,
  settings: SettingsController = createSettings({
    load: () => DEFAULT_SETTINGS,
    save: () => {},
  }),
) {
  let busy = false;

  if (isAllowedPage(location.href)) {
    const previews = registerChatPreviews(
      resolvePage,
      () => settings.get().previewClick,
      () => settings.get(),
      false, // Read saved exclusions before making any chat preview requests.
    );
    let filterKey = JSON.stringify([
      settings.get().blockedUsers,
      settings.get().blockedDomains,
      settings.get().hideBots,
    ]);
    const syncPreviews = () => {
      const current = settings.get();
      previews.setEnabled(current.chatPreviews);
      const nextKey = JSON.stringify([
        current.blockedUsers,
        current.blockedDomains,
        current.hideBots,
      ]);
      if (filterKey !== nextKey) previews.refreshFilters();
      filterKey = nextKey;
    };
    settings.subscribe(syncPreviews);
    void settings.ready.then(syncPreviews);
    registerSettingsUi(settings);

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
        // Capture the draft before mounting the notice: the site may re-render the editor.
        const insertion = settings.get().autoInsert ? captureInsertionPoint(editor) : undefined;
        const originals = new Map<string, File>();
        const notify = createNotice(writeText, findChatInput(editor), {
          files: originals,
          upload: async (file) => upload(await serializeImage(file)),
        });
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
              const url = await upload(image);
              originals.set(url, file);
              urls.push(url);
            }
            const inserted =
              urls.length > 0 &&
              Boolean(insertion) &&
              settings.get().autoInsert &&
              Boolean(insertion?.insert(urls.join(" ")));
            notify(
              inserted
                ? "Uploaded and inserted into chat. Copy the link:"
                : "Uploaded. Copy the link:",
              urls,
              true,
              inserted ? AUTO_INSERT_DISMISS_MS : undefined,
            );
          } catch (error) {
            console.error(`[ImageUploader] ${stage}`, error);
            notify(
              `${stage}: ${errorMessage(error)}${urls.length ? "\nImages already uploaded:" : ""}`,
              urls,
              true,
            );
          } finally {
            insertion?.dispose();
            busy = false;
          }
        })();
      },
      true,
    );
  }
}
