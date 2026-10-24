import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildExtension } from "../scripts/build";
import commonManifest from "../extension/manifest.json";
import firefoxSettings from "../extension/firefox.json";
import chromeSettings from "../extension/chrome.json";

test("both browser builds produce self-contained extension directories", async () => {
  const directory = await mkdtemp("/tmp/opencode/imageuploader-build-");
  try {
    for (const target of ["firefox", "chrome"] as const) {
      const outdir = await buildExtension(target, directory);
      expect((await readdir(outdir)).sort()).toEqual([
        "background.js",
        "content-scripts",
        "manifest.json",
      ]);
      const manifest = await Bun.file(join(outdir, "manifest.json")).json();
      const background = await Bun.file(join(outdir, "background.js")).text();
      const content = await Bun.file(join(outdir, "content-scripts/content.js")).text();
      expect(manifest.name).toBe("ImageUploader");
      expect(background).not.toContain("__UPLOAD_TIMEOUT_MS__");
      expect(background).not.toContain("document.");
      expect(background).not.toContain("window.");
      expect(content).not.toContain("execCommand");
      expect(content).not.toContain("captureInsertionPoint");
      if (target === "firefox") {
        expect(manifest).toMatchObject({ ...commonManifest, ...firefoxSettings });
        expect(manifest.background).toEqual({ scripts: ["background.js"] });
        expect(background).toMatch(/60000|6e4/);
      } else {
        expect(manifest).toMatchObject({ ...commonManifest, ...chromeSettings });
        expect(manifest.background).toEqual({ service_worker: "background.js" });
        expect(manifest.minimum_chrome_version).toBe("148");
        expect(manifest.browser_specific_settings).toBeUndefined();
        expect(background).toMatch(/25000|25e3|2\.5e4/);
      }
      expect(manifest.content_scripts).toHaveLength(1);
      expect(manifest.content_scripts[0]).toEqual({
        matches: ["https://*.kick.com/*", "https://*.twitch.tv/*"],
        js: ["content-scripts/content.js"],
        run_at: "document_start",
        all_frames: true,
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
