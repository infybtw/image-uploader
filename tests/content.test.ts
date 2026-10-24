import { expect, test } from "bun:test";

test("production content script does not include automatic editor insertion", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("../src/content.ts", import.meta.url).pathname],
    target: "browser",
    format: "iife",
  });
  expect(build.success).toBe(true);
  const script = await build.outputs[0]!.text();
  expect(script).not.toContain("captureInsertionPoint");
  expect(script).not.toContain("execCommand");
  expect(script).not.toContain("setSelectionRange");
  expect(script).not.toMatch(/\p{Script=Cyrillic}/u);
});
