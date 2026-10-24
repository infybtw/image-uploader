import { mkdir, copyFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const outdir = new URL("dist/", root).pathname;
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/background.ts", "src/content.ts"].map(
    (path) => new URL(path, root).pathname,
  ),
  outdir,
  target: "browser",
  format: "iife",
  splitting: false,
  sourcemap: "none",
  minify: false,
  env: "disable",
});

if (!result.success) throw new AggregateError(result.logs, "Build failed");
await copyFile(new URL("extension/manifest.json", root), new URL("dist/manifest.json", root));
console.log("Extension built in dist/");
