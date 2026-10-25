import { getChatPreviewUrl } from "./shared";

const activeViewers = new WeakMap<Document, () => void>();
const MAX_SCALE = 8;

export function imageFitScale(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(
    1,
    Math.max(1, viewportWidth - 32) / width,
    Math.max(1, viewportHeight - 32) / height,
  );
}

export function clampImageOffset(offset: number, imageSize: number, viewportSize: number): number {
  const limit = Math.max(0, (imageSize - viewportSize) / 2);
  if (!limit) return 0;
  return Math.max(-limit, Math.min(limit, offset));
}

export function openImageViewer(
  source: string,
  opener?: HTMLElement,
  alt = "Image preview",
): () => void {
  const url = getChatPreviewUrl(source);
  if (!url) return () => {};
  const owner = opener?.ownerDocument ?? document;
  const view = owner.defaultView;
  if (!view || !owner.body) return () => {};
  activeViewers.get(owner)?.();
  const previousFocus = opener ?? (owner.activeElement as HTMLElement | null);
  const host = owner.createElement("div");
  host.setAttribute("data-imageuploader-viewer", "");
  host.style.cssText = "all:initial";
  const root = host.attachShadow({ mode: "open" });
  const style = owner.createElement("style");
  style.textContent = `
    :host { color-scheme: dark; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none;
      margin: 0; padding: 0; border: 0; overflow: hidden; background: transparent; color: #fafafa;
      font: 14px/1.4 system-ui, sans-serif; outline: none; }
    dialog::backdrop { background: #08080ded; backdrop-filter: blur(5px); }
    header { position: absolute; inset: 16px 20px auto; display: flex; align-items: center;
      justify-content: space-between; gap: 16px; }
    header strong { font-size: 14px; font-weight: 500; color: #d4d4d8; }
    button { display: inline-grid; place-items: center; flex-shrink: 0; min-width: 40px; height: 40px;
      border: 0; border-radius: 8px; padding: 0 12px; background: transparent; color: inherit;
      font: inherit; cursor: pointer; touch-action: manipulation; }
    button:hover:not(:disabled) { background: #ffffff20; }
    button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
    button:disabled { opacity: .35; cursor: default; }
    .close { background: #27272acc; border: 1px solid #ffffff20; font-size: 26px; }
    .stage { position: absolute; inset: 64px 16px 112px; overflow: hidden; touch-action: none; user-select: none; }
    .stage[data-pannable="true"] { cursor: grab; }
    .stage[data-dragging="true"] { cursor: grabbing; }
    img { position: absolute; left: 50%; top: 50%; display: block; max-width: none; max-height: none;
      transform-origin: center; user-select: none; -webkit-user-drag: none; border-radius: 3px;
      box-shadow: 0 12px 48px #0006; }
    .status { position: absolute; inset: 0; display: grid; place-content: center; margin: 0;
      text-align: center; color: #d4d4d8; pointer-events: none; }
    footer { position: absolute; inset: auto 12px 20px; display: grid; justify-items: center; gap: 10px; }
    .controls { display: flex; align-items: center; gap: 3px; padding: 5px; border: 1px solid #ffffff20;
      border-radius: 14px; background: #202024ed; box-shadow: 0 8px 24px #0004; }
    .zoom { font-size: 22px; }
    output { min-width: 58px; text-align: center; font-variant-numeric: tabular-nums; }
    .divider { width: 1px; height: 22px; background: #ffffff20; margin: 0 5px; }
    .hint { margin: 0; color: #a1a1aa; font-size: 12px; text-align: center; }
    @media (max-width: 480px) {
      header { inset: 12px 12px auto; }
      .stage { inset: 60px 8px 100px; }
      footer { bottom: 12px; }
      button { min-width: 36px; padding: 0 9px; }
      .hint { font-size: 11px; }
    }
  `;
  const dialog = owner.createElement("dialog");
  dialog.setAttribute("aria-label", "Image preview");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-describedby", "viewer-hint");
  const header = owner.createElement("header");
  const title = owner.createElement("strong");
  title.textContent = "Image preview";
  const controls = owner.createElement("div");
  controls.className = "controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Image zoom controls");
  const makeButton = (label: string, text: string, action: () => void) => {
    const button = owner.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = text;
    button.addEventListener("click", action);
    return button;
  };
  let closed = false;
  const controller = new AbortController();
  const { signal } = controller;
  const pageStyle = owner.documentElement.style;
  const previousOverflow = pageStyle.getPropertyValue("overflow");
  const previousPriority = pageStyle.getPropertyPriority("overflow");
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    resize.disconnect();
    if (dialog.open) dialog.close();
    host.remove();
    activeViewers.delete(owner);
    if (pageStyle.getPropertyValue("overflow") === "hidden") {
      if (previousOverflow) pageStyle.setProperty("overflow", previousOverflow, previousPriority);
      else pageStyle.removeProperty("overflow");
    }
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const closeButton = makeButton("Close image preview", "×", close);
  closeButton.className = "close";
  header.append(title, closeButton);
  const stage = owner.createElement("div");
  stage.className = "stage";
  const image = owner.createElement("img");
  image.alt = alt;
  image.draggable = false;
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.hidden = true;
  const status = owner.createElement("p");
  status.className = "status";
  status.setAttribute("role", "status");
  status.textContent = "Loading image…";
  stage.append(image, status);
  let loaded = false;
  let fit = 1;
  let scale = 1;
  let x = 0;
  let y = 0;
  const output = owner.createElement("output");
  output.setAttribute("aria-label", "Zoom level");
  output.textContent = "—";
  const render = () => {
    x = clampImageOffset(x, image.naturalWidth * scale, stage.clientWidth);
    y = clampImageOffset(y, image.naturalHeight * scale, stage.clientHeight);
    image.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    stage.dataset.pannable = String(
      loaded &&
        (image.naturalWidth * scale > stage.clientWidth ||
          image.naturalHeight * scale > stage.clientHeight),
    );
    output.textContent = loaded ? `${Math.round(scale * 100)}%` : "—";
    zoomOut.disabled = !loaded || scale <= fit;
    zoomIn.disabled = !loaded || scale >= MAX_SCALE;
    fitButton.disabled = actualButton.disabled = !loaded;
  };
  const zoomTo = (value: number, clientX?: number, clientY?: number) => {
    if (!loaded) return;
    const next = Math.max(fit, Math.min(MAX_SCALE, value));
    const rect = stage.getBoundingClientRect();
    const anchorX = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const anchorY = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    x = anchorX - (anchorX - x) * (next / scale);
    y = anchorY - (anchorY - y) * (next / scale);
    scale = next;
    render();
  };
  const reset = () => {
    x = y = 0;
    zoomTo(fit);
  };
  const zoomOut = makeButton("Zoom out", "−", () => zoomTo(scale / 1.25));
  const zoomIn = makeButton("Zoom in", "+", () => zoomTo(scale * 1.25));
  zoomOut.className = zoomIn.className = "zoom";
  const fitButton = makeButton("Fit to screen", "Fit", reset);
  const actualButton = makeButton("Actual size", "1:1", () => zoomTo(1));
  const divider = owner.createElement("span");
  divider.className = "divider";
  divider.setAttribute("aria-hidden", "true");
  controls.append(zoomOut, output, zoomIn, divider, fitButton, actualButton);
  const footer = owner.createElement("footer");
  const hint = owner.createElement("p");
  hint.id = "viewer-hint";
  hint.className = "hint";
  hint.textContent = "Scroll or pinch to zoom · Drag to pan · Esc to close";
  footer.append(controls, hint);
  dialog.append(header, stage, footer);
  root.append(style, dialog);
  const updateFit = () => {
    if (!loaded) return;
    const wasFitted = Math.abs(scale - fit) < 0.0001;
    fit = imageFitScale(
      image.naturalWidth,
      image.naturalHeight,
      stage.clientWidth,
      stage.clientHeight,
    );
    if (wasFitted) {
      scale = fit;
      x = y = 0;
    } else scale = Math.max(fit, scale);
    render();
  };
  const resize = new ResizeObserver(updateFit);
  resize.observe(stage);
  image.addEventListener(
    "load",
    () => {
      loaded = true;
      image.hidden = false;
      status.hidden = true;
      image.style.width = `${image.naturalWidth}px`;
      image.style.height = `${image.naturalHeight}px`;
      updateFit();
    },
    { signal },
  );
  image.addEventListener(
    "error",
    () => {
      loaded = false;
      image.hidden = true;
      status.hidden = false;
      status.textContent = "Could not load this image.";
      render();
    },
    { signal },
  );
  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      zoomTo(scale * Math.exp(-event.deltaY * unit * 0.002), event.clientX, event.clientY);
    },
    { passive: false, signal },
  );
  stage.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
      zoomTo(
        Math.abs(scale - fit) < 0.0001 ? Math.max(1, fit * 2) : fit,
        event.clientX,
        event.clientY,
      );
    },
    { signal },
  );
  const pointers = new Map<number, { x: number; y: number }>();
  stage.addEventListener(
    "pointerdown",
    (event) => {
      if (!loaded || event.button !== 0 || pointers.size >= 2) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      stage.dataset.dragging = "true";
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        /* The pointer may already be released. */
      }
    },
    { signal },
  );
  stage.addEventListener(
    "pointermove",
    (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      if (Math.hypot(event.clientX - downX, event.clientY - downY) >= 5 || pointers.size > 1)
        backgroundDown = false;
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
        const nextDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (oldDistance > 0)
          zoomTo(
            (scale * nextDistance) / oldDistance,
            (previous.x + other.x) / 2,
            (previous.y + other.y) / 2,
          );
        x += (event.clientX - previous.x) / 2;
        y += (event.clientY - previous.y) / 2;
      } else {
        x += event.clientX - previous.x;
        y += event.clientY - previous.y;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      render();
    },
    { signal },
  );
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    stage.dataset.dragging = String(pointers.size > 0);
  };
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const)
    stage.addEventListener(name, release, { signal });
  // Only a stationary click on empty space closes; finishing a pan must not dismiss the viewer.
  let backgroundDown = false;
  let downX = 0;
  let downY = 0;
  dialog.addEventListener(
    "pointerdown",
    (event) => {
      backgroundDown =
        event.button === 0 &&
        pointers.size <= 1 &&
        (event.target === stage || event.target === dialog);
      downX = event.clientX;
      downY = event.clientY;
    },
    { signal },
  );
  dialog.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      if (
        backgroundDown &&
        (event.target === stage || event.target === dialog) &&
        Math.hypot(event.clientX - downX, event.clientY - downY) < 5
      )
        close();
      backgroundDown = false;
    },
    { signal },
  );
  dialog.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    { passive: false, signal },
  );
  dialog.addEventListener(
    "keydown",
    (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        const buttons = [...dialog.querySelectorAll("button:not(:disabled)")];
        const first = buttons[0] as HTMLButtonElement;
        const last = buttons[buttons.length - 1] as HTMLButtonElement;
        if (event.shiftKey && root.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && root.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (
        [
          "+",
          "=",
          "-",
          "_",
          "0",
          "1",
          "Home",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key)
      ) {
        event.preventDefault();
        if (["+", "="].includes(event.key)) zoomTo(scale * 1.25);
        else if (["-", "_"].includes(event.key)) zoomTo(scale / 1.25);
        else if (["0", "Home"].includes(event.key)) reset();
        else if (event.key === "1") zoomTo(1);
        else {
          const step = event.shiftKey ? 100 : 40;
          if (event.key === "ArrowLeft") x += step;
          if (event.key === "ArrowRight") x -= step;
          if (event.key === "ArrowUp") y += step;
          if (event.key === "ArrowDown") y -= step;
          render();
        }
      }
    },
    { signal },
  );
  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      close();
    },
    { signal },
  );
  dialog.addEventListener("close", close, { signal });
  owner.body.append(host);
  activeViewers.set(owner, close);
  pageStyle.setProperty("overflow", "hidden");
  render();
  dialog.showModal();
  closeButton.focus({ preventScroll: true });
  image.src = url;
  return close;
}

export function bindImageViewer(preview: HTMLAnchorElement, image: HTMLImageElement) {
  preview.title = "Enlarge image";
  preview.setAttribute("aria-haspopup", "dialog");
  preview.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    event.stopPropagation();
    if (image.getAttribute("src"))
      openImageViewer(image.currentSrc || image.src, preview, image.alt);
  });
}
