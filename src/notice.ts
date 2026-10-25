import { createCopyButton, type WriteText } from "./copy-button";
import { mountNotice } from "./notice-placement";
import { getUploaderImageUrl } from "./shared";

const COPY_DISMISS_DELAY = 3_000;
let latestNoticeId = 0;
let dismissActiveNotice: (() => void) | undefined;

export function createNotice(writeText?: WriteText, chatInput: Element | null = null) {
  const noticeId = ++latestNoticeId;
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .card { position: relative; overflow: hidden; box-sizing: border-box; width: 360px; max-width: calc(100vw - 40px); padding: 16px;
      background: #18181b; color: #fafafa; border: 1px solid #7160ec; border-radius: 12px;
      box-shadow: 0 8px 32px #0006; font: 14px/1.5 system-ui, sans-serif; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    button { color: #fafafa; background: #303036; border: 0; border-radius: 6px; cursor: pointer; padding: 4px 10px; font: inherit; }
    header button { display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px;
      padding: 0; font-size: 22px; line-height: 1; }
    p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .links { max-height: min(320px, 50vh); overflow-y: auto; }
    .preview { display: block; margin-top: 8px; border-radius: 6px; overflow: hidden; background: #80808018; }
    .preview:focus-visible { outline: 2px solid #a78bfa; outline-offset: -2px; }
    .preview img { display: block; width: 100%; height: 120px; object-fit: contain; }
    .link { display: flex; align-items: center; margin-top: 8px; border: 1px solid #555;
      border-radius: 6px; background: #09090b; overflow: hidden; }
    .link:focus-within { border-color: #a78bfa; }
    input { box-sizing: border-box; flex: 1; min-width: 0; width: 100%; padding: 8px; border: 0;
      outline: none; background: transparent; color: #c4b5fd; font: 13px system-ui, sans-serif; }
    .copy-button { display: grid; place-items: center; flex: 0 0 32px; width: 32px; height: 30px;
      margin-right: 2px; padding: 0; background: transparent; color: #a1a1aa; transition: color .15s, background .15s; }
    .copy-button:hover { background: #27272a; color: #fafafa; }
    .copy-button:focus-visible { outline: 2px solid #a78bfa; outline-offset: -2px; }
    .copy-button:disabled { cursor: wait; }
    .copy-button[data-state="copied"] { color: #4ade80; }
    .countdown { position: absolute; top: 0; left: 0; right: 0; height: 3px; background: #fff3; }
    .countdown-bar { height: 100%; background: #fff; transform-origin: left;
      animation: countdown ${COPY_DISMISS_DELAY}ms linear forwards; }
    @keyframes countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    :host([data-placement="chat"]) .card { width: 100%; max-width: none; padding: 10px;
      background: var(--color-background-base, var(--color-surface-bg-default, #18181b));
      color: var(--color-text-base, var(--color-surface-fg-default, #efeff1));
      border-color: var(--color-border-base, var(--color-surface-fg-decorative, #53535f));
      border-radius: 6px; box-shadow: none;
      font-size: 12px; line-height: 1.4; }
    :host([data-placement="chat"]) header button { background: transparent; }
    :host([data-placement="chat"]) p { margin-top: 4px; }
    :host([data-placement="chat"]) .links { max-height: 180px; overflow-y: auto; }
    :host([data-placement="chat"]) .link { margin-top: 6px;
      background: var(--color-background-input, var(--color-surface-bg-highest, #09090b)); }
    :host([data-placement="chat"]) input { color: var(--color-text-base, var(--color-surface-fg-default, #efeff1)); }
    @media (prefers-reduced-motion: reduce) {
      .copy-button { transition: none; }
      .countdown-bar { animation: none; }
    }
  `;
  let unmount = () => {};
  let dismissTimer: number | undefined;
  let copyButtons: ReturnType<typeof createCopyButton>[] = [];
  const clearCopyButtons = () => {
    for (const button of copyButtons) button.destroy();
    copyButtons = [];
  };
  const dismiss = () => {
    window.clearTimeout(dismissTimer);
    clearCopyButtons();
    unmount();
    host.remove();
    if (dismissActiveNotice === dismiss) dismissActiveNotice = undefined;
  };
  const card = document.createElement("section");
  card.className = "card";
  card.setAttribute("aria-label", "Image Uploader");
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = "Image Uploader";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close notification");
  close.addEventListener("click", dismiss);
  header.append(title, close);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const links = document.createElement("div");
  links.className = "links";
  const countdown = document.createElement("div");
  countdown.className = "countdown";
  countdown.hidden = true;
  countdown.setAttribute("aria-hidden", "true");
  const cancelDismiss = () => {
    window.clearTimeout(dismissTimer);
    countdown.hidden = true;
    countdown.replaceChildren();
  };
  const dismissAfterCopy = () => {
    cancelDismiss();
    const bar = document.createElement("div");
    bar.className = "countdown-bar";
    countdown.append(bar);
    countdown.hidden = false;
    dismissTimer = window.setTimeout(dismiss, COPY_DISMISS_DELAY);
  };
  card.append(header, status, links, countdown);
  root.append(style, card);
  dismissActiveNotice?.();
  dismissActiveNotice = dismiss;
  unmount = mountNotice(host, chatInput);

  return (message: string, urls: string[] = [], persistent = false) => {
    // Late upload results must not bring back a superseded notification.
    if (noticeId !== latestNoticeId) return;
    cancelDismiss();
    clearCopyButtons();
    dismissActiveNotice = dismiss;
    if (!host.isConnected) {
      unmount();
      unmount = mountNotice(host, chatInput);
    }
    status.textContent = message;
    links.replaceChildren();
    for (const url of urls) {
      const upload = document.createElement("div");
      const imageUrl = getUploaderImageUrl(url);
      if (imageUrl) {
        const preview = document.createElement("a");
        preview.className = "preview";
        preview.href = imageUrl;
        preview.target = "_blank";
        preview.rel = "noopener noreferrer";
        preview.title = "Open image on Twir";
        const image = document.createElement("img");
        image.alt = "Uploaded image preview";
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => preview.remove(), { once: true });
        image.src = imageUrl;
        preview.append(image);
        upload.append(preview);
      }
      const row = document.createElement("div");
      row.className = "link";
      const input = document.createElement("input");
      input.value = url;
      input.readOnly = true;
      input.setAttribute("aria-label", "Image link — click to select and copy");
      input.addEventListener("click", () => input.select());
      const copy = createCopyButton(
        url,
        (error) => {
          status.textContent = error;
          cancelDismiss();
        },
        writeText,
        dismissAfterCopy,
      );
      // Cancel before the copy handler: Tampermonkey may fulfill GM.setClipboard
      // immediately, and native clicks can flush microtasks between listeners.
      // A later bubble listener would cancel the newly started countdown.
      copy.element.addEventListener("click", cancelDismiss, { capture: true });
      copyButtons.push(copy);
      row.append(input, copy.element);
      upload.append(row);
      links.append(upload);
    }
    if (!persistent) dismissTimer = window.setTimeout(dismiss, 8_000);
  };
}
