import { describe, expect, test } from "bun:test";
import {
  createSettings,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type Settings,
} from "../src/settings";

describe("settings validation", () => {
  test("uses safe defaults for missing or invalid values", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("invalid")).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({ chatPreviews: "yes", autoInsert: 1, previewClick: "other" }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  test("keeps valid stored values", () => {
    expect(
      normalizeSettings({ chatPreviews: false, autoInsert: true, previewClick: "site" }),
    ).toEqual({
      chatPreviews: false,
      autoInsert: true,
      previewClick: "site",
    });
  });
});

describe("settings controller", () => {
  const stored = { chatPreviews: false, autoInsert: true, previewClick: "site" as const };

  test("loads stored settings and notifies subscribers", async () => {
    const settings = createSettings({ load: () => stored, save: () => {} });
    const updates: Settings[] = [];
    settings.subscribe((value) => updates.push(value));
    expect(settings.get()).toEqual(DEFAULT_SETTINGS);
    await settings.ready;
    expect(settings.get()).toEqual(stored);
    expect(updates).toEqual([stored]);
  });

  test("updates immediately and persists the full settings object", async () => {
    const saved: Settings[] = [];
    const settings = createSettings({ load: () => stored, save: (value) => saved.push(value) });
    await settings.ready;
    settings.update({ autoInsert: false });
    expect(settings.get()).toEqual({ ...stored, autoInsert: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([{ ...stored, autoInsert: false }]);
  });

  test("applies cross-tab changes without writing them back", async () => {
    let saves = 0;
    const settings = createSettings({ load: () => stored, save: () => saves++ });
    await settings.ready;
    settings.replace({ ...stored, chatPreviews: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settings.get()).toEqual({ ...stored, chatPreviews: true });
    expect(saves).toBe(0);
  });
});
