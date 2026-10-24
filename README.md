# ImageUploader

Upload clipboard images on **twitch.tv** and **kick.com**, including subdomains. Available as a Firefox/Chrome extension or a **Tampermonkey userscript**. Images are uploaded anonymously to [Twir Uploader](https://twir.app/uploader), and their links appear in a notification with a copy button. Neither version **inserts links into chat or sends messages**.

The project uses **WXT** to generate browser manifests, build entrypoints, and package extensions. **Bun 1.4.4** runs the tooling, tests, native type checker, and formatter, and bundles the standalone userscript. There are no `dev:*` commands or direct `web-ext` dependency; load the built extension or userscript manually.

## Getting started

Requires Bun **1.4.4** and Firefox **140+** or Chrome/Chromium **148+**.

```sh
bun install --frozen-lockfile
bun run build
```

The installation runs `wxt prepare` to generate `.wxt/` types and configuration. The build creates `dist/firefox/`, `dist/chrome/`, `dist/imageuploader.user.js`, and update metadata in `dist/imageuploader.meta.js`.

`bunfig.toml` enables `[install] exact = true`, so newly added packages are saved with exact versions rather than `^` or `~` ranges. Keep `bun.lock` committed and use `--frozen-lockfile` for reproducible installs.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `dist/firefox/manifest.json`.
3. Allow access to Twitch, Kick, and `twir.app` if Firefox asks. Reload already open Twitch/Kick tabs.

A temporary add-on is removed when Firefox restarts. Permanent installation in standard Firefox requires signing through Mozilla Add-ons, including for unlisted distribution. The generated ZIP is not signed.

### Chrome / Chromium

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the **`dist/chrome/` directory**, not its manifest or ZIP file.
3. Reload already open Twitch/Kick tabs.

Both targets use Manifest V3. WXT generates a background script for Firefox and a service worker for Chrome. Chrome's minimum version remains **148**.

### Tampermonkey

1. Install a current version of [Tampermonkey](https://www.tampermonkey.net/) in your browser and enable userscript execution if prompted.
2. Open [the latest userscript](https://github.com/infybtw/ImageUploader/releases/latest/download/imageuploader.user.js) and confirm installation in Tampermonkey. This link becomes available after the first release.
3. Alternatively, build with `bun run build:userscript` (also included in `bun run build`), create a new script in the Tampermonkey dashboard, replace the template with the **entire contents** of `dist/imageuploader.user.js`, and save it with **Ctrl+S**.
4. Allow access to `twir.app` if prompted, then reload Twitch/Kick tabs.

Use either the extension or the userscript on a site, not both at once. The userscript has the same paste handling, image limits, notifications, and animated copy button. It uses Tampermonkey's anonymous background request API for uploads and `GM.setClipboard` only when you click copy. Its upload timeout is **60 seconds** in both browsers. All dependencies are bundled; no external `@require` scripts are loaded.

The script includes `@updateURL` and `@downloadURL` pointing to the latest GitHub Release. With update checks enabled in Tampermonkey, it checks the small `imageuploader.meta.js` file and downloads `imageuploader.user.js` when `@version` increases. Previously installed scripts without these URLs need to be reinstalled or replaced once. Updates follow published stable releases, not branch builds; no update is available before the first release. Forks should change the repository URL in `scripts/build-userscript.ts` before distribution.

### Usage

1. Copy an image, focus a chat input, and press **Ctrl+V** (**Cmd+V** on macOS).
2. Wait for the notification and click the copy button to the right of the link.
3. Paste the link into chat and send the message yourself.

Context-menu paste and other system paste shortcuts also work: the extension handles the `paste` event. Normal text pastes are unchanged. Password fields, disabled inputs, and pastes outside an editor are ignored.

The notification stays visible until you close it. Chat content and caret position are unchanged; the clipboard is overwritten only when you click the copy button. After a successful copy, the Morphicons/Lucide icon morphs into a green checkmark and changes back after 2 seconds. The animation respects reduced-motion preferences.

Multiple images upload sequentially. Failed uploads are not retried automatically; completed links remain available if a later upload fails.

## Commands

```sh
bun run build          # Both browser extensions and the Tampermonkey userscript
bun run build:firefox   # WXT Firefox build in dist/firefox/
bun run build:chrome    # WXT Chrome build in dist/chrome/
bun run build:userscript # Standalone dist/imageuploader.user.js for Tampermonkey
bun run release:check   # Check package/extension versions; optionally pass vX.Y.Z
bun run package        # WXT ZIPs for both browsers and a Firefox sources ZIP
bun run package:firefox # Firefox extension ZIP and sources ZIP
bun run package:chrome  # Chrome extension ZIP
bun test               # Unit, extension/userscript build, and archive tests; no uploads
bun run test:firefox    # Integration checks in real headless Firefox
bun run test:chrome     # Integration checks in real headless Chrome/Chromium
bun run typecheck      # wxt prepare, then native bun check
bun run lint           # bun fmt --check; does not write files
bun run format         # Apply bun fmt formatting
bun run format:check   # Alias for bun fmt --check
```

After changing source, rebuild, reload the extension in the browser's extension management page, and reload the website. Formatting settings live in `bunfig.toml`. `bun fmt` checks formatting, not semantic lint rules. Mozilla-specific add-on validation is not included in these commands.

## CI and GitHub Releases

`.github/workflows/ci.yml` runs on branch pushes, pull requests, and manual dispatches. It installs the Bun version from `package.json` with the frozen lockfile, checks versions, formatting and types, runs `bun test`, packages both extensions, and builds the userscript. Real-browser integration tests are not part of CI. Successful runs keep downloadable build artifacts for 14 days in the Actions tab.

Pushing a tag `vX.Y.Z` runs the same checks and publishes a GitHub Release with generated release notes and these assets:

- `imageuploader-firefox-X.Y.Z.zip` — unsigned Firefox extension.
- `imageuploader-chrome-X.Y.Z.zip` — Chrome/Chromium extension.
- `imageuploader-X.Y.Z-sources.zip` — rebuildable Firefox reviewer sources.
- `imageuploader.user.js` — installable Tampermonkey script; its filename stays stable for updates.
- `imageuploader.meta.js` — userscript update metadata.
- `SHA256SUMS` — SHA-256 checksums of the ZIP and JavaScript assets.

To publish, set the same new, increasing **stable `X.Y.Z` version** in `package.json` and `extension/manifest.json`, commit and push the changes, then push the matching tag. For the initial version:

```sh
bun run release:check v0.1.1
git tag v0.1.1
git push origin v0.1.1
```

Tag/version mismatches and prerelease tags fail before publishing. Published releases are not overwritten; use a new version and tag for changes. The workflow uses the built-in `GITHUB_TOKEN` with `contents: write` only in the release job; no personal token or extra secrets are required. GitHub Actions must be enabled and repository/organization policy must allow release creation. The repository must be public for anonymous downloads and Tampermonkey updates.

**Extension ZIPs are for manual installation/distribution, not browser auto-updates.** Firefox requires a signed XPI via Mozilla Add-ons for permanent installation (listed or unlisted); Chrome normally needs Chrome Web Store distribution. Store publishing/signing and self-hosted extension update manifests are not configured by this workflow. Only the Tampermonkey version is wired for automatic updates through GitHub Releases.

## Manifest configuration

- `extension/manifest.json`: shared name, version, description, and host permissions.
- `extension/firefox.json`: Firefox ID, minimum versions, and data-transmission declaration.
- `extension/chrome.json`: Chrome minimum version.
- `scripts/manifest.ts`: combines shared metadata with browser-specific settings.
- `wxt.config.ts`: passes this metadata to WXT and selects Manifest V3 and browser-specific timeouts.
- `src/entrypoints/background.ts`, `src/entrypoints/content.ts`: WXT entrypoints. WXT generates `background` and `content_scripts` automatically; these fields should not be added to the shared JSON.
- `src/shared.ts`: the Twitch/Kick content-script match patterns.

Edit source configuration, not generated manifests inside `dist/`. The Firefox extension ID is preserved so the migration does not create a new add-on identity.

## Reproducible build instructions for Mozilla reviewers

### Operating system and requirements

The reference environment is **Arch Linux, x86_64, Linux kernel 7.2.11**. Use Linux x86_64 with a kernel of **5.6 or newer** and a CPU supported by Bun. Firefox and a graphical desktop are not required to build or package the extension.

The Bun installer requires Bash, `curl`, `unzip`, and trusted CA certificates. Standard distribution versions suffice; these utilities only bootstrap Bun and do not compile the extension.

```sh
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install --yes bash curl unzip ca-certificates
```

On Arch Linux, use `sudo pacman -S --needed bash curl unzip ca-certificates`.

### Exact tool versions and installation

| Tool | Version    | Installation and purpose                                                                       |
| ---- | ---------- | ---------------------------------------------------------------------------------------------- |
| Bun  | **1.4.4**  | Install below. Runs dependency installation, WXT, tests, native type checking, and formatting. |
| WXT  | **0.21.4** | Installed locally from `bun.lock`; generates manifests, bundles code, and creates ZIPs.        |
| Vite | **8.3.5**  | Installed from `bun.lock` as WXT's build backend. No global installation is needed.            |

No separate Node.js, npm, pnpm, Yarn, TypeScript/tsc, or web-ext installation is required. All WXT CLI commands explicitly run under Bun. The `node:` imports in scripts use Bun's compatibility APIs.

```sh
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

The last command must print **`1.4.4`**. Run the `export` again in a new shell if Bun is not on its `PATH`.

An internet connection is required to install Bun and locked packages. Building then uses local files only. No accounts, API tokens, private registry, `.env` files, or running local server are needed. Building and tests do not upload images.

### Step-by-step build

1. Extract the submitted source ZIP into a fresh directory. Open its root, containing `package.json`, `bun.lock`, `wxt.config.ts`, and this README. Do not reuse `node_modules/`, `.wxt/`, or `dist/` from another checkout.
2. Verify `bun --version` prints `1.4.4`.
3. Install all dependencies, including development dependencies, without changing the lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

   The root `postinstall` script runs `bun --bun x wxt prepare`. If installation was performed with lifecycle scripts disabled, run that command manually before continuing. Do not delete/regenerate `bun.lock`, update packages, or use `--production`.

4. Build Firefox:

   ```sh
   bun run build:firefox
   ```

   This runs the build script `bun --bun x wxt build -b firefox`. WXT reads `wxt.config.ts`, combines manifest metadata, discovers the two entrypoints, and bundles them through Vite. Production JavaScript is minified; source maps are disabled. The Firefox timeout is compiled as 60 seconds. All technical steps are automated; no manual copying or post-processing is required.

   ```text
   dist/firefox/
   ├── background.js
   ├── content-scripts/content.js
   └── manifest.json
   ```

5. Package the extension and reviewer sources:

   ```sh
   bun run package:firefox
   ```

   WXT rebuilds and generates:

   - `dist/imageuploader-firefox-0.1.1.zip`: unsigned extension.
   - `dist/imageuploader-0.1.1-sources.zip`: source submission, including the configuration, lockfile, scripts, tests, license, and README.

For Chrome, use `bun run build:chrome` or `bun run package:chrome`. Its output is `dist/chrome/`, the timeout is 25 seconds, and the archive is `dist/imageuploader-chrome-0.1.1.zip`. `bun run build` processes both browser targets and the userscript; `bun run package` packages only the browser extensions.

### Verification

Compare `manifest.json`, `background.js`, and `content-scripts/content.js` in the selected browser's output directory with the corresponding files in the submitted extension ZIP/XPI. Use the same source, target browser, Bun version, and frozen lockfile. Archive timestamps may differ; compare file contents rather than the whole ZIP checksum. Mozilla-added signature files are not generated by this build.

For source submission, use WXT's sources ZIP or include `README.md`, `LICENSE`, `.gitignore`, `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `wxt.config.ts`, and complete `extension/`, `src/`, `scripts/`, and `tests/` directories. Do not include `node_modules/`, `.wxt/`, generated builds, or archives. The source ZIP explicitly includes unit tests and `.gitignore` so the documented checks work after extraction as well.

### Optional tests

Run `bun test`, `bun run typecheck`, and `bun run lint`. Archive tests use the locked dev dependency `fflate` **0.8.3** to inspect WXT's ZIPs; it is not bundled into the extension.

For real-browser tests, install Firefox **140+** or Chrome/Chromium **148+** separately, then run `bun run test:firefox` or `bun run test:chrome`. Tests were verified with **Firefox 158.0** and **Chromium 154.0.8037.97**. Override the executable with `FIREFOX_BINARY=/path/to/firefox` or `CHROME_BINARY=/path/to/chromium` if needed.

The test runner directly launches an isolated temporary browser profile and installs the WXT-built extension using Firefox RDP or Chrome CDP. It does not use web-ext, access your normal profile, or overwrite the system clipboard. Tests need writable access to `/tmp/opencode`; create it with `mkdir -p /tmp/opencode` if absent. They cover cross-context file reading, production background sender checks, and copy-button states.

## API and privacy

- Uploads use `POST https://twir.app/api/v1/uploader/files`, `multipart/form-data`, field `file`, and read the result from `data.link`.
- Supported: PNG, JPEG, GIF, WebP, AVIF, and BMP, up to **25 MiB** per file. SVG is not supported.
- Extension requests run in its background context with `credentials: "omit"`; userscript requests run through Tampermonkey with `anonymous: true`. Neither uploads from the Twitch/Kick page context. No Twir login, tokens, or cookies are used, even if you are signed in elsewhere.
- The extension timeout is **60 seconds in Firefox**, **25 seconds in Chrome**; the userscript timeout is **60 seconds**. Interrupted uploads report an error without automatic retries. Twir controls API availability and upload limits.

Pasting an image **immediately uploads it to the third-party service Twir**, where it becomes accessible via a public link. Do not paste confidential images. Closing a notification or undoing chat text does not delete the upload. Retention/deletion policies belong to [Twir](https://twir.app/privacy); anonymous upload management is not implemented.

Both versions read images only from a trusted paste event in an editable field. They do not poll the clipboard, read browsing history, or store uploads. Filenames become `pasted-image.<format>`; image bytes and metadata are unchanged. Cookies, page URLs, and chat text are not sent to the API. There is no telemetry. Transmission of pasted images is declared by the Firefox extension as `personalCommunications`.
