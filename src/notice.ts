import { createCopyButton } from "./copy-button";

export function createNotice() {
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;top:20px;right:20px;z-index:2147483647;max-width:calc(100vw - 40px)";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .card { box-sizing: border-box; width: 360px; max-width: calc(100vw - 40px); padding: 16px;
      background: #18181b; color: #fafafa; border: 1px solid #7160ec; border-radius: 12px;
      box-shadow: 0 8px 32px #0006; font: 14px/1.5 system-ui, sans-serif; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    button { color: #fafafa; background: #303036; border: 0; border-radius: 6px; cursor: pointer; padding: 4px 10px; font: inherit; }
    p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
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
    @media (prefers-reduced-motion: reduce) { .copy-button { transition: none; } }
  `;
  let dismissTimer: number | undefined;
  let copyButtons: ReturnType<typeof createCopyButton>[] = [];
  const clearCopyButtons = () => {
    for (const button of copyButtons) button.destroy();
    copyButtons = [];
  };
  const dismiss = () => {
    window.clearTimeout(dismissTimer);
    clearCopyButtons();
    host.remove();
  };
  const card = document.createElement("section");
  card.className = "card";
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = "ImageUploader";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close notification");
  close.addEventListener("click", dismiss);
  header.append(title, close);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const links = document.createElement("div");
  card.append(header, status, links);
  root.append(style, card);
  document.documentElement.append(host);

  return (message: string, urls: string[] = [], persistent = false) => {
    window.clearTimeout(dismissTimer);
    clearCopyButtons();
    if (!host.isConnected) document.documentElement.append(host);
    status.textContent = message;
    links.replaceChildren();
    for (const url of urls) {
      const row = document.createElement("div");
      row.className = "link";
      const input = document.createElement("input");
      input.value = url;
      input.readOnly = true;
      input.setAttribute("aria-label", "Image link — click to select and copy");
      input.addEventListener("click", () => input.select());
      const copy = createCopyButton(url, (error) => {
        status.textContent = error;
        window.clearTimeout(dismissTimer);
      });
      copy.element.addEventListener("click", () => {
        // Keep the success check visible even when copying just before auto-dismiss.
        window.clearTimeout(dismissTimer);
        if (!persistent) dismissTimer = window.setTimeout(dismiss, 8_000);
      });
      copyButtons.push(copy);
      row.append(input, copy.element);
      links.append(row);
    }
    if (!persistent) dismissTimer = window.setTimeout(dismiss, 8_000);
  };
}
