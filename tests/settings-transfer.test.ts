import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/settings";
import {
  parseSettingsBackup,
  serializeSettingsBackup,
  settingsBackupFileName,
} from "../src/settings-transfer";

const saved: Settings = {
  ...DEFAULT_SETTINGS,
  chatPreviews: false,
  autoInsert: true,
  previewClick: "site",
  blockedUsers: ["someone", "other_user"],
  blockedDomains: ["example.com", "cdn.example.com"],
  hideBots: false,
};

describe("settings backup", () => {
  test("serializes every setting with format metadata and a dated filename", () => {
    const date = new Date("2026-10-26T20:00:00.000Z");
    const text = serializeSettingsBackup(saved, date);
    const backup = JSON.parse(text);
    expect(backup).toEqual({
      format: "imageuploader-settings",
      version: 1,
      exportedAt: date.toISOString(),
      settings: saved,
    });
    expect(text.endsWith("\n")).toBe(true);
    expect(settingsBackupFileName(date)).toBe("imageuploader-settings-2026-10-26.json");
  });

  test("round-trips an exported backup", () => {
    const result = parseSettingsBackup(serializeSettingsBackup(saved));
    expect(result).toEqual({ ok: true, settings: saved });
  });

  test("normalizes imported values and ignores unknown keys", () => {
    const result = parseSettingsBackup(
      JSON.stringify({
        format: "imageuploader-settings",
        version: 1,
        settings: {
          chatPreviews: false,
          autoInsert: "yes",
          previewClick: "other",
          blockedUsers: ["@SomeOne", "someone", "bad/name"],
          blockedDomains: ["https://CDN.Example/a", "not_a_domain"],
          hideBots: false,
          ignored: true,
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      settings: {
        ...DEFAULT_SETTINGS,
        chatPreviews: false,
        blockedUsers: ["someone"],
        blockedDomains: ["cdn.example"],
        hideBots: false,
      },
    });
  });

  for (const [label, text, error] of [
    ["malformed JSON", "{", "not valid JSON"],
    ["a JSON array", "[]", "not an ImageUploader"],
    ["another product's file", '{"format":"other"}', "not an ImageUploader"],
    [
      "a missing settings object",
      '{"format":"imageuploader-settings","version":1}',
      "does not contain settings",
    ],
    [
      "an unsupported older format",
      '{"format":"imageuploader-settings","version":0,"settings":{}}',
      "unsupported format",
    ],
    [
      "a backup from a newer version",
      '{"format":"imageuploader-settings","version":2,"settings":{}}',
      "newer version",
    ],
  ] as const) {
    test(`rejects ${label}`, () => {
      const result = parseSettingsBackup(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(error);
    });
  }
});
