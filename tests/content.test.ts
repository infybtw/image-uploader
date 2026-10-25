import { expect, test } from "bun:test";

test("content script includes automatic link insertion and no Cyrillic UI copy", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("../src/content.ts", import.meta.url).pathname],
    target: "browser",
    format: "iife",
  });
  expect(build.success).toBe(true);
  const script = await build.outputs[0]!.text();
  expect(script).toContain("captureInsertionPoint");
  expect(script).toContain('execCommand("insertText"');
  expect(script).toContain("setSelectionRange");
  expect(script).toContain("Preview links in chat");
  expect(script).not.toMatch(/\p{Script=Cyrillic}/u);
});
