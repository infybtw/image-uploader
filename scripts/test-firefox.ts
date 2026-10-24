import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";

// Run as a real extension content script to cover Firefox's compartment boundaries.
// All permissions added here are test-only; no real uploads are performed.
const directory = await mkdtemp("/tmp/opencode/imageuploader-firefox-");
const extension = join(directory, "extension");
await mkdir(extension);
const build = await Bun.build({
  entrypoints: [new URL("../tests/firefox/suite.ts", import.meta.url).pathname],
  target: "browser",
  format: "iife",
});
if (!build.success) throw new AggregateError(build.logs, "Could not build the Firefox tests");
const script = await build.outputs[0]!.text();
type Result = { name: string; error?: string };
const { promise, resolve, reject } = Promise.withResolvers<Result[]>();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/results" && request.method === "POST") {
      resolve(await request.json() as Result[]);
      return new Response("ok");
    }
    return new Response(`<!doctype html><title>ImageUploader: Firefox tests</title><body>
      <input type="file" id="page-file">
      <script>
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array([0, 1, 2, 255])], "private-name.png", { type: "image/png" }));
        document.getElementById("page-file").files = transfer.files;
      </script>`, { headers: { "Content-Type": "text/html" } });
  },
});
await Bun.write(join(extension, "suite.js"), script);
await Bun.write(join(extension, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "ImageUploader Firefox tests",
  version: "0.0.0",
  browser_specific_settings: { gecko: { id: "imageuploader-tests@imageuploader.local" } },
  content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["suite.js"], run_at: "document_idle" }],
}));
// web-ext has no TypeScript declarations; keep its small API boundary local.
interface Runner { exit(): Promise<void> }
const webExt = (await import(Bun.resolveSync("web-ext", import.meta.dir))).default as {
  cmd: { run(options: Record<string, unknown>, settings: Record<string, unknown>): Promise<Runner> };
};
const { connectWithMaxRetries } = await import(join(dirname(Bun.resolveSync("web-ext", import.meta.dir)), "lib/firefox/remote.js"));

async function connectFirefox(options: { port: number }) {
  // web-ext's initial ECONNREFUSED retry can hang under Bun; wait for the RDP
  // listener before handing the socket to web-ext. No Node runtime is needed.
  for (let attempt = 0; attempt < 200; attempt++) {
    const ready = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port: options.port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
    });
    if (ready) return connectWithMaxRetries(options);
    await Bun.sleep(50);
  }
  throw new Error("Firefox did not open its debugging port");
}
let runner: Runner | undefined;
const timeout = setTimeout(() => reject(new Error("Firefox did not return test results within 30 seconds")), 30_000);
try {
  runner = await webExt.cmd.run({
    sourceDir: extension,
    firefox: Bun.env.FIREFOX_BINARY ?? "firefox",
    args: ["-headless"],
    startUrl: [server.url.href],
    noReload: true,
    noInput: true,
  }, { shouldExitProgram: false, firefoxClient: connectFirefox });
  const results = await promise;
  for (const result of results) console.log(`${result.error ? "FAIL" : "PASS"} ${result.name}${result.error ? `: ${result.error}` : ""}`);
  if (!results.length || results.some((result) => result.error)) throw new Error("Firefox tests failed");
  console.log(`\n${results.length} Firefox checks passed`);
} finally {
  clearTimeout(timeout);
  await runner?.exit();
  server.stop(true);
  await rm(directory, { recursive: true, force: true });
}
