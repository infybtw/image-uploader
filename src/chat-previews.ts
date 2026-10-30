import { getChatPreviewUrl } from "./shared";
import type { ResolvePreviewPage } from "./preview-page";
import { bindImageViewer } from "./image-viewer";
import type { PreviewClick } from "./settings";
import { createPreviewFilter, type PreviewFilters } from "./preview-filters";
import { isPreviewMounted, mountPreview } from "./chat-preview-placement";

const PREVIEW_ATTRIBUTE = "data-imageuploader-preview";
const EMPTY_FILTERS: PreviewFilters = { blockedUsers: [], blockedDomains: [], hideBots: false };

function messageAuthor(message: Element): string {
  const username = message.getAttribute("data-username");
  if (username) return username.trim();
  // Prefer explicit author markers over layout fallbacks: badges and moderation
  // controls can also be buttons with titles, and replies contain other names.
  for (const selector of [
    '.chat-author__display-name, [data-a-target="chat-message-username"], .chat-line__username',
    '[data-testid="chat-message-username"], .chat-entry-username, [data-username]',
    ".seventv-chat-user-username",
    "button.font-bold",
  ]) {
    const author = message.querySelector(selector);
    if (!author) continue;
    return (
      author.getAttribute("data-a-user") ??
      author.getAttribute("data-username") ??
      author.closest("[data-a-user]")?.getAttribute("data-a-user") ??
      author.textContent ??
      ""
    ).trim();
  }
  return "";
}

const BADGE_SELECTOR = [
  ".chat-badge",
  ".seventv-chat-badge",
  '[data-a-target="chat-badge"]',
  '[data-test-selector="chat-badge"]',
  '[data-testid="chat-badge"]',
  "[data-badge]",
].join(", ");
// Twitch labels its official badge "Chat Bot"; other clients may omit the prefix.
const BOT_BADGE_LABEL = /^(?:chat\s+)?bot(?:\s+badge)?$/i;

function badgeLabel(element: Element): string {
  return (
    element.getAttribute("alt") ??
    element.getAttribute("title") ??
    element.getAttribute("aria-label") ??
    ""
  ).trim();
}

function hasBotBadge(message: Element): boolean {
  if (message.getAttribute("data-is-bot") === "true") return true;
  if (
    message.querySelector(
      '[data-is-bot="true"], [data-testid="chat-badge-bot"], ' +
        '[data-badge="bot" i], [data-badge-type="bot" i], [data-badge-id="bot" i]',
    )
  )
    return true;
  for (const badge of message.querySelectorAll(BADGE_SELECTOR)) {
    const labels = [badge, ...badge.querySelectorAll("[alt], [title], [aria-label]")].flatMap(
      (element) => {
        const label = badgeLabel(element);
        return label ? [label] : [];
      },
    );
    if (labels.some((label) => BOT_BADGE_LABEL.test(label))) return true;
    const image = badge.matches("img") ? badge : badge.querySelector("img");
    if (/bot-badge/i.test(image?.getAttribute("src") ?? "")) return true;
  }
  return false;
}

type PreviewObserver = (() => void) & { refresh(): void };

function messageSelector(hostname: string): string | null {
  if (hostname === "twitch.tv" || hostname.endsWith(".twitch.tv")) {
    return '.chat-line__message, [data-a-target="chat-line-message"], .seventv-user-message';
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
  getClickAction?: () => PreviewClick,
  getFilters: () => PreviewFilters = () => EMPTY_FILTERS,
): PreviewObserver {
  const selector = messageSelector(hostname) ?? "";
  if (!selector) return Object.assign(() => {}, { refresh() {} });
  const states = new WeakMap<
    Element,
    { key: string; host: HTMLElement | null; blockedSource: boolean }
  >();
  const hostMessages = new WeakMap<HTMLElement, Element>();
  const hosts = new Set<HTMLElement>();
  const owner = root.ownerDocument ?? (root as Document);
  let filter = createPreviewFilter(getFilters());
  let stopped = false;

  function update(message: Element, force = false) {
    if (!root.contains(message) || message.closest("[contenteditable], input, textarea")) return;
    const urls = new Set<string>();
    const blocked =
      filter.filtersAuthors && filter.blocksAuthor(messageAuthor(message), hasBotBadge(message));
    for (const link of blocked ? [] : message.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (link.closest(selector) !== message || link.closest("[contenteditable]")) continue;
      const url = getChatPreviewUrl(link.href);
      if (url && !filter.blocksUrl(url)) urls.add(url);
    }
    const key = [...urls].join("\n");
    const previous = states.get(message);
    if (previous?.key === key) {
      if (previous.host && !isPreviewMounted(previous.host, message))
        mountPreview(previous.host, message);
      if (!force) return;
      // Typing an exclusion must not reload every unrelated image in the chat.
      // Revisit removed metadata thumbnails only if a filter might now allow them.
      if (
        !previous.blockedSource &&
        (!previous.host ||
          [...previous.host.shadowRoot!.querySelectorAll("img")].every(
            (image) => !filter.blocksUrl(image.src),
          ))
      )
        return;
    }
    previous?.host?.remove();
    if (previous?.host) hosts.delete(previous.host);
    const state = { key, host: null as HTMLElement | null, blockedSource: false };
    states.set(message, state);
    if (!urls.size) return;

    const host = owner.createElement("div");
    host.setAttribute(PREVIEW_ATTRIBUTE, "");
    host.style.cssText =
      "all:initial;display:block;box-sizing:border-box;width:100%;max-width:100%;margin-top:6px";
    // Previews are siblings of messages, so they need Twitch's chat gutter too.
    if (hostname === "twitch.tv" || hostname.endsWith(".twitch.tv"))
      host.style.paddingLeft = "20px";
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
      bindImageViewer(link, image, getClickAction);
      const remove = () => {
        link.remove();
        if (!shadow.querySelector("a")) {
          host.remove();
          state.host = null; // Do not retry broken links on every chat mutation.
          hosts.delete(host);
          hostMessages.delete(host);
        }
      };
      const current = () =>
        !stopped &&
        states.get(message) === state &&
        state.host === host &&
        isPreviewMounted(host, message) &&
        root.contains(message);
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
              const blockedSource = Boolean(source && filter.blocksUrl(source));
              if (blockedSource) state.blockedSource = true;
              if (!source || source === url || blockedSource) {
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
    if (!mountPreview(host, message)) {
      host.remove();
      return;
    }
    state.host = host;
    hosts.add(host);
    hostMessages.set(host, message);
  }

  function collect(element: Element, messages: Set<Element>) {
    const closest = element.closest(selector);
    if (closest) messages.add(closest);
    for (const message of element.querySelectorAll(selector)) messages.add(message);
  }

  function removePreview(message: Element) {
    const state = states.get(message);
    if (state?.host) {
      state.host.remove();
      hosts.delete(state.host);
      hostMessages.delete(state.host);
    }
    states.delete(message);
  }

  function removePreviews(element: Element) {
    if (element.matches(selector)) removePreview(element);
    for (const message of element.querySelectorAll(selector)) removePreview(message);
  }

  const observer = new MutationObserver((records) => {
    const messages = new Set<Element>();
    for (const record of records) {
      // Include the target so deleted/edited links also remove stale previews.
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target) {
        const message = target.closest(selector);
        if (message) messages.add(message);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) collect(node, messages);
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(`[${PREVIEW_ATTRIBUTE}]`)) {
          const message = hostMessages.get(node as HTMLElement);
          if (message) messages.add(message);
          continue;
        }
        // Removed messages no longer take their preview with them.
        if (!root.contains(node)) removePreviews(node);
      }
    }
    for (const message of messages) update(message);
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "href",
      "data-username",
      "data-a-user",
      "data-is-bot",
      "data-badge",
      "data-badge-type",
      "data-badge-id",
      "title",
      "alt",
    ],
  });
  const initial = new Set<Element>();
  if (root instanceof Element) collect(root, initial);
  else for (const message of root.querySelectorAll(selector)) initial.add(message);
  for (const message of initial) update(message);

  const stop = () => {
    stopped = true;
    observer.disconnect();
    for (const host of hosts) host.remove();
    hosts.clear();
  };
  return Object.assign(stop, {
    refresh() {
      if (stopped) return;
      filter = createPreviewFilter(getFilters());
      for (const message of root.querySelectorAll(selector)) update(message, true);
      if (root instanceof Element && root.matches(selector)) update(root, true);
    },
  });
}

export function registerChatPreviews(
  resolvePage?: ResolvePreviewPage,
  getClickAction?: () => PreviewClick,
  getFilters: () => PreviewFilters = () => EMPTY_FILTERS,
  initiallyEnabled = true,
) {
  let enabled = initiallyEnabled;
  let mounted = false;
  let stop: PreviewObserver | undefined;
  const start = () => {
    mounted = true;
    if (enabled && !stop) {
      stop = observeChatPreviews(
        document,
        location.hostname,
        resolvePage,
        getClickAction,
        getFilters,
      );
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
  return {
    setEnabled(value: boolean) {
      enabled = value;
      if (!mounted) return;
      if (enabled && !stop) {
        stop = observeChatPreviews(
          document,
          location.hostname,
          resolvePage,
          getClickAction,
          getFilters,
        );
      } else if (!enabled && stop) {
        stop();
        stop = undefined;
      }
    },
    refreshFilters() {
      stop?.refresh();
    },
  };
}
