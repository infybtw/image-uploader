import { defineConfig } from "wxt";
import { createManifest } from "./scripts/manifest";

export default defineConfig({
  srcDir: "src",
  imports: false,
  manifestVersion: 3,
  targetBrowsers: ["firefox", "chrome"],
  outDir: "dist",
  outDirTemplate: "{{browser}}",
  manifest: ({ browser }) => {
    const { manifest_version, ...metadata } = createManifest(
      browser === "firefox" ? "firefox" : "chrome",
    );
    return metadata;
  },
  vite: ({ browser }) => ({
    define: { __UPLOAD_TIMEOUT_MS__: String(browser === "chrome" ? 25_000 : 60_000) },
    build: { minify: true, sourcemap: false },
  }),
  zip: {
    artifactTemplate: "imageuploader-{{browser}}-{{version}}.zip",
    sourcesTemplate: "imageuploader-{{version}}-sources.zip",
    dotSources: true,
    includeSources: [
      "src",
      "scripts",
      "tests",
      "extension",
      "wxt.config.ts",
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "tsconfig.json",
      "README.md",
      "LICENSE",
      ".gitignore",
    ],
  },
  hooks: {
    "config:resolved": ({ config }) => {
      // WXT excludes *.test.ts by default. Our explicit source allowlist should
      // include them so the reviewer can run the documented checks as well.
      config.zip.excludeSources = ["**/node_modules/**", ".wxt/**", "dist/**", "artifacts/**"];
    },
  },
});
