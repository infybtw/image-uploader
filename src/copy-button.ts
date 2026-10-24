import { Copy, Check } from "lucide";
import { createMorph } from "morphicons/dom";
import { errorMessage } from "./shared";

type WriteText = (text: string) => Promise<void>;

export function createCopyButton(
  url: string,
  onError: (message: string) => void,
  writeText: WriteText = (text) => navigator.clipboard.writeText(text),
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.dataset.state = "idle";
  const setLabel = (label: string) => {
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  setLabel("Copy link");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
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
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.append(path);
  button.append(svg);
  // Morphicons animates between Lucide icon data; it doesn't ship its own icon set.
  const morph = createMorph(path, Copy, { reducedMotion: "user", strokeWidth: 2 });
  let resetTimer: number | undefined;
  let destroyed = false;

  button.addEventListener("click", async () => {
    if (destroyed || button.disabled) return;
    window.clearTimeout(resetTimer);
    button.disabled = true;
    button.dataset.state = "copying";
    try {
      // Called directly from the click: Firefox permits this without clipboardWrite.
      await writeText(url);
      if (destroyed) return;
      button.dataset.state = "copied";
      setLabel("Copied");
      morph.morphTo(Check, "snappy");
      resetTimer = window.setTimeout(() => {
        button.dataset.state = "idle";
        setLabel("Copy link");
        morph.morphTo(Copy, "snappy");
      }, 2_000);
    } catch (error) {
      if (destroyed) return;
      button.dataset.state = "idle";
      setLabel("Copy link");
      morph.set(Copy);
      onError(`Could not copy the link: ${errorMessage(error)}`);
    } finally {
      if (!destroyed) button.disabled = false;
    }
  });

  return {
    element: button,
    destroy() {
      destroyed = true;
      window.clearTimeout(resetTimer);
      morph.destroy();
    },
  };
}
