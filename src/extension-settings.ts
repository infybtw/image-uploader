import { browser } from "wxt/browser";
import type { Settings, SettingsController, SettingsStore } from "./settings";

export const SETTINGS_KEY = "settings";

export function createExtensionSettingsStore(): SettingsStore {
  return {
    async load() {
      const values = await browser.storage.local.get(SETTINGS_KEY);
      return values[SETTINGS_KEY];
    },
    async save(settings: Settings) {
      await browser.storage.local.set({ [SETTINGS_KEY]: settings });
    },
  };
}

export function watchExtensionSettings(settings: SettingsController) {
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area !== "local" || !(SETTINGS_KEY in changes)) return;
    settings.replace(changes[SETTINGS_KEY]?.newValue);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
