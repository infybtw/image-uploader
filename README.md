# ImageUploader

Upload clipboard images on **twitch.tv** and **kick.com**, including subdomains. Images are uploaded anonymously to [Twir Uploader](https://twir.app/uploader), and their links appear in a notification with a copy button. The extension **does not insert links into chat or send messages**.

## Getting started

Requires [Bun](https://bun.sh/) and Firefox **140+**.

```sh
bun install
bun run build
```

For a reproducible build of the submitted add-on, follow the reviewer instructions below instead of installing dependencies without a frozen lockfile.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `dist/manifest.json`.
3. Allow access to Twitch, Kick, and `twir.app` if Firefox asks. Reload any Twitch/Kick tabs that are already open.
4. Copy an image, focus a chat input, and press **Ctrl+V** (**Cmd+V** on macOS).
5. Wait for the notification and click the copy button to the right of the link. Paste the link into chat and send the message yourself.

Context-menu paste and other system paste shortcuts also work: the extension handles the `paste` event rather than intercepting all keystrokes. Normal text pastes are unchanged. Password fields, disabled inputs, and pastes outside an editor are ignored.

Uploaded links appear only in the notification, which stays visible until you close it. Chat input content and caret position are left unchanged; the clipboard is overwritten only when you click the copy button. Failed uploads are not retried automatically. Multiple images are uploaded sequentially, and links to completed uploads remain available if a later upload fails.

Each link has a copy button on its right. After a successful copy, the icon morphs into a green checkmark and changes back after 2 seconds. The animation uses Morphicons with Lucide icons and respects your system's reduced-motion preference. Copying only happens on click and requires no additional clipboard permissions.

## Commands

```sh
bun run dev         # Build and open a separate Firefox instance with the temporary extension
bun test            # Tests without network uploads
bun run test:firefox # Content-script checks in headless Firefox, without uploads to Twir
bun run typecheck   # TypeScript checks
bun run lint        # Mozilla addons-linter validation
bun run package     # Create an unsigned ZIP in artifacts/ for submission to Mozilla
```

After changing the source, run `bun run build`, reload the extension in `about:debugging`, and reload the page. `bun run dev` uses web-ext to watch `dist/` and reload the extension after a new build.

A temporary add-on is removed when Firefox restarts. Permanent installation in standard Firefox requires signing through Mozilla Add-ons, including for unlisted distribution. The ZIP created by `package` is not signed.

## Reproducible build instructions for Mozilla reviewers

### Operating system and build environment

The reference build environment is **Arch Linux, x86_64, Linux kernel 7.2.11**, with **Bun 1.4.4**. Use Linux x86_64 with a kernel of **5.6 or newer** and a CPU supported by Bun. A graphical desktop and Firefox are **not required** to compile or package the add-on.

The installer commands below require Bash, `curl`, `unzip`, and trusted CA certificates. Standard distribution versions of these bootstrap utilities are sufficient; they do not compile the add-on or affect its generated JavaScript. For Debian/Ubuntu, install them with:

```sh
sudo apt-get update
sudo apt-get install --yes bash curl unzip ca-certificates
```

On Arch Linux:

```sh
sudo pacman -S --needed bash curl unzip ca-certificates
```

An internet connection is required to download Bun and install the packages recorded in `bun.lock`. Compilation then uses local files only. No Twir account, API token, environment variables, private registry, or running local server is needed. Building does not upload any images.

### Required tools and exact versions

| Tool | Version | Installation and purpose |
| --- | --- | --- |
| Bun | **1.4.4** | Install using the version-specific command below. Runs dependency installation, the build script, bundling, and packaging. |
| TypeScript | **7.0.2** | Installed locally by `bun install --frozen-lockfile`. Used only by the optional type check; Bun compiles the extension. |
| web-ext | **10.8.0** | Installed locally by the same command. Used for optional Mozilla validation and creating the unsigned ZIP. Run under Bun, not Node.js. |

**Node.js, npm, pnpm, Yarn, a global TypeScript installation, and a global web-ext installation are not required.** The `node:` imports in the build script use Bun's built-in compatibility APIs; they do not require a separate Node.js installation.

Install the exact Bun version, rather than the latest release:

```sh
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

The last command must print **`1.4.4`**. The `export` applies to the current shell; run it again if you open another shell without Bun on its `PATH`.

### Step-by-step build from the submitted source

1. Extract the source archive into a fresh directory. Open a terminal in its root: the directory containing this `README.md`, `package.json`, and `bun.lock`. Do not reuse an existing `dist/` or `node_modules/` directory.
2. Verify that `bun --version` prints `1.4.4`.
3. Install **all dependencies, including development dependencies**, using the committed lockfile:

   ```sh
   bun install --frozen-lockfile
   ```

   Do not delete or regenerate `bun.lock`, update dependencies, or use `--production`. Exact direct and transitive versions are recorded in the lockfile; icon dependencies are `lucide` **1.61.0** and `morphicons` **2.0.2**.

4. Run the build script:

   ```sh
   bun run build
   ```

   This executes **`scripts/build.ts`**, which performs all compilation and assembly steps:

   - Creates `dist/`.
   - Compiles `src/background.ts` and `src/content.ts` using `Bun.build` with `target: "browser"` and `format: "iife"`.
   - Bundles imported source modules and third-party libraries into those two scripts, with no code splitting, source maps, minification, or environment-variable injection.
   - Copies `extension/manifest.json` to `dist/manifest.json` without modification.

   No additional manual code generation, file copying, editing, or post-processing is required. The complete installable add-on code is exactly these three files:

   ```text
   dist/
   ├── background.js
   ├── content.js
   └── manifest.json
   ```

5. To create the unsigned distribution archive, run:

   ```sh
   bun run package
   ```

   This rebuilds the extension using the same script and invokes the locally installed web-ext under Bun. The result is **`artifacts/imageuploader-0.1.0.zip`**, containing the three `dist/` files at the archive root. Firefox is not needed for this step.

### Comparing the rebuilt add-on

Compare the **contents** of `dist/background.js`, `dist/content.js`, and `dist/manifest.json` with the corresponding files at the root of the submitted ZIP/XPI. With the same source, Bun version, and frozen lockfile, these are the files to reproduce. ZIP metadata and timestamps may differ, so the whole archive is not expected to have the same checksum. Mozilla signing may also add signature files, which are not generated by this build.

### Optional validation and tests

These checks are not required to generate the add-on:

```sh
bun test
bun run typecheck
bun run lint
```

`bun run lint` uses the local web-ext **10.8.0** under Bun. Tests and validation do not perform uploads to Twir.

For browser integration tests, install Firefox separately using your distribution's package manager, then run `bun run test:firefox`. The integration tests were verified with **Firefox 158.0**; Firefox **140+** is the extension's minimum desktop runtime version. This optional test suite launches headless Firefox with a temporary test extension. It requires writable access to the existing `/tmp/opencode` directory; if it is absent, create it with `mkdir -p /tmp/opencode`. You can select a different Firefox executable with `FIREFOX_BINARY=/path/to/firefox bun run test:firefox`.

### Files required in the source submission

Include this `README.md`, `package.json`, `bun.lock`, `tsconfig.json`, and the complete `src/`, `scripts/`, `extension/`, and `tests/` directories. Do not include `node_modules/`: it is recreated from the lockfile. Generated `dist/` and `artifacts/` directories are not needed in the source archive; submit the packaged extension separately.

## API and limitations

- `POST https://twir.app/api/v1/uploader/files`, `multipart/form-data`, field `file`; the link is read from `data.link`. This is the API documented in the uploader's **For developers** section.
- PNG, JPEG, GIF, WebP, AVIF, and BMP, up to **25 MiB** per file. SVG is not supported.
- No tokens, authentication, Twir cookies, or account access. Requests use `credentials: "omit"` even if you are signed in to Twir in your browser.
- Requests run in the extension's background script, not in the Twitch/Kick page context. The timeout is 60 seconds. Anonymous API availability and upload limits are controlled by Twir.
- Bun handles dependencies, builds, and tests. The extension itself runs in Firefox without a separate local server.
- Automatic insertion into editors is disabled: the extension only uploads images and displays links for manual copying.

## Privacy

Pasting an image **immediately uploads it to the third-party service Twir**, where it becomes accessible via a public link. Do not paste confidential images. Closing the notification or undoing chat text does not delete the uploaded file. Retention and deletion policies are determined by [Twir](https://twir.app/privacy); management of anonymous uploads is not implemented in this version.

The extension reads only images from a specific trusted paste event in an editable field. It does not poll the clipboard in the background, read browsing history, or store uploads. Original filenames are replaced with `pasted-image.<format>`; image content and metadata are unchanged. Cookies, page URLs, and chat text are not sent to the API. There is no telemetry. Transmission of pasted images is explicitly declared to Firefox under `personalCommunications`.

## Project structure

- `src/content.ts` — paste interception, uploads, and notifications.
- `src/editor.ts` — input detection; automatic insertion code is currently unused.
- `src/background.ts`, `src/upload.ts` — sender validation and anonymous requests.
- `extension/manifest.json` — permissions and domain restrictions.
- `scripts/build.ts` — Bun build from TypeScript to browser scripts.
