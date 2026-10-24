import { captureInsertionPoint, findEditor } from "../../src/editor";
import { serializeImage } from "../../src/clipboard";
import { errorMessage } from "../../src/shared";
import { createCopyButton } from "../../src/copy-button";

// This File was created by a page script, not by the extension's isolated world.
const pageFile = (document.getElementById("page-file") as HTMLInputElement).files![0]!;

const results: { name: string; error?: string }[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void) {
  document.body.replaceChildren();
  try {
    run();
    results.push({ name });
  } catch (error) {
    results.push({ name, error: error instanceof Error ? error.message : String(error) });
  }
}

function textarea(value = "hello world") {
  const field = document.createElement("textarea");
  field.value = value;
  document.body.append(field);
  field.focus();
  field.setSelectionRange(6, 11);
  return field;
}

test("textarea: replaces the captured selection and emits input", () => {
  const field = textarea();
  let input = false;
  field.addEventListener("input", () => { input = true; });
  const point = captureInsertionPoint(field);
  assert(point.insert("https://twir.app/u/test"), "insertion failed");
  assert(field.value === "hello https://twir.app/u/test", `unexpected value: ${field.value}`);
  assert(input, "input event was not emitted");
});

test("input: inserts at the caret", () => {
  const field = document.createElement("input");
  field.value = "ab";
  document.body.append(field);
  field.focus();
  field.setSelectionRange(1, 1);
  assert(captureInsertionPoint(field).insert("LINK"), "insertion failed");
  assert(field.value === "aLINKb", `unexpected value: ${field.value}`);
});

test("contenteditable: inserts plain text into nested markup and emits input", () => {
  const field = document.createElement("div");
  field.contentEditable = "true";
  const span = document.createElement("span");
  span.textContent = "hello world";
  field.append(span);
  document.body.append(field);
  field.focus();
  const range = document.createRange();
  range.setStart(span.firstChild!, 6);
  range.setEnd(span.firstChild!, 11);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  let input = false;
  field.addEventListener("input", () => { input = true; });
  assert(findEditor(span) === field, "nested editable not resolved");
  assert(captureInsertionPoint(field).insert("https://twir.app/u/test"), "insertion failed");
  assert(field.textContent === "hello https://twir.app/u/test", `unexpected text: ${field.textContent}`);
  assert(input, "input event was not emitted");
});

test("draft edited while uploading is not overwritten", () => {
  const field = textarea();
  const point = captureInsertionPoint(field);
  field.value = "new draft";
  field.dispatchEvent(new InputEvent("input", { bubbles: true }));
  assert(!point.insert("LINK"), "changed draft was overwritten");
  assert(field.value === "new draft", "draft lost");
});

test("typing then undoing still invalidates the old insertion point", () => {
  const field = textarea();
  const point = captureInsertionPoint(field);
  field.dispatchEvent(new InputEvent("input", { bubbles: true }));
  assert(!point.insert("LINK"), "stale insertion accepted");
  assert(field.value === "hello world", "draft changed");
});

test("lost focus does not steal focus or insert in another field", () => {
  const field = textarea();
  const point = captureInsertionPoint(field);
  const other = textarea("another draft");
  assert(!point.insert("LINK"), "insertion accepted after focus change");
  assert(document.activeElement === other && other.value === "another draft", "other field changed");
});

test("disconnected and newly readonly fields reject insertion", () => {
  const field = textarea();
  const point = captureInsertionPoint(field);
  field.remove();
  assert(!point.insert("LINK"), "detached field accepted");
  document.body.append(field);
  field.focus();
  const readonlyPoint = captureInsertionPoint(field);
  field.readOnly = true;
  assert(!readonlyPoint.insert("LINK"), "readonly field accepted");
});

test("passwords, disabled fields, non-editable content and inert fields are ignored", () => {
  const field = document.createElement("input");
  document.body.append(field);
  field.type = "password";
  assert(findEditor(field) === null, "password accepted");
  field.type = "text";
  field.disabled = true;
  assert(findEditor(field) === null, "disabled input accepted");
  field.disabled = false;
  field.inert = true;
  assert(findEditor(field) === null, "inert input accepted");
  assert(findEditor(document.body) === null, "body accepted");
});

test("programmatic rich text change invalidates the insertion point", () => {
  const field = document.createElement("div");
  field.contentEditable = "true";
  field.textContent = "draft";
  document.body.append(field);
  field.focus();
  window.getSelection()!.selectAllChildren(field);
  const point = captureInsertionPoint(field);
  field.textContent = "updated";
  assert(!point.insert("LINK"), "programmatic changes overwritten");
  assert(field.textContent === "updated", "updated draft lost");
});

async function checkClipboard() {
  const name = "content script reads a page-owned File across Firefox compartments";
  try {
    assert(typeof browser.runtime.id === "string", "test must run as an actual extension content script");
    const image = await serializeImage(pageFile);
    assert(image.mimeType === "image/png", "wrong image type");
    assert(image.name === "pasted-image.png", "original filename leaked");
    assert(image.base64 === "AAEC/w==", `incorrect bytes: ${image.base64}`);
    results.push({ name });
  } catch (error) {
    results.push({ name, error: errorMessage(error) });
  }
  await checkCopyButtons();
  await fetch("/results", { method: "POST", body: JSON.stringify(results) });
}

async function checkCopyButtons() {
  async function check(name: string, run: () => Promise<void>) {
    try {
      await run();
      results.push({ name });
    } catch (error) {
      results.push({ name, error: errorMessage(error) });
    }
  }
  const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  await check("copy button copies its own URL and morphs to a check only after success", async () => {
    let copied = "";
    const { promise, resolve } = Promise.withResolvers<void>();
    const control = createCopyButton("https://twir.app/u/copy-test", (error) => { throw new Error(error); }, (text) => {
      copied = text;
      return promise;
    });
    document.body.append(control.element);
    try {
      const path = control.element.querySelector("path")!;
      const originalPath = path.getAttribute("d");
      assert(originalPath, "Morphicons copy icon wasn't rendered");
      control.element.click();
      assert(copied === "https://twir.app/u/copy-test", "wrong URL copied");
      assert(control.element.getAttribute("data-state") === "copying", "check shown before clipboard write finished");
      assert(path.getAttribute("d") === originalPath, "icon changed before successful copy");
      resolve();
      await tick();
      assert(control.element.getAttribute("data-state") === "copied", "successful copy not indicated");
      assert(control.element.getAttribute("aria-label") === "Copied", "accessible label not updated");
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      assert(path.getAttribute("d") !== originalPath, "Morphicons didn't animate to the check");
      await new Promise((resolve) => window.setTimeout(resolve, 2_100));
      assert(control.element.getAttribute("data-state") === "idle", "copy state wasn't restored after two seconds");
      assert(control.element.getAttribute("aria-label") === "Copy link", "copy label wasn't restored");
    } finally {
      control.destroy();
      control.element.remove();
    }
  });

  await check("copy failures keep the copy icon and report the actual error", async () => {
    let message = "";
    const control = createCopyButton("https://twir.app/u/test", (error) => { message = error; }, async () => {
      throw new DOMException("Clipboard blocked", "NotAllowedError");
    });
    document.body.append(control.element);
    try {
      control.element.click();
      await tick();
      assert(message.includes("Clipboard blocked"), "copy error wasn't reported");
      assert(control.element.dataset.state === "idle", "failed copy shows success");
      assert(!control.element.disabled, "copy button cannot be retried");
    } finally {
      control.destroy();
      control.element.remove();
    }
  });

  await check("closing a notice stops pending copy state updates", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const control = createCopyButton("https://twir.app/u/test", () => {}, () => promise);
    document.body.append(control.element);
    control.element.click();
    control.destroy();
    control.element.remove();
    resolve();
    await tick();
    assert(control.element.dataset.state === "copying", "destroyed control was updated");
  });
}

void checkClipboard();
