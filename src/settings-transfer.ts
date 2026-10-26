import { normalizeSettings, type Settings } from "./settings";

export const SETTINGS_BACKUP_FORMAT = "imageuploader-settings";
export const SETTINGS_BACKUP_VERSION = 1;
export const MAX_SETTINGS_BACKUP_BYTES = 1_000_000;

export interface SettingsBackup {
  format: typeof SETTINGS_BACKUP_FORMAT;
  version: typeof SETTINGS_BACKUP_VERSION;
  exportedAt: string;
  settings: Settings;
}

export type SettingsImport = { ok: true; settings: Settings } | { ok: false; error: string };

export function createSettingsBackup(settings: Settings, exportedAt = new Date()): SettingsBackup {
  return {
    format: SETTINGS_BACKUP_FORMAT,
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    settings: { ...settings },
  };
}

export function serializeSettingsBackup(settings: Settings, exportedAt = new Date()): string {
  return `${JSON.stringify(createSettingsBackup(settings, exportedAt), null, 2)}\n`;
}

export function settingsBackupFileName(date = new Date()): string {
  return `imageuploader-settings-${date.toISOString().slice(0, 10)}.json`;
}

export function parseSettingsBackup(text: string): SettingsImport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "This is not an ImageUploader settings backup." };
  const record = value as Record<string, unknown>;
  if (record.format !== SETTINGS_BACKUP_FORMAT)
    return { ok: false, error: "This is not an ImageUploader settings backup." };
  if (record.version !== SETTINGS_BACKUP_VERSION) {
    return {
      ok: false,
      error:
        typeof record.version === "number" && record.version > SETTINGS_BACKUP_VERSION
          ? "This backup was made by a newer version of ImageUploader."
          : "This backup uses an unsupported format.",
    };
  }
  const settings = record.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return { ok: false, error: "This backup does not contain settings." };
  return { ok: true, settings: normalizeSettings(settings) };
}
