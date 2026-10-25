import { join } from "node:path";
import manifest from "../extension/manifest.json";
import { SITE_MATCHES } from "../src/shared";

const releaseUrl = "https://github.com/infybtw/image-uploader/releases/latest/download";

export async function buildUserscript(outdir = "dist") {
  const metadata = [
    "// ==UserScript==",
    `// @name         ${manifest.name}`,
    "// @namespace    ImageUploader",
    `// @version      ${manifest.version}`,
    `// @description  ${manifest.description}`,
    `// @updateURL    ${releaseUrl}/imageuploader.meta.js`,
    `// @downloadURL  ${releaseUrl}/imageuploader.user.js`,
    "// @license      MIT",
    ...SITE_MATCHES.map((match) => `// @match        ${match}`),
    "// @connect      *",
    "// @grant        GM_xmlhttpRequest",
    "// @grant        GM.setClipboard",
    "// @sandbox      DOM",
    "// @run-at       document-start",
    "// ==/UserScript==",
  ].join("\n");
  const result = await Bun.build({
    entrypoints: [new URL("../src/userscript.ts", import.meta.url).pathname],
    target: "browser",
    format: "iife",
    minify: true,
    define: { __UPLOAD_TIMEOUT_MS__: "60000" },
    banner: metadata,
  });
  if (!result.success) throw new AggregateError(result.logs, "Userscript build failed.");
  const output = join(outdir, "imageuploader.user.js");
  await Bun.write(output, result.outputs[0]!);
  await Bun.write(join(outdir, "imageuploader.meta.js"), `${metadata}\n`);
  return output;
}

if (import.meta.main) console.log(await buildUserscript());
