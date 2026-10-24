import { join } from "node:path";
import { build } from "wxt";
import type { BrowserTarget } from "./manifest";

// Integration tests use the same WXT pipeline, with isolated output directories.
export async function buildExtension(target: BrowserTarget, dist: string) {
  await build({ root: new URL("../", import.meta.url).pathname, browser: target, outDir: dist });
  return join(dist, target);
}
