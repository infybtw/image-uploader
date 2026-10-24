declare const __UPLOAD_TIMEOUT_MS__: number;

// Replaced by the build script. Direct imports in tests default to Firefox's timeout.
export const UPLOAD_TIMEOUT_MS =
  typeof __UPLOAD_TIMEOUT_MS__ === "number" ? __UPLOAD_TIMEOUT_MS__ : 60_000;
