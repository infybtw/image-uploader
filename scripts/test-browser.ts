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
      // Preview tests inspect image elements and simulate failures; never fetch real uploads.
      { headers: { "Content-Type": "text/html", "Content-Security-Policy": "img-src 'none'" } },
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
