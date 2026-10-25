import { getChatPreviewUrl } from "./shared";
import type { ResolvePreviewPage } from "./preview-page";
import { bindImageViewer } from "./image-viewer";

const PREVIEW_ATTRIBUTE = "data-imageuploader-preview";

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
  resolvePage?: ResolvePreviewPage,
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
      const url = getChatPreviewUrl(link.href);
      if (url) urls.add(url);
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
      const image = owner.createElement("img");
      image.alt = "Image preview";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      bindImageViewer(link, image);
      const remove = () => {
        link.remove();
        if (!shadow.querySelector("a")) {
          host.remove();
          state.host = null; // Do not retry broken links on every chat mutation.
        }
      };
      const current = () =>
        states.get(message) === state && host.parentElement === message && root.contains(message);
      image.addEventListener(
        "error",
        () => {
          if (!current()) return;
          if (!resolvePage) {
            remove();
            return;
          }
          link.style.display = "none";
          void Promise.resolve()
            .then(() => (current() ? resolvePage(url) : null))
            .then((imageUrl) => {
              // Edited/deleted messages and stopped observers must not restore old previews.
              if (!current()) return;
              const source = imageUrl && getChatPreviewUrl(imageUrl);
              if (!source || source === url) {
                remove();
                return;
              }
              image.addEventListener("error", remove, { once: true });
              link.style.removeProperty("display");
              image.src = source;
            })
            .catch(remove);
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

export function registerChatPreviews(resolvePage?: ResolvePreviewPage) {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => observeChatPreviews(document, location.hostname, resolvePage),
      { once: true },
    );
  } else {
    observeChatPreviews(document, location.hostname, resolvePage);
  }
}
