import commonManifest from "../extension/manifest.json";
import firefoxSettings from "../extension/firefox.json";
import chromeSettings from "../extension/chrome.json";

export type BrowserTarget = "firefox" | "chrome";

const browserSettings = { firefox: firefoxSettings, chrome: chromeSettings };

export function createManifest<T extends BrowserTarget>(target: T) {
  // Browser settings only add top-level fields; shared metadata lives in one place.
  return structuredClone({ ...commonManifest, ...browserSettings[target] });
}
