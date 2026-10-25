import { Undo, Undo2, Redo, Redo2 } from "lucide";
import { createMorph } from "morphicons/dom";
import { errorMessage } from "./shared";
import { imageFitScale } from "./image-viewer";

type Point = { x: number; y: number };
export type CropRect = Point & { width: number; height: number };

export function cropFromPoints(start: Point, end: Point, width: number, height: number): CropRect {
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));
  const x1 = clamp(start.x, width);
  const y1 = clamp(start.y, height);
  const x2 = clamp(end.x, width);
  const y2 = clamp(end.y, height);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

const activeEditors = new WeakMap<Document, () => void>();
const HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 32 * 1024 * 1024;

export function openImageEditor(
  file: File,
  opener: HTMLElement,
  upload: (file: File) => Promise<HTMLElement | void>,
): () => void {
  const owner = opener.ownerDocument;
  if (!owner.body) return () => {};
  activeEditors.get(owner)?.();
  const host = owner.createElement("div");
  host.setAttribute("data-imageuploader-editor", "");
  host.style.cssText = "all:initial";
  const root = host.attachShadow({ mode: "open" });
  const style = owner.createElement("style");
  style.textContent = `
    :host { color-scheme: dark; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none;
      margin: 0; padding: 16px; border: 0; background: transparent; color: #fafafa;
      font: 14px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }
    dialog::backdrop { background: #08080ded; backdrop-filter: blur(5px); }
    header, .actions, .tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    header { justify-content: space-between; }
    header strong { font-weight: 500; }
    button, input { font: inherit; }
    button { min-height: 38px; padding: 7px 12px; border: 1px solid #ffffff20; border-radius: 8px;
      background: #27272a; color: inherit; cursor: pointer; touch-action: manipulation; }
    button:hover:not(:disabled) { background: #3f3f46; }
    button[aria-pressed="true"] { background: #5b21b6; border-color: #a78bfa; }
    button:focus-visible, input:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
    button:disabled, input:disabled { opacity: .4; cursor: default; }
    .primary { background: #6d28d9; }
    .close { font-size: 24px; line-height: 1; padding: 4px 12px; }
    .tools { justify-content: center; padding: 8px; border: 1px solid #ffffff20; border-radius: 12px;
      background: #202024ed; }
    label { display: flex; align-items: center; gap: 6px; color: #d4d4d8; }
    input[type="color"] { width: 36px; height: 32px; padding: 2px; border: 0; background: transparent; cursor: pointer; }
    input[type="range"] { width: 90px; accent-color: #a78bfa; }
    output { min-width: 35px; font-variant-numeric: tabular-nums; }
    .icon-button { display: grid; place-items: center; min-width: 38px; padding: 8px; }
    .stage { position: relative; flex: 1; min-height: 0; display: grid; place-items: center;
      padding-bottom: 64px; overflow: hidden; }
    .surface { position: relative; overflow: hidden; flex-shrink: 0; box-shadow: 0 12px 48px #0006;
      background: repeating-conic-gradient(#303036 0% 25%, #242428 0% 50%) 0 / 16px 16px; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
    .selection { position: absolute; border: 1px dashed #fff; box-shadow: 0 0 0 100vmax #0009; pointer-events: none; }
    .crop-actions { position: absolute; z-index: 1; display: flex; gap: 6px; padding: 6px;
      border: 1px solid #ffffff30; border-radius: 10px; background: #202024;
      box-shadow: 0 6px 24px #0006; white-space: nowrap; }
    footer { display: grid; gap: 5px; text-align: center; }
    p { margin: 0; color: #a1a1aa; font-size: 12px; }
    .status { color: #d4d4d8; min-height: 20px; font-size: 13px; }
    .status[data-error="true"] { color: #fca5a5; }
    @media (max-width: 600px) {
      dialog { padding: 8px; gap: 8px; }
      .tools { gap: 5px; padding: 5px; }
      button { padding: 6px 8px; min-height: 34px; }
      header { gap: 6px; }
    }
  `;
  const dialog = owner.createElement("dialog");
  dialog.setAttribute("aria-label", "Image editor");
  dialog.setAttribute("aria-modal", "true");
  const header = owner.createElement("header");
  const title = owner.createElement("strong");
  title.textContent = "Image editor";
  const actions = owner.createElement("div");
  actions.className = "actions";
  const tools = owner.createElement("div");
  tools.className = "tools";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Editing tools");
  const stage = owner.createElement("div");
  stage.className = "stage";
  const surface = owner.createElement("div");
  surface.className = "surface";
  surface.hidden = true;
  const canvas = owner.createElement("canvas");
  canvas.setAttribute("aria-label", "Image canvas — drag to draw or select a crop");
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const selection = owner.createElement("div");
  selection.className = "selection";
  selection.hidden = true;
  const cropActions = owner.createElement("div");
  cropActions.className = "crop-actions";
  cropActions.hidden = true;
  cropActions.setAttribute("role", "group");
  cropActions.setAttribute("aria-label", "Crop selection actions");
  surface.append(canvas, selection);
  stage.append(surface, cropActions);
  const footer = owner.createElement("footer");
  const status = owner.createElement("p");
  status.className = "status";
  status.setAttribute("role", "status");
  status.textContent = "Loading image…";
  const hint = owner.createElement("p");
  hint.textContent =
    "Drag to select a crop · Ctrl/Cmd+Z to undo · Esc to close · Upload creates a new public link";
  footer.append(status, hint);
  const controller = new AbortController();
  const { signal } = controller;
  let closed = false;
  let loaded = false;
  let uploading = false;
  let tool: "crop" | "draw" = "crop";
  let crop: CropRect | undefined;
  let gesture: { id: number; start: Point; last: Point } | undefined;
  let original: HTMLCanvasElement | undefined;
  let focusTarget = opener;
  const undo: HTMLCanvasElement[] = [];
  const redo: HTMLCanvasElement[] = [];
  const historyMorphs: ReturnType<typeof createMorph>[] = [];
  const source = URL.createObjectURL(file);
  const pageStyle = owner.documentElement.style;
  const previousOverflow = pageStyle.getPropertyValue("overflow");
  const previousPriority = pageStyle.getPropertyPriority("overflow");
  const releaseCanvas = (image: HTMLCanvasElement) => {
    image.width = image.height = 0;
  };
  const clearHistory = (history: HTMLCanvasElement[]) => {
    for (const image of history) releaseCanvas(image);
    history.length = 0;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    for (const morph of historyMorphs) morph.destroy();
    resize.disconnect();
    URL.revokeObjectURL(source);
    clearHistory(undo);
    clearHistory(redo);
    if (original) releaseCanvas(original);
    releaseCanvas(canvas);
    if (dialog.open) dialog.close();
    host.remove();
    activeEditors.delete(owner);
    if (pageStyle.getPropertyValue("overflow") === "hidden") {
      if (previousOverflow) pageStyle.setProperty("overflow", previousOverflow, previousPriority);
      else pageStyle.removeProperty("overflow");
    }
    if (focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
  };
  const button = (label: string, action: () => void) => {
    const element = owner.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.addEventListener("click", action, { signal });
    return element;
  };
  const snapshot = () => {
    const copy = owner.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d");
    if (!ctx) throw new Error("Could not create an image snapshot.");
    ctx.drawImage(canvas, 0, 0);
    return copy;
  };
  const trimHistory = () => {
    let bytes = [...undo, ...redo].reduce(
      (total, image) => total + image.width * image.height * 4,
      0,
    );
    while (undo.length > 1 && (bytes > HISTORY_BYTES || undo.length > 12)) {
      const oldest = undo.shift()!;
      bytes -= oldest.width * oldest.height * 4;
      releaseCanvas(oldest);
    }
  };
  const remember = () => {
    clearHistory(redo);
    undo.push(snapshot());
    trimHistory();
  };
  const message = (text: string, error = false) => {
    status.textContent = text;
    status.dataset.error = String(error);
  };
  const fit = () => {
    if (!loaded) return;
    const scale = imageFitScale(
      canvas.width,
      canvas.height,
      stage.clientWidth,
      stage.clientHeight - 64,
    );
    surface.style.width = `${canvas.width * scale}px`;
    surface.style.height = `${canvas.height * scale}px`;
    if (crop && !cropActions.hidden) {
      const stageRect = stage.getBoundingClientRect();
      const imageRect = canvas.getBoundingClientRect();
      const center = imageRect.left - stageRect.left + (crop.x + crop.width / 2) * scale;
      const bottom = imageRect.top - stageRect.top + (crop.y + crop.height) * scale;
      cropActions.style.left = `${Math.max(8, Math.min(stage.clientWidth - cropActions.offsetWidth - 8, center - cropActions.offsetWidth / 2))}px`;
      cropActions.style.top = `${Math.max(0, Math.min(stage.clientHeight - cropActions.offsetHeight - 8, bottom + 8))}px`;
    }
  };
  const update = () => {
    const disabled = !loaded || uploading || !!gesture;
    for (const control of tools.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      "button, input",
    ))
      control.disabled = disabled;
    undoButton.disabled = disabled || !undo.length;
    redoButton.disabled = disabled || !redo.length;
    applyCrop.disabled = disabled || !crop || crop.width < 1 || crop.height < 1;
    cancelCrop.disabled = disabled;
    cropActions.hidden = disabled || !crop || crop.width < 1 || crop.height < 1;
    save.disabled = disabled;
    save.textContent = uploading ? "Uploading…" : "Upload edited image";
    cropButton.setAttribute("aria-pressed", String(tool === "crop"));
    drawButton.setAttribute("aria-pressed", String(tool === "draw"));
    color.disabled = thickness.disabled = disabled || tool !== "draw";
    selection.hidden = !crop;
    if (crop) {
      selection.style.left = `${(crop.x / canvas.width) * 100}%`;
      selection.style.top = `${(crop.y / canvas.height) * 100}%`;
      selection.style.width = `${(crop.width / canvas.width) * 100}%`;
      selection.style.height = `${(crop.height / canvas.height) * 100}%`;
    }
    fit();
  };
  const restore = (image: HTMLCanvasElement) => {
    canvas.width = image.width;
    canvas.height = image.height;
    context.drawImage(image, 0, 0);
    crop = undefined;
    update();
    message(`${canvas.width} × ${canvas.height} · Edits are local until you upload.`);
  };
  const changeTool = (next: typeof tool) => {
    tool = next;
    crop = undefined;
    hint.textContent =
      tool === "crop"
        ? "Drag to select a crop · Apply or Cancel below the selection · Ctrl/Cmd+Z to undo"
        : "Drag to draw · Choose a color and brush size · Ctrl/Cmd+Z to undo";
    update();
  };
  const cropButton = button("Crop", () => changeTool("crop"));
  const drawButton = button("Draw", () => changeTool("draw"));
  const applyCrop = button("Apply", () => {
    if (!crop || !crop.width || !crop.height) return;
    const rect = crop;
    remember();
    const before = undo[undo.length - 1]!;
    canvas.width = rect.width;
    canvas.height = rect.height;
    context.drawImage(
      before,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
    crop = undefined;
    update();
    message(`${canvas.width} × ${canvas.height} · Crop applied.`);
    cropButton.focus({ preventScroll: true });
  });
  applyCrop.className = "primary";
  applyCrop.setAttribute("aria-label", "Apply crop");
  const cancelCrop = button("Cancel", () => {
    crop = undefined;
    update();
    message("Crop selection cancelled. Your image is unchanged.");
    cropButton.focus({ preventScroll: true });
  });
  cancelCrop.setAttribute("aria-label", "Cancel crop");
  cropActions.append(applyCrop, cancelCrop);
  const colorLabel = owner.createElement("label");
  colorLabel.textContent = "Color";
  const color = owner.createElement("input");
  color.type = "color";
  color.value = "#ff4444";
  colorLabel.append(color);
  const sizeLabel = owner.createElement("label");
  sizeLabel.textContent = "Brush";
  const thickness = owner.createElement("input");
  thickness.type = "range";
  thickness.min = "1";
  thickness.max = "80";
  thickness.value = "6";
  const sizeOutput = owner.createElement("output");
  sizeOutput.textContent = "6 px";
  thickness.addEventListener(
    "input",
    () => {
      sizeOutput.textContent = `${thickness.value} px`;
    },
    { signal },
  );
  sizeLabel.append(thickness, sizeOutput);
  const transform = (rotate: boolean) => {
    remember();
    const before = undo[undo.length - 1]!;
    canvas.width = rotate ? before.height : before.width;
    canvas.height = rotate ? before.width : before.height;
    context.save();
    if (rotate) {
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
    } else {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(before, 0, 0);
    context.restore();
    crop = undefined;
    update();
  };
  const moveHistory = (from: HTMLCanvasElement[], to: HTMLCanvasElement[]) => {
    if (!loaded || uploading || gesture || !from.length) return;
    to.push(snapshot());
    const image = from.pop()!;
    restore(image);
    releaseCanvas(image);
    trimHistory();
  };
  const historyButton = (
    label: string,
    icon: typeof Undo,
    activeIcon: typeof Undo,
    action: () => void,
  ) => {
    const element = button("", () => {
      action();
      morph.set(activeIcon);
      morph.morphTo(icon, "snappy");
    });
    element.className = "icon-button";
    element.setAttribute("aria-label", label);
    element.title = label;
    const svg = owner.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({
      width: "20",
      height: "20",
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
    const path = owner.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.append(path);
    element.append(svg);
    const morph = createMorph(path, icon, { reducedMotion: "user", strokeWidth: 2 });
    historyMorphs.push(morph);
    for (const event of ["pointerenter", "focus"])
      element.addEventListener(
        event,
        () => {
          if (!element.disabled) morph.morphTo(activeIcon, "snappy");
        },
        { signal },
      );
    for (const event of ["pointerleave", "blur"])
      element.addEventListener(event, () => morph.morphTo(icon, "snappy"), { signal });
    return element;
  };
  const undoButton = historyButton("Undo", Undo2, Undo, () => moveHistory(undo, redo));
  const redoButton = historyButton("Redo", Redo2, Redo, () => moveHistory(redo, undo));
  const resetButton = button("Reset", () => {
    if (!original) return;
    remember();
    restore(original);
  });
  tools.append(
    cropButton,
    drawButton,
    colorLabel,
    sizeLabel,
    button("Rotate ↻", () => transform(true)),
    button("Flip ↔", () => transform(false)),
    undoButton,
    redoButton,
    resetButton,
  );
  const save = button("Upload edited image", () => {
    if (!loaded || uploading || gesture) return;
    if (crop) {
      message("Apply the crop first, or Cancel below the selection to discard it.", true);
      return;
    }
    uploading = true;
    update();
    message("Uploading… The edited image will be accessible via a new public link.");
    void (async () => {
      try {
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) =>
              result ? resolve(result) : reject(new Error("Could not export this image.")),
            "image/png",
          );
        });
        if (closed) return;
        const nextOpener = await upload(
          new File([blob], "edited-image.png", { type: "image/png" }),
        );
        if (nextOpener) focusTarget = nextOpener;
        if (!closed) close();
      } catch (error) {
        if (!closed)
          message(
            `Upload failed: ${errorMessage(error)} Your edits are still here; try again.`,
            true,
          );
      } finally {
        uploading = false;
        if (!closed) update();
      }
    })();
  });
  save.className = "primary";
  const closeButton = button("×", close);
  closeButton.className = "close";
  closeButton.setAttribute("aria-label", "Close image editor");
  actions.append(save, closeButton);
  header.append(title, actions);
  dialog.append(header, tools, stage, footer);
  root.append(style, dialog);
  const resize = new ResizeObserver(fit);
  resize.observe(stage);
  const point = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(canvas.width, ((event.clientX - rect.left) * canvas.width) / rect.width),
      ),
      y: Math.max(
        0,
        Math.min(canvas.height, ((event.clientY - rect.top) * canvas.height) / rect.height),
      ),
    };
  };
  const draw = (from: Point, to: Point) => {
    context.strokeStyle = context.fillStyle = color.value;
    context.lineWidth = Number(thickness.value);
    context.lineCap = context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.beginPath();
    context.arc(to.x, to.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  };
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (!loaded || uploading || gesture || event.button !== 0) return;
      event.preventDefault();
      const start = point(event);
      if (tool === "draw") {
        remember();
        draw(start, start);
      } else crop = undefined;
      gesture = { id: event.pointerId, start, last: start };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer already released. */
      }
      update();
    },
    { signal },
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const next = point(event);
      if (tool === "draw") draw(gesture.last, next);
      else crop = cropFromPoints(gesture.start, next, canvas.width, canvas.height);
      gesture.last = next;
      update();
    },
    { signal },
  );
  const release = (event: PointerEvent) => {
    if (gesture?.id !== event.pointerId) return;
    if (event.type === "pointerup") {
      const next = point(event);
      if (tool === "draw") draw(gesture.last, next);
      else crop = cropFromPoints(gesture.start, next, canvas.width, canvas.height);
    }
    gesture = undefined;
    if (crop && (!crop.width || !crop.height)) crop = undefined;
    update();
  };
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const)
    canvas.addEventListener(name, release, { signal });
  dialog.addEventListener(
    "keydown",
    (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.shiftKey || event.key.toLowerCase() === "y") moveHistory(redo, undo);
        else moveHistory(undo, redo);
      } else if (event.key === "Tab") {
        const controls = [
          ...dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
            "button:not(:disabled), input:not(:disabled)",
          ),
        ].filter((control) => !control.closest("[hidden]"));
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (event.shiftKey && root.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && root.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    { signal },
  );
  dialog.addEventListener("click", (event) => event.stopPropagation(), { signal });
  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      close();
    },
    { signal },
  );
  dialog.addEventListener("close", close, { signal });
  const image = owner.createElement("img");
  image.addEventListener(
    "load",
    () => {
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > MAX_PIXELS) {
        message(
          "This image is too large to edit (maximum 32 megapixels). The original link is unchanged.",
          true,
        );
        return;
      }
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);
      original = snapshot();
      loaded = true;
      surface.hidden = false;
      update();
      message(
        `${canvas.width} × ${canvas.height} · Edits are local until you upload.${file.type === "image/gif" ? " Animated GIFs are saved as a still PNG." : ""}`,
      );
    },
    { signal, once: true },
  );
  image.addEventListener(
    "error",
    () => message("Could not load this image. The original link is unchanged.", true),
    { signal, once: true },
  );
  owner.body.append(host);
  activeEditors.set(owner, close);
  pageStyle.setProperty("overflow", "hidden");
  update();
  dialog.showModal();
  closeButton.focus({ preventScroll: true });
  image.src = source;
  return close;
}
