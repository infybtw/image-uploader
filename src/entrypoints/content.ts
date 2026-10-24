import { defineContentScript } from "wxt/utils/define-content-script";
import { registerPasteHandler } from "../content";
import { SITE_MATCHES } from "../shared";

export default defineContentScript({
  matches: SITE_MATCHES,
  runAt: "document_start",
  allFrames: true,
  main: registerPasteHandler,
});
