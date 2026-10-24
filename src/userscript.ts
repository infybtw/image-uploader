import { registerPasteHandler } from "./content";
import { uploadImage } from "./upload";
import { createUserscriptFetch, type UserscriptRequest } from "./userscript-request";

declare const GM_xmlhttpRequest: UserscriptRequest;
declare const GM: { setClipboard(text: string, type: "text"): Promise<void> };

const fetcher = createUserscriptFetch((details) => GM_xmlhttpRequest(details));
registerPasteHandler(
  (image) => uploadImage(image, fetcher),
  (text) => GM.setClipboard(text, "text"),
);
