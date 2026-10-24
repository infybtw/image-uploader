import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { packageExtension } from "../scripts/package";
import manifest from "../extension/manifest.json";

test("WXT packages each browser and includes rebuildable Firefox sources", async () => {
  const directory = await mkdtemp("/tmp/opencode/imageuploader-package-");
  try {
    for (const target of ["firefox", "chrome"] as const) {
      const paths = await packageExtension(target, directory);
      const zip = join(directory, `imageuploader-${target}-${manifest.version}.zip`);
      expect(paths).toContain(zip);
      const entries = unzipSync(await Bun.file(zip).bytes());
      expect(Object.keys(entries).sort()).toEqual([
        "background.js",
        "content-scripts/content.js",
        "manifest.json",
      ]);
      for (const [name, content] of Object.entries(entries)) {
        expect(content).toEqual(await Bun.file(join(directory, target, name)).bytes());
      }
      if (target === "firefox") {
        const sourceZip = join(directory, `imageuploader-${manifest.version}-sources.zip`);
        expect(paths).toContain(sourceZip);
        const sources = unzipSync(await Bun.file(sourceZip).bytes());
        for (const name of [
          "README.md",
          ".gitignore",
          "LICENSE",
          "bun.lock",
          "bunfig.toml",
          "package.json",
          "tsconfig.json",
          "wxt.config.ts",
          "src/entrypoints/content.ts",
          "tests/build.test.ts",
          "tests/package.test.ts",
          "extension/manifest.json",
        ]) {
          expect(sources[name]).toBeDefined();
        }
        expect(Object.keys(sources).some((name) => /^(node_modules|dist|\.wxt)\//.test(name))).toBe(
          false,
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
