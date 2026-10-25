import { Settings as SettingsIcon } from "lucide";
import type { Settings, SettingsController } from "./settings";

export const SETTINGS_BUTTON_ATTRIBUTE = "data-imageuploader-settings";
export const SETTINGS_PANEL_ATTRIBUTE = "data-imageuploader-settings-panel";

type Site = "twitch" | "kick";

const SVG_NS = "http://www.w3.org/2000/svg";
const TWITCH_ANCHORS = [
  '[data-a-target="user-menu-toggle"]',
  '[data-test-selector="user-menu__toggle"]',
  '[data-test-selector="user-menu-toggle"]',
  '[aria-label="User menu" i]',
  '[data-a-target="user-card"]',
];
const TWITCH_CONTAINERS = [
  ".top-nav__right",
  '[data-a-target="top-nav"]',
  'nav[aria-label="Top navigation bar" i]',
  "#top-nav",
];
const KICK_ANCHORS = ['[data-testid="navbar-display-language"]'];
const KICK_CONTAINERS = ['nav[aria-label="Top navigation bar" i]', "header", "nav"];

function siteFor(hostname: string): Site | null {
  if (hostname === "twitch.tv" || hostname.endsWith(".twitch.tv")) return "twitch";
  if (hostname === "kick.com" || hostname.endsWith(".kick.com")) return "kick";
  return null;
}

function visible<T extends Element>(selectors: string, doc: Document): T | null {
  const matches = [...doc.querySelectorAll<T>(selectors)];
  return matches.find((element) => element.getClientRects().length > 0) ?? matches.at(-1) ?? null;
}

function findAnchor(
  doc: Document,
  site: Site,
): { parent: HTMLElement; before: Element | null } | null {
  if (site === "twitch") {
    // Twitch nests the avatar toggle inside a balloon wrapper. Insert before the
    // whole account control so the gear becomes its own top-navigation item.
    const userMenu = visible<HTMLElement>('[data-a-target="user-menu-toggle"]', doc);
    const account = userMenu?.closest<HTMLElement>(
      '[data-a-target="dropdown-down"], [data-a-target="dropdown-up"]',
    );
    if (account?.parentElement) return { parent: account.parentElement, before: account };
    for (const selector of TWITCH_ANCHORS) {
      const element = visible<HTMLElement>(selector, doc);
      if (element?.parentElement) return { parent: element.parentElement, before: element };
    }
    for (const selector of TWITCH_CONTAINERS) {
      const element = visible<HTMLElement>(selector, doc);
      if (element) return { parent: element, before: null };
    }
    return null;
  }
  const kicks = [
    ...doc.querySelectorAll<HTMLElement>("nav button, nav a, header button, header a"),
  ].filter((element) => /get\s*kicks/i.test(element.textContent ?? ""));
  const getKicks = kicks.find((element) => element.getClientRects().length > 0) ?? kicks[0] ?? null;
  if (getKicks?.parentElement) return { parent: getKicks.parentElement, before: getKicks };
  for (const selector of KICK_ANCHORS) {
    const element = visible<HTMLElement>(selector, doc);
    if (element?.parentElement) return { parent: element.parentElement, before: element };
  }
  for (const selector of KICK_CONTAINERS) {
    const element = visible<HTMLElement>(selector, doc);
    if (element) return { parent: element, before: null };
  }
  return null;
}

function createIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  }))
    svg.setAttribute(name, value);
  for (const [tag, attributes] of SettingsIcon) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    svg.append(node);
  }
  return svg;
}

function createButton(doc: Document, site: Site, open: () => void) {
  const host = doc.createElement("span");
  host.setAttribute(SETTINGS_BUTTON_ATTRIBUTE, site);
  host.style.cssText =
    "all:initial;display:inline-flex;align-items:center;flex:0 0 auto;margin:0 2px";
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent =
    site === "kick"
      ? `
        :host { color: #fafafa; }
        button { all: unset; box-sizing: border-box; display: grid; place-items: center; width: 36px;
          height: 36px; border-radius: 8px; background: #27272a; color: inherit; cursor: pointer;
          transition: background-color .12s; }
        button:hover { background: #3f3f46; }
        button:focus-visible { outline: 2px solid #53fc18; outline-offset: 2px; }
      `
      : `
        :host { color: inherit; }
        button { all: unset; box-sizing: border-box; display: grid; place-items: center; width: 30px;
          height: 30px; border-radius: 6px; color: inherit; cursor: pointer; transition: background-color .12s; }
        button:hover { background: #ffffff1a; }
        button:focus-visible { outline: 2px solid #a970ff; outline-offset: 2px; }
      `;
  const button = doc.createElement("button");
  button.type = "button";
  button.title = "Image Uploader settings";
  button.setAttribute("aria-label", "Image Uploader settings");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.append(createIcon(doc));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  root.append(style, button);
  return { host, button };
}

function toggleRow(
  doc: Document,
  title: string,
  description: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
) {
  const row = doc.createElement("label");
  row.className = "row";
  const copy = doc.createElement("span");
  copy.className = "copy";
  const label = doc.createElement("strong");
  label.textContent = title;
  const hint = doc.createElement("small");
  hint.textContent = description;
  copy.append(label, hint);
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.className = "switch";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  row.append(copy, input);
  return { row, input };
}

function buildPanel(doc: Document, settings: SettingsController) {
  const host = doc.createElement("div");
  host.setAttribute(SETTINGS_PANEL_ATTRIBUTE, "");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:0;top:0";
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = `
    :host { color-scheme: dark; }
    * { box-sizing: border-box; }
    .card { width: 336px; max-width: calc(100vw - 16px); padding: 14px;
      background: #18181b; color: #fafafa; border: 1px solid #3f3f46; border-radius: 10px;
      box-shadow: 0 12px 36px #0008; font: 13px/1.45 system-ui, sans-serif; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-bottom: 4px; }
    header strong { font-size: 14px; font-weight: 600; }
    button.close { display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
      border: 0; border-radius: 6px; background: transparent; color: #a1a1aa; font: 20px/1 inherit;
      cursor: pointer; }
    button.close:hover { background: #27272a; color: #fafafa; }
    button.close:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
    .row { display: flex; align-items: center; gap: 12px; padding: 9px 0;
      border-top: 1px solid #ffffff14; cursor: pointer; }
    .copy { display: flex; flex: 1; flex-direction: column; gap: 1px; min-width: 0; }
    .copy strong { font-size: 13px; font-weight: 500; }
    .copy small { color: #a1a1aa; font-size: 11px; line-height: 1.35; }
    .switch { appearance: none; flex: 0 0 auto; width: 34px; height: 20px; margin: 0;
      border-radius: 999px; background: #3f3f46; cursor: pointer; position: relative;
      transition: background-color .15s; }
    .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
      border-radius: 50%; background: #fafafa; transition: transform .15s; }
    .switch:checked { background: #9147ff; }
    .switch:checked::after { transform: translateX(14px); }
    .switch:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
    fieldset { margin: 0; padding: 9px 0 2px; border: 0; border-top: 1px solid #ffffff14; }
    legend { padding: 0; margin-bottom: 6px; font-size: 13px; font-weight: 500; }
    .choices { display: flex; flex-wrap: wrap; gap: 6px 16px; }
    .choices label { display: flex; align-items: center; gap: 6px; color: #d4d4d8;
      font-size: 12px; cursor: pointer; }
    .choices input { accent-color: #9147ff; margin: 0; }
    .note { margin: 9px 0 0; color: #71717a; font-size: 11px; }
    @media (prefers-reduced-motion: reduce) {
      .switch, .switch::after { transition: none; }
    }
  `;
  const card = doc.createElement("section");
  card.className = "card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Image Uploader settings");
  card.addEventListener("click", (event) => event.stopPropagation());

  const header = doc.createElement("header");
  const title = doc.createElement("strong");
  title.textContent = "Image Uploader";
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close settings");
  header.append(title, closeButton);

  const previews = toggleRow(
    doc,
    "Preview links in chat",
    "Show image thumbnails below messages with links.",
    settings.get().chatPreviews,
    (checked) => settings.update({ chatPreviews: checked }),
  );
  const autoInsert = toggleRow(
    doc,
    "Insert the link into chat automatically",
    "Adds the link to your unsent message when the upload finishes. This notification closes after 3 seconds.",
    settings.get().autoInsert,
    (checked) => settings.update({ autoInsert: checked }),
  );

  const fieldset = doc.createElement("fieldset");
  const legend = doc.createElement("legend");
  legend.textContent = "Clicking a chat preview";
  const choices = doc.createElement("div");
  choices.className = "choices";
  const radios: HTMLInputElement[] = [];
  for (const [value, labelText] of [
    ["viewer", "Open viewer"],
    ["site", "Open website"],
  ] as const) {
    const label = doc.createElement("label");
    const input = doc.createElement("input");
    input.type = "radio";
    input.name = "preview-click";
    input.value = value;
    input.checked = settings.get().previewClick === value;
    input.addEventListener("change", () => {
      if (input.checked) settings.update({ previewClick: value });
    });
    radios.push(input);
    label.append(input, doc.createTextNode(labelText));
    choices.append(label);
  }
  fieldset.append(legend, choices);

  const note = doc.createElement("p");
  note.className = "note";
  note.textContent = "Settings are saved in this browser.";

  card.append(header, previews.row, autoInsert.row, fieldset, note);
  root.append(style, card);

  const sync = (next: Settings) => {
    previews.input.checked = next.chatPreviews;
    autoInsert.input.checked = next.autoInsert;
    for (const radio of radios) radio.checked = next.previewClick === radio.value;
  };

  return { host, card, closeButton, firstInput: previews.input, sync };
}

function mount(doc: Document, site: Site, settings: SettingsController) {
  let buttonHost: HTMLElement | null = null;
  let button: HTMLButtonElement | null = null;
  let panel: ReturnType<typeof buildPanel> | null = null;
  let closePanel: (restoreFocus?: boolean) => void = () => {};

  const inject = () => {
    if (buttonHost?.isConnected) return;
    const anchor = findAnchor(doc, site);
    if (!anchor) return;
    buttonHost?.remove();
    const created = createButton(doc, site, toggle);
    buttonHost = created.host;
    button = created.button;
    if (panel) button.setAttribute("aria-expanded", "true");
    anchor.parent.insertBefore(buttonHost, anchor.before);
  };

  function toggle() {
    if (panel) {
      closePanel();
      return;
    }
    const view = doc.defaultView;
    if (!view || !buttonHost || !button) return;
    const created = buildPanel(doc, settings);
    panel = created;
    const { host, closeButton, firstInput } = created;

    const setExpanded = (expanded: boolean) =>
      button?.setAttribute("aria-expanded", String(expanded));
    let closed = false;
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (path.includes(host) || (buttonHost && path.includes(buttonHost))) return;
      closePanel(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    };
    const place = () => {
      if (!buttonHost?.isConnected) {
        closePanel(false);
        return;
      }
      const rect = buttonHost.getBoundingClientRect();
      const width = host.offsetWidth;
      const height = host.offsetHeight;
      const margin = 8;
      let left = rect.right - width;
      left = Math.min(Math.max(margin, left), Math.max(margin, view.innerWidth - width - margin));
      let top = rect.bottom + 6;
      if (top + height > view.innerHeight - margin) top = Math.max(margin, rect.top - height - 6);
      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(top)}px`;
    };
    const unsubscribe = settings.subscribe(created.sync);
    closePanel = (restoreFocus = true) => {
      if (closed) return;
      closed = true;
      unsubscribe();
      view.removeEventListener("resize", place);
      doc.removeEventListener("scroll", place, true);
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("keydown", keys, true);
      host.remove();
      panel = null;
      setExpanded(false);
      if (restoreFocus && button?.isConnected) button.focus({ preventScroll: true });
    };

    doc.documentElement.append(host);
    setExpanded(true);
    place();
    view.addEventListener("resize", place);
    doc.addEventListener("scroll", place, true);
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", keys, true);
    closeButton.addEventListener("click", () => closePanel());
    firstInput.focus({ preventScroll: true });
  }

  inject();
  const view = doc.defaultView;
  const ensureVisible = () => {
    if (buttonHost?.isConnected && buttonHost.getClientRects().length > 0) return;
    buttonHost?.remove();
    inject();
  };
  view?.addEventListener("load", ensureVisible, { once: true });
  view?.addEventListener("resize", ensureVisible);
  const observer = new MutationObserver(inject);
  observer.observe(doc.documentElement, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    view?.removeEventListener("load", ensureVisible);
    view?.removeEventListener("resize", ensureVisible);
    closePanel(false);
    buttonHost?.remove();
  };
}

export function registerSettingsUi(settings: SettingsController, hostname = location.hostname) {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  try {
    if (window.top !== window) return () => {};
  } catch {
    return () => {};
  }
  const site = siteFor(hostname);
  if (!site) return () => {};
  let dispose = () => {};
  const start = () => {
    dispose = mount(document, site, settings);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
    return () => {
      document.removeEventListener("DOMContentLoaded", start);
      dispose();
    };
  }
  start();
  return () => dispose();
}
