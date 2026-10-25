import { getUploaderImageUrl } from "./shared";

const PREVIEW_ATTRIBUTE = "data-imageuploader-preview";
const MAX_PREVIEWS = 3;

function messageSelector(hostname: string): string | null {
  if (hostname === "twitch.tv" || hostname.endsWith(".twitch.tv")) {
    return '.chat-line__message, [data-a-target="chat-line-message"]';
  }
  if (hostname === "kick.com" || hostname.endsWith(".kick.com")) {
    return "#chatroom-messages .chat-entry";
  }
  return null;
}

export function observeChatPreviews(
  root: Document | HTMLElement = document,
  hostname = location.hostname,
): () => void {
  const selector = messageSelector(hostname) ?? "";
  if (!selector) return () => {};
  const states = new WeakMap<Element, { key: string; host: HTMLElement | null }>();
  const owner = root.ownerDocument ?? (root as Document);

  function update(message: Element) {
    if (!root.contains(message) || message.closest("[contenteditable], input, textarea")) return;
    const urls = new Set<string>();
    for (const link of message.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (link.closest(selector) !== message || link.closest("[contenteditable]")) continue;
      const url = getUploaderImageUrl(link.href);
      if (url) urls.add(url);
      if (urls.size === MAX_PREVIEWS) break;
    }
    const key = [...urls].join("\n");
    const previous = states.get(message);
    if (previous?.key === key && (!previous.host || previous.host.parentElement === message))
      return;
    previous?.host?.remove();
    const state = { key, host: null as HTMLElement | null };
    states.set(message, state);
    if (!urls.size) return;

    const host = owner.createElement("div");
    host.setAttribute(PREVIEW_ATTRIBUTE, "");
    host.style.cssText = "all:initial;display:block;max-width:100%;margin-top:6px";
    const shadow = host.attachShadow({ mode: "open" });
    const style = owner.createElement("style");
    style.textContent = `
      :host { color-scheme: light dark; }
      a { display:block; width:240px; max-width:100%; margin:0 0 6px; border-radius:6px; overflow:hidden; }
      a:focus-visible { outline:2px solid #9147ff; outline-offset:2px; }
      img { display:block; width:100%; height:160px; object-fit:contain; background:#80808018; }
    `;
    shadow.append(style);
    for (const url of urls) {
      const link = owner.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = "Open image on Twir";
      const image = owner.createElement("img");
      image.alt = "Twir image preview";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener(
        "error",
        () => {
          link.remove();
          if (!shadow.querySelector("a")) {
            host.remove();
            state.host = null; // Do not retry broken links on every chat mutation.
          }
        },
        { once: true },
      );
      image.src = url;
      link.append(image);
      shadow.append(link);
    }
    state.host = host;
    message.append(host);
  }

  function collect(element: Element, messages: Set<Element>) {
    const closest = element.closest(selector);
    if (closest) messages.add(closest);
    for (const message of element.querySelectorAll(selector)) messages.add(message);
  }

  const observer = new MutationObserver((records) => {
    const messages = new Set<Element>();
    for (const record of records) {
      // Include the target so deleted/edited links also remove stale previews.
      if (record.target instanceof Element) {
        const message = record.target.closest(selector);
        if (message) messages.add(message);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) collect(node, messages);
      }
    }
    for (const message of messages) update(message);
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  const initial = new Set<Element>();
  if (root instanceof Element) collect(root, initial);
  else for (const message of root.querySelectorAll(selector)) initial.add(message);
  for (const message of initial) update(message);

  return () => {
    observer.disconnect();
    for (const host of root.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`)) host.remove();
  };
}

export function registerChatPreviews() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => observeChatPreviews(), { once: true });
  } else {
    observeChatPreviews();
  }
}
