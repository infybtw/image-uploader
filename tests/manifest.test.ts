import { expect, test } from "bun:test";
import manifest from "../extension/manifest.json";

test("extension access is limited to Twitch, Kick and the Twir uploader", () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.host_permissions).toEqual(["https://twir.app/*"]);
  expect(manifest.content_scripts[0]!.matches).toEqual(["https://*.twitch.tv/*", "https://*.kick.com/*"]);
  expect("permissions" in manifest).toBe(false); // No tabs, clipboardRead, cookies, or all_urls.
  expect(manifest.background.scripts).toEqual(["background.js"]);
  expect(manifest.browser_specific_settings.gecko.data_collection_permissions.required).toContain("personalCommunications");
});
