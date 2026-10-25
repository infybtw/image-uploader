import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "./settings";

declare const GM_getValue: ((key: string, fallback?: unknown) => unknown) | undefined;
declare const GM_setValue: ((key: string, value: unknown) => void) | undefined;

export const SETTINGS_KEY = "imageUploaderSettings";

export function createUserscriptSettingsStore(): SettingsStore {
  return {
    load() {
      try {
        if (typeof GM_getValue !== "undefined") {
          const stored = GM_getValue(SETTINGS_KEY, DEFAULT_SETTINGS);
          return typeof stored === "string" ? JSON.parse(stored) : stored;
        }
        const stored = localStorage.getItem(SETTINGS_KEY);
        return stored ? JSON.parse(stored) : DEFAULT_SETTINGS;
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    save(settings: Settings) {
      try {
        if (typeof GM_setValue !== "undefined") GM_setValue(SETTINGS_KEY, settings);
        else localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (error) {
        console.error("[ImageUploader] Could not save settings", error);
      }
    },
  };
}
