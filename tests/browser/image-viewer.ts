import { bindImageViewer, imageFitScale, openImageViewer } from "../../src/image-viewer";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function viewer() {
  const host = document.querySelector<HTMLElement>("[data-imageuploader-viewer]");
  assert(host?.shadowRoot, "image viewer missing");
  const root = host.shadowRoot;
  const dialog = root.querySelector("dialog")!;
  const image = root.querySelector("img")!;
  const stage = root.querySelector<HTMLElement>(".stage")!;
  const button = (label: string) =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { host, root, dialog, image, stage, button };
}

async function loaded(image: HTMLImageElement) {
  // Cached bytes can be available before the viewer's load handler has run.
  if (image.complete && image.naturalWidth && !image.hidden) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("viewer image timed out")), 3000);
    image.addEventListener(
      "load",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        window.clearTimeout(timer);
        reject(new Error("viewer image failed"));
      },
      { once: true },
    );
  });
}

const scaleOf = (image: HTMLImageElement) =>
  Number(image.style.transform.match(/scale\(([^)]+)\)/)?.[1]);
const near = (first: number, second: number) => Math.abs(first - second) < 0.0001;
const pointer = (element: Element, type: string, id: number, x: number, y: number) =>
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerId: id, button: 0, clientX: x, clientY: y }),
  );

export async function checkImageViewer(check: Check) {
  const source = `${location.origin}/viewer-image`;
  await check(
    "thumbnail clicks open a top-layer modal, lock scrolling and restore focus",
    async () => {
      const anchor = document.createElement("a");
      anchor.href = "https://example.com/original-post";
      const thumbnail = document.createElement("img");
      thumbnail.loading = "lazy";
      thumbnail.src = source;
      anchor.append(thumbnail);
      document.body.append(anchor);
      bindImageViewer(anchor, thumbnail);
      anchor.focus();
      const style = document.documentElement.style;
      const overflow = style.getPropertyValue("overflow");
      const priority = style.getPropertyPriority("overflow");
      style.setProperty("overflow", "auto", "important");
      let close = () => {};
      try {
        const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
        assert(!anchor.dispatchEvent(click), "thumbnail navigates instead of opening a viewer");
        const ui = viewer();
        close = () => ui.button("Close image preview").click();
        assert(
          ui.dialog.open && ui.dialog.matches(":modal"),
          "viewer is not in the modal top layer",
        );
        assert(ui.dialog.getAttribute("aria-modal") === "true", "modal not accessible");
        assert(style.overflow === "hidden", "background scrolling not locked");
        assert(ui.root.activeElement === ui.button("Close image preview"), "modal not focused");
        assert(
          ui.image.src === source && ui.image.referrerPolicy === "no-referrer",
          "viewer loads the post or leaks referrer",
        );
        await loaded(ui.image);
        assert(
          !ui.image.hidden && ui.root.querySelector<HTMLElement>(".status")!.hidden,
          "loading state not cleared",
        );
        const fit = imageFitScale(
          ui.image.naturalWidth,
          ui.image.naturalHeight,
          ui.stage.clientWidth,
          ui.stage.clientHeight,
        );
        assert(near(scaleOf(ui.image), fit), "image not fitted on opening");
        const last = ui.button("Actual size");
        last.focus();
        last.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
        );
        assert(ui.root.activeElement === ui.button("Close image preview"), "Tab escaped the modal");
        ui.button("Close image preview").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        assert(ui.root.activeElement === last, "Shift+Tab escaped the modal");
        ui.dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
        assert(
          !ui.host.isConnected && document.activeElement === anchor,
          "Escape did not close and restore focus",
        );
        assert(
          style.getPropertyValue("overflow") === "auto" &&
            style.getPropertyPriority("overflow") === "important",
          "previous scroll style not restored",
        );
      } finally {
        close();
        anchor.remove();
        if (overflow) style.setProperty("overflow", overflow, priority);
        else style.removeProperty("overflow");
      }
    },
  );

  await check(
    "viewer zooms with buttons, wheel and keyboard; zoom stays between fit and 800%",
    async () => {
      const close = openImageViewer(source);
      try {
        const ui = viewer();
        await loaded(ui.image);
        const fit = scaleOf(ui.image);
        ui.button("Zoom in").click();
        assert(scaleOf(ui.image) > fit, "zoom-in button ignored");
        ui.button("Zoom out").click();
        assert(near(scaleOf(ui.image), fit), "zoom-out button ignored");
        const rect = ui.stage.getBoundingClientRect();
        const wheel = (deltaY: number) =>
          ui.stage.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
              bubbles: true,
              cancelable: true,
            }),
          );
        assert(!wheel(-100), "wheel scroll was not consumed");
        assert(scaleOf(ui.image) > fit, "wheel did not zoom");
        wheel(-10000);
        assert(
          scaleOf(ui.image) === 8 && ui.button("Zoom in").disabled,
          "maximum zoom not enforced",
        );
        wheel(10000);
        assert(
          near(scaleOf(ui.image), fit) && ui.button("Zoom out").disabled,
          "minimum zoom not enforced",
        );
        ui.button("Actual size").click();
        assert(
          scaleOf(ui.image) === 1 && ui.root.querySelector("output")!.textContent === "100%",
          "actual size is not 1:1",
        );
        ui.dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }),
        );
        assert(scaleOf(ui.image) > 1, "keyboard zoom ignored");
        ui.dialog.dispatchEvent(
          new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }),
        );
        assert(near(scaleOf(ui.image), fit), "keyboard reset ignored");
        ui.stage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        assert(scaleOf(ui.image) > fit, "double-click zoom ignored");
        ui.button("Fit to screen").click();
        assert(near(scaleOf(ui.image), fit), "fit button ignored");
      } finally {
        close();
      }
    },
  );

  await check(
    "viewer supports bounded dragging and pinch zoom without closing after a drag",
    async () => {
      const close = openImageViewer(source);
      try {
        const ui = viewer();
        await loaded(ui.image);
        ui.button("Actual size").click();
        const before = ui.image.style.transform;
        pointer(ui.stage, "pointerdown", 1, 200, 200);
        pointer(ui.stage, "pointermove", 1, 260, 240);
        pointer(ui.stage, "pointerup", 1, 260, 240);
        assert(ui.image.style.transform !== before, "drag did not pan");
        ui.stage.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 260, clientY: 240 }),
        );
        assert(ui.host.isConnected, "drag closed the modal");
        ui.button("Fit to screen").click();
        const fit = scaleOf(ui.image);
        pointer(ui.stage, "pointerdown", 2, 200, 200);
        pointer(ui.stage, "pointerdown", 3, 300, 200);
        pointer(ui.stage, "pointermove", 3, 400, 200);
        assert(near(scaleOf(ui.image), fit * 2), "pinch did not zoom");
        pointer(ui.stage, "pointerup", 2, 200, 200);
        pointer(ui.stage, "pointerup", 3, 400, 200);
        pointer(ui.stage, "pointerdown", 4, 0, 0);
        pointer(ui.stage, "pointermove", 4, 100000, 100000);
        pointer(ui.stage, "pointerup", 4, 100000, 100000);
        const offsets = ui.image.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!;
        assert(
          Number(offsets[1]) <=
            Math.max(0, (ui.image.naturalWidth * scaleOf(ui.image) - ui.stage.clientWidth) / 2) + 1,
          "image panned out of reach",
        );
        assert(
          Number(offsets[2]) <=
            Math.max(0, (ui.image.naturalHeight * scaleOf(ui.image) - ui.stage.clientHeight) / 2) +
              1,
          "image panned vertically out of reach",
        );
        pointer(ui.stage, "pointerdown", 5, 20, 20);
        pointer(ui.stage, "pointerup", 5, 20, 20);
        ui.stage.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 20 }),
        );
        assert(!ui.host.isConnected, "background click did not close");
      } finally {
        close();
      }
    },
  );

  await check("viewer refits on resize and replacing a viewer leaves a single modal", async () => {
    const closeFirst = openImageViewer(source);
    let closeSecond = () => {};
    try {
      const first = viewer();
      await loaded(first.image);
      first.stage.style.cssText = "right:auto;bottom:auto;width:300px;height:200px";
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const fit = imageFitScale(first.image.naturalWidth, first.image.naturalHeight, 300, 200);
      assert(near(scaleOf(first.image), fit), "resize did not update fit");
      closeSecond = openImageViewer(`${source}?second=1`);
      const second = viewer();
      assert(
        !first.host.isConnected &&
          document.querySelectorAll("[data-imageuploader-viewer]").length === 1,
        "multiple viewers retained",
      );
      closeFirst();
      assert(second.host.isConnected, "stale close dismissed the new viewer");
      second.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      assert(!second.host.isConnected, "native dialog cancel ignored");
    } finally {
      closeFirst();
      closeSecond();
    }
  });

  await check(
    "failed viewer images show an error, and unsafe URLs never open a modal",
    async () => {
      openImageViewer("javascript:alert(1)");
      assert(!document.querySelector("[data-imageuploader-viewer]"), "unsafe viewer URL accepted");
      const close = openImageViewer(`${location.origin}/preview-page`);
      try {
        const ui = viewer();
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("image error timed out")), 3000);
          ui.image.addEventListener(
            "error",
            () => {
              window.clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
        assert(
          ui.image.hidden &&
            ui.root.querySelector(".status")!.textContent!.includes("Could not load"),
          "image error not shown",
        );
        assert(
          ui.button("Zoom in").disabled && ui.button("Zoom out").disabled,
          "broken image zoom enabled",
        );
        ui.button("Close image preview").click();
        assert(!ui.host.isConnected, "failed viewer cannot be closed");
      } finally {
        close();
      }
    },
  );
}
