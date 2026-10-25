import { openImageEditor } from "../../src/image-editor";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("editor state timed out");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
}

function editor() {
  const host = document.querySelector<HTMLElement>("[data-imageuploader-editor]");
  assert(host?.shadowRoot, "editor overlay missing");
  const root = host.shadowRoot;
  const canvas = root.querySelector("canvas")!;
  const dialog = root.querySelector("dialog")!;
  const button = (text: string) =>
    [...root.querySelectorAll("button")].find(
      (element) => element.getAttribute("aria-label") === text || element.textContent === text,
    )!;
  const pixel = (x: number, y: number) =>
    [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data].join(",");
  const drag = (x1: number, y1: number, x2: number, y2: number) => {
    const rect = canvas.getBoundingClientRect();
    for (const [type, x, y] of [
      ["pointerdown", x1, y1],
      ["pointermove", x2, y2],
      ["pointerup", x2, y2],
    ] as const) {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: rect.left + (x * rect.width) / canvas.width,
          clientY: rect.top + (y * rect.height) / canvas.height,
        }),
      );
    }
  };
  return { host, root, canvas, dialog, button, pixel, drag };
}

export async function editorFixture() {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 60;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#112233";
  ctx.fillRect(0, 0, 50, 60);
  ctx.fillStyle = "#aabbcc";
  ctx.fillRect(50, 0, 50, 60);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((result) => resolve(result!), "image/png"),
  );
  return new File([blob], "original.png", { type: "image/png" });
}

export async function checkImageEditor(check: Check) {
  const file = await editorFixture();
  const opener = document.createElement("button");
  opener.textContent = "Edit image";
  document.body.append(opener);
  try {
    await check(
      "image editor is a focused top-layer overlay and cancel never uploads",
      async () => {
        let uploads = 0;
        const style = document.documentElement.style;
        const overflow = style.overflow;
        const close = openImageEditor(file, opener, async () => {
          uploads++;
        });
        try {
          const ui = editor();
          assert(
            ui.dialog.matches(":modal") && style.overflow === "hidden",
            "not a scroll-locking modal",
          );
          assert(ui.root.activeElement === ui.button("×"), "editor not focused");
          await waitFor(() => !ui.button("Upload edited image").disabled);
          ui.dialog.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          );
          assert(
            !ui.host.isConnected && document.activeElement === opener,
            "close did not restore focus",
          );
          assert(
            style.overflow === overflow && uploads === 0,
            "cancel uploaded or left scroll lock",
          );
        } finally {
          close();
        }
      },
    );

    await check(
      "editor crops original pixels, draws, transforms and supports undo/redo/reset",
      async () => {
        const close = openImageEditor(file, opener, async () => {});
        try {
          const ui = editor();
          await waitFor(() => !ui.button("Upload edited image").disabled);
          assert(
            ui.canvas.width === 100 && ui.pixel(10, 10) === "17,34,51,255",
            "original pixels lost",
          );
          ui.drag(10, 10, 90, 50);
          ui.button("Apply crop").click();
          assert(
            Number(ui.canvas.width) === 80 && ui.canvas.height === 40,
            "crop used CSS rather than image pixels",
          );
          ui.button("Undo").click();
          assert(Number(ui.canvas.width) === 100, "crop undo failed");
          ui.button("Redo").click();
          assert(Number(ui.canvas.width) === 80, "crop redo failed");
          ui.button("Draw").click();
          ui.drag(10, 20, 30, 20);
          assert(ui.pixel(20, 20) === "255,68,68,255", "brush did not paint selected color");
          ui.dialog.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "z",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          assert(ui.pixel(20, 20) === "17,34,51,255", "stroke undo failed");
          ui.button("Flip ↔").click();
          assert(ui.pixel(10, 10) === "170,187,204,255", "flip failed");
          ui.button("Rotate ↻").click();
          assert(
            Number(ui.canvas.width) === 40 && Number(ui.canvas.height) === 80,
            "rotate failed",
          );
          ui.button("Reset").click();
          assert(
            Number(ui.canvas.width) === 100 && Number(ui.canvas.height) === 60,
            "reset lost original dimensions",
          );
          assert(ui.pixel(10, 10) === "17,34,51,255", "reset lost original pixels");
        } finally {
          close();
        }
      },
    );

    await check(
      "crop Apply/Cancel follow the selection, stay visible at edges, and cancel preserves edits",
      async () => {
        const close = openImageEditor(file, opener, async () => {});
        try {
          const ui = editor();
          await waitFor(() => !ui.button("Upload edited image").disabled);
          const actions = ui.root.querySelector<HTMLElement>(".crop-actions")!;
          const stage = ui.root.querySelector<HTMLElement>(".stage")!;
          assert(actions.hidden, "crop actions visible without a selection");
          assert(
            !ui.root.querySelector(".tools")!.contains(ui.button("Apply crop")),
            "Apply still in toolbar",
          );
          ui.button("Draw").click();
          ui.drag(10, 20, 30, 20);
          const drawn = ui.pixel(20, 20);
          ui.button("Crop").click();
          ui.drag(10, 10, 90, 50);
          assert(
            !actions.hidden && actions.parentElement === stage,
            "crop actions missing or clipped inside image",
          );
          const selection = ui.root
            .querySelector<HTMLElement>(".selection")!
            .getBoundingClientRect();
          const toolbar = actions.getBoundingClientRect();
          assert(
            toolbar.top >= selection.bottom && toolbar.top - selection.bottom <= 9,
            "actions not just below crop",
          );
          assert(
            Math.abs(toolbar.left + toolbar.width / 2 - selection.left - selection.width / 2) < 1,
            "actions not centered under crop",
          );
          ui.button("Cancel crop").click();
          assert(
            actions.hidden && ui.host.isConnected,
            "Cancel closed editor or retained crop actions",
          );
          assert(
            ui.canvas.width === 100 && ui.pixel(20, 20) === drawn,
            "Cancel discarded other edits",
          );
          assert(ui.root.activeElement === ui.button("Crop"), "focus left on hidden Cancel");
          ui.button("Undo").click();
          assert(ui.pixel(20, 20) === "17,34,51,255", "cancel polluted undo history");
          stage.style.cssText = "flex:none;align-self:center;width:220px;height:220px";
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          for (const x of [0, 98]) {
            ui.drag(x, 58, x + 2, 60);
            const bounds = stage.getBoundingClientRect();
            const controls = actions.getBoundingClientRect();
            const cropBottom = ui.root.querySelector(".selection")!.getBoundingClientRect().bottom;
            assert(
              controls.left >= bounds.left && controls.right <= bounds.right,
              "actions clipped at side edge",
            );
            assert(
              controls.top >= cropBottom && controls.bottom <= bounds.bottom,
              "actions clipped below crop",
            );
          }
          ui.button("Apply crop").click();
          assert(
            actions.hidden && Number(ui.canvas.width) === 2,
            "Apply did not hide actions or crop",
          );
          assert(ui.root.activeElement === ui.button("Crop"), "focus left on hidden Apply");
        } finally {
          close();
        }
      },
    );

    await check("Undo/Redo use accessible Morphicons SVGs animated on interaction", async () => {
      const close = openImageEditor(file, opener, async () => {});
      try {
        const ui = editor();
        await waitFor(() => !ui.button("Upload edited image").disabled);
        for (const label of ["Undo", "Redo"]) {
          const button = ui.button(label);
          assert(
            button.textContent === "" && button.title === label,
            "history button is not an accessible icon",
          );
          assert(
            button.querySelector("svg")?.getAttribute("aria-hidden") === "true",
            "decorative SVG exposed to assistive tech",
          );
          assert(button.querySelector("path")?.getAttribute("d"), "Morphicons path missing");
        }
        ui.drag(10, 10, 90, 50);
        ui.button("Apply crop").click();
        const undo = ui.button("Undo");
        const path = undo.querySelector("path")!;
        const initial = path.getAttribute("d");
        undo.dispatchEvent(new Event("pointerenter"));
        await waitFor(() => path.getAttribute("d") !== initial);
        undo.click();
        assert(Number(ui.canvas.width) === 100, "animated Undo did not undo");
        const redo = ui.button("Redo");
        const redoPath = redo.querySelector("path")!;
        const redoInitial = redoPath.getAttribute("d");
        redo.dispatchEvent(new Event("focus"));
        await waitFor(() => redoPath.getAttribute("d") !== redoInitial);
        redo.click();
        assert(Number(ui.canvas.width) === 80, "animated Redo did not redo");
      } finally {
        close();
      }
    });

    await check(
      "failed edited uploads preserve edits; retry exports PNG and closes only on success",
      async () => {
        let fail = true;
        let uploaded: File | undefined;
        const close = openImageEditor(file, opener, async (result) => {
          if (fail) throw new Error("Network offline");
          uploaded = result;
        });
        try {
          const ui = editor();
          await waitFor(() => !ui.button("Upload edited image").disabled);
          ui.drag(10, 10, 90, 50);
          ui.button("Upload edited image").click();
          assert(
            ui.root.querySelector(".status")!.textContent!.includes("Apply the crop"),
            "pending crop silently discarded",
          );
          ui.button("Apply crop").click();
          ui.button("Upload edited image").click();
          assert(
            ui.button("Uploading…").disabled && ui.button("Reset").disabled,
            "duplicate edits/uploads allowed",
          );
          await waitFor(() =>
            ui.root.querySelector(".status")!.textContent!.includes("Network offline"),
          );
          assert(ui.host.isConnected && ui.canvas.width === 80, "failure discarded edits");
          fail = false;
          ui.button("Upload edited image").click();
          await waitFor(() => !ui.host.isConnected);
          assert(uploaded?.type === "image/png" && uploaded.size > 0, "edited PNG not uploaded");
          const payload = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(uploaded!);
          });
          assert(payload.startsWith("data:image/png;base64,"), "export is not a readable image");
        } finally {
          close();
        }
      },
    );

    await check("replacing and closing an editor cleans up old overlays", async () => {
      const closeFirst = openImageEditor(file, opener, async () => {});
      const first = editor();
      const closeSecond = openImageEditor(file, opener, async () => {});
      try {
        const second = editor();
        assert(!first.host.isConnected && second.host.isConnected, "multiple editors left open");
        closeFirst();
        assert(second.host.isConnected, "stale close dismissed current editor");
        second.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        assert(!second.host.isConnected, "dialog cancel ignored");
      } finally {
        closeFirst();
        closeSecond();
      }
    });
  } finally {
    opener.remove();
  }
}
