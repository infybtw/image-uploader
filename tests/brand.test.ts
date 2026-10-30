import { expect, test } from "bun:test";
import { BRAND_NAME, BRAND_PATH, BRAND_VIEW_BOX } from "../src/brand";
import manifest from "../extension/manifest.json";
import { parseSettingsBackup } from "../src/settings-transfer";
import { DEFAULT_SETTINGS } from "../src/settings";

test("Viewer Companion branding matches the extension metadata and SVG assets", async () => {
  expect(manifest.name).toBe(BRAND_NAME);
  for (const name of ["icon", "theme"]) {
    const svg = await Bun.file(new URL(`../public/icon/${name}.svg`, import.meta.url)).text();
    expect(svg).toContain(`viewBox="${BRAND_VIEW_BOX}"`);
    expect(svg).toContain(`d="${BRAND_PATH}"`);
  }
});

test("all browser icon sizes ship as square PNG files", async () => {
  for (const size of [16, 32, 48, 96, 128]) {
    const bytes = Buffer.from(
      await Bun.file(new URL(`../public/icon/${size}.png`, import.meta.url)).arrayBuffer(),
    );
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
});

test("the rebrand still imports legacy ImageUploader backups", () => {
  expect(
    parseSettingsBackup(
      JSON.stringify({ format: "imageuploader-settings", version: 1, settings: DEFAULT_SETTINGS }),
    ),
  ).toEqual({ ok: true, settings: DEFAULT_SETTINGS });
});
