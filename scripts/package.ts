import { zip } from "wxt";
import type { BrowserTarget } from "./manifest";

export async function packageExtension(target: BrowserTarget, dist: string) {
  const files = await zip({
    root: new URL("../", import.meta.url).pathname,
    browser: target,
    outDir: dist,
  });
  return files;
}
