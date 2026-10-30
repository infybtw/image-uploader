export const BRAND_NAME = "Viewer Companion";
export const BRAND_VIEW_BOX = "0 0 32 32";

// Original VC lettering: two solid, forward-cut forms with an open counter.
// Shared by the navigation button and the generated browser icon assets.
export const BRAND_PATH =
  "M1 6H6L10 19L15 6H20L12 26H7ZM24 6H31L29 11H25L21 21H27L25 26H19L16 22L21 9Z";

export function createBrandIcon(doc: Document): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  for (const [name, value] of Object.entries({
    width: "20",
    height: "20",
    viewBox: BRAND_VIEW_BOX,
    fill: "currentColor",
    "aria-hidden": "true",
    focusable: "false",
  }))
    svg.setAttribute(name, value);
  const path = doc.createElementNS(ns, "path");
  path.setAttribute("d", BRAND_PATH);
  svg.append(path);
  return svg;
}
