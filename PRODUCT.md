# ImageUploader

<!-- impeccable:product-schema 1 -->

## Platform

web

Browser extension for Firefox and Chrome/Chromium, with a standalone Tampermonkey userscript. Interfaces are injected into Twitch and Kick, including their subdomains; this is not a standalone website or native application.

## Users

Twitch and Kick chat participants who want to share clipboard images and view linked images without leaving chat. This primary audience was confirmed during init.

## Product Purpose

Make image sharing and viewing available within the existing chat workflow. Success means users can paste an image, obtain its public link, and choose when to send it, while viewing and optionally filtering image previews in chat.

## Positioning

ImageUploader combines clipboard uploads through Twir Uploader, inline chat-link previews, an image viewer, and local image editing inside Twitch and Kick. It augments the host site's chat rather than replacing it. No exclusive capability or competitive superiority claim is established.

## Operating Context

- Users install either the extension or the userscript, not both on the same site.
- Pasting an image into an editable field on a supported site immediately starts an upload. Normal text pastes remain unchanged.
- Completed links appear above a recognized chat input, with a floating notification as the fallback. Users can copy links and manually send their message.
- Optional automatic insertion adds a link to an unsent draft; it is off by default and never sends messages.
- A navigation gear opens settings. Chat previews can be disabled, opened in an on-page viewer or as website links, and excluded by username, domain, or known bot account. Previews from known bots are hidden by default.
- Upload thumbnails open an editor with crop, draw, rotate, horizontal flip, undo/redo, and reset. Uploading an edited image replaces its displayed link only after success.
- The interface must coexist with host-site navigation, themes, chat input replacement, and chat remounting without disrupting messages, drafts, or normal link behavior.

## Capabilities and Constraints

- Uploads go anonymously to Twir Uploader. Accepted formats are PNG, JPEG, GIF, WebP, AVIF, and BMP, up to 25 MiB per file; SVG is unsupported. Multiple images upload sequentially.
- Public uploads are not deleted by closing a panel, undoing chat text, or replacing a link with an edited upload. Retention and deletion policies belong to Twir; anonymous upload management is not implemented.
- Image editing is local and in-memory, limited to 32 megapixels. Edited exports are PNG; animated GIFs become still images. Closing the editor discards unsaved edits.
- Chat previews inspect HTTP/HTTPS links and may fetch page metadata when direct image loading fails. Unsupported layouts and failed previews leave original messages and links intact.
- Preview exclusions affect chat thumbnails, not uploaded-image panels or the editor. Settings apply without a page reload.
- Settings are stored locally and shared across supported sites by extension storage or Tampermonkey storage. The userscript falls back to per-site local storage if its storage API is unavailable.
- Clipboard images are read only from trusted paste events in editable fields. There is no clipboard polling, browsing-history collection, telemetry, or upload storage within ImageUploader. Clipboard replacement happens only on an explicit copy action.
- Uploads and background metadata requests omit credentials and the host-page referrer. Chat text and Twitch/Kick page URLs are not sent to the uploader. Ordinary image requests and metadata requests still expose the user's IP address and requested URL to destination servers; image requests follow browser cookie policy.
- Twir controls uploader availability and limits. Failed uploads are not automatically retried. Authenticated pages, script-generated metadata, and destination security policies may prevent previews.
- The documented minimum browsers are Firefox 140+ and Chrome/Chromium 148+. Extension and userscript behavior should remain aligned where platform APIs permit.

## Brand Commitments

The established product name is ImageUploader; injected interface labels also use “Image Uploader.” Twitch, Kick, and Twir Uploader are external services, not product-owned brands. No additional voice or visual commitments were established during init.

## Evidence on Hand

- `README.md` documents installation, supported workflows, privacy disclosures, limitations, and manual extension loading.
- `src/` contains the implemented upload, chat preview, settings, viewer, editor, and userscript behavior.
- `extension/` contains browser metadata; `tests/` contains unit and browser integration coverage.
- `package.json` and `wxt.config.ts` establish the existing Bun/WXT build tooling. There is no standalone app development-server workflow.
- No customer testimonials, adoption statistics, performance benchmarks, or pricing evidence was established during init; do not invent them.

## Product Principles

1. Keep participants in their existing chat workflow; do not replace chat or silently send messages.
2. Preserve user control over drafts, clipboard writes, preview behavior, and edited-image uploads.
3. Be explicit that pasted images become public third-party uploads; do not imply private hosting or deletion control.
4. Keep settings and chat processing local, with no telemetry or unnecessary data transmission.
5. Fail without damaging the host experience: retain original links, completed uploads, and recoverable edits when requests or integrations fail.

## Accessibility & Inclusion

Existing behavior includes reduced-motion handling, keyboard controls, and focus containment/restoration in the image viewer. Preserve these behaviors. No additional accessibility standard or compliance claim was established during init.
