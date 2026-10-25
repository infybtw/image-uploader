import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildExtension } from "./build";
import { startBrowser } from "./browser-runner";

// Run as a real extension content script, alongside the production background code.
// All permissions added here are test-only; no real uploads are performed.
const target = Bun.argv[2] ?? "firefox";
if (target !== "firefox" && target !== "chrome")
  throw new Error("Usage: bun scripts/test-browser.ts [firefox|chrome]");
const directory = await mkdtemp(`/tmp/opencode/imageuploader-${target}-`);
const extension = await buildExtension(target, directory);
const build = await Bun.build({
  entrypoints: [new URL("../tests/browser/suite.ts", import.meta.url).pathname],
  target: "browser",
  format: "iife",
  banner: `
    const reportFailure = (error) => fetch("/results", { method: "POST", body: JSON.stringify([
      { name: "content script initialization", error: String(error && error.message || error) }
    ]) });
    globalThis.addEventListener("error", (event) => { void reportFailure(event.error || event.message); });
    globalThis.addEventListener("unhandledrejection", (event) => { void reportFailure(event.reason); });
  `,
});
if (!build.success) throw new AggregateError(build.logs, "Could not build the browser tests");
const script = await build.outputs[0]!.text();
type Result = { name: string; error?: string };
const { promise, resolve, reject } = Promise.withResolvers<Result[]>();
const ready = Promise.withResolvers<void>();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/results" && request.method === "POST") {
      resolve((await request.json()) as Result[]);
      return new Response("ok");
    }
    // Chromium installs unpacked extensions after opening the tab. Hold the page
    // response until installation finishes so its content script is registered.
    await ready.promise;
    if (path === "/preview-image") {
      return new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
        { headers: { "Content-Type": "image/png" } },
      );
    }
    if (path === "/viewer-image") {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#4c1d95"/><circle cx="800" cy="500" r="320" fill="#a78bfa"/></svg>',
        {
          headers: { "Content-Type": "image/svg+xml" },
        },
      );
    }
    if (path === "/preview-redirect") {
      return new Response(null, { status: 302, headers: { Location: "/preview-image" } });
    }
    if (path === "/preview-page") {
      return new Response("<!doctype html><title>Not an image</title>", {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (path === "/preview-post") {
      return new Response(
        '<!doctype html><meta property="og:image" content="/preview-image?size=small&amp;token=abc">',
        {
          headers: { "Content-Type": "text/html" },
        },
      );
    }
    if (path === "/preview-post-redirect") {
      return new Response(null, { status: 302, headers: { Location: "/preview-post" } });
    }
    if (path !== "/test") {
      return new Response('<!doctype html><script>location.replace("/test")</script>', {
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response(
      `<!doctype html><title>ImageUploader: browser tests</title><body>
      <input type="file" id="page-file">
      <script>
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array([0, 1, 2, 255])], "private-name.png", { type: "image/png" }));
        document.getElementById("page-file").files = transfer.files;
      </script>`,
      // Only local image fixtures may load; never fetch real uploads or chat links.
      {
        headers: { "Content-Type": "text/html", "Content-Security-Policy": "img-src 'self' blob:" },
      },
    );
  },
});
await Bun.write(join(extension, "suite.js"), script);
await Bun.write(
  join(extension, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "ImageUploader browser tests",
    version: "0.0.0",
    ...(target === "firefox"
      ? {
          browser_specific_settings: { gecko: { id: "imageuploader-tests@imageuploader.local" } },
          background: { scripts: ["background.js"] },
        }
      : {
          minimum_chrome_version: "148",
          background: { service_worker: "background.js" },
        }),
    content_scripts: [
      { matches: ["http://127.0.0.1/test*"], js: ["suite.js"], run_at: "document_idle" },
    ],
  }),
);
let runner: Awaited<ReturnType<typeof startBrowser>> | undefined;
const timeout = setTimeout(
  () => reject(new Error(`${target} did not return test results within 30 seconds`)),
  30_000,
);
try {
  runner = await startBrowser(target, extension, directory, server.url.href);
  ready.resolve();
  const results = await promise;
  for (const result of results)
    console.log(
      `${result.error ? "FAIL" : "PASS"} ${result.name}${result.error ? `: ${result.error}` : ""}`,
    );
  if (!results.length || results.some((result) => result.error))
    throw new Error(`${target} tests failed`);
  console.log(`\n${results.length} ${target} checks passed`);
} finally {
  clearTimeout(timeout);
  await runner?.exit();
  server.stop(true);
  await rm(directory, { recursive: true, force: true });
}
