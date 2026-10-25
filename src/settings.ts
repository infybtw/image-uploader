export type PreviewClick = "viewer" | "site";

export interface Settings {
  chatPreviews: boolean;
  autoInsert: boolean;
  previewClick: PreviewClick;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  chatPreviews: true,
  autoInsert: false,
  previewClick: "viewer",
});

export function normalizeSettings(value: unknown): Settings {
  const stored =
    value && typeof value === "object" ? (value as Record<string, unknown>) : ({} as const);
  return {
    chatPreviews:
      typeof stored.chatPreviews === "boolean"
        ? stored.chatPreviews
        : DEFAULT_SETTINGS.chatPreviews,
    autoInsert:
      typeof stored.autoInsert === "boolean" ? stored.autoInsert : DEFAULT_SETTINGS.autoInsert,
    previewClick: stored.previewClick === "site" ? "site" : "viewer",
  };
}

export interface SettingsStore {
  load(): unknown;
  save(settings: Settings): void;
}

export interface SettingsController {
  /** The current settings, safe to read synchronously from event handlers. */
  get(): Settings;
  /** Resolves once the stored settings have been read. */
  readonly ready: Promise<void>;
  update(patch: Partial<Settings>): void;
  /** Applies settings saved by another tab or frame without writing them again. */
  replace(value: unknown): void;
  subscribe(listener: (settings: Settings) => void): () => void;
}

function sameSettings(first: Settings, second: Settings): boolean {
  return (
    first.chatPreviews === second.chatPreviews &&
    first.autoInsert === second.autoInsert &&
    first.previewClick === second.previewClick
  );
}

export function createSettings(store: SettingsStore): SettingsController {
  let current = { ...DEFAULT_SETTINGS };
  const listeners = new Set<(settings: Settings) => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener(current);
  };
  const ready = Promise.resolve()
    .then(() => store.load())
    .then((value) => {
      const next = normalizeSettings(value);
      if (sameSettings(next, current)) return;
      current = next;
      emit();
    })
    .catch((error) => {
      console.error("[ImageUploader] Could not load settings", error);
    });

  return {
    get: () => current,
    ready,
    update(patch) {
      const next = normalizeSettings({ ...current, ...patch });
      if (sameSettings(next, current)) return;
      current = next;
      emit();
      void Promise.resolve()
        .then(() => store.save(current))
        .catch((error) => {
          console.error("[ImageUploader] Could not save settings", error);
        });
    },
    replace(value) {
      const next = normalizeSettings(value);
      if (sameSettings(next, current)) return;
      current = next;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
