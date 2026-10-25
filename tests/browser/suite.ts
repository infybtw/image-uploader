import { captureInsertionPoint, findEditor } from "../../src/editor";
import { browser } from "wxt/browser";
import { serializeImage } from "../../src/clipboard";
import { errorMessage } from "../../src/shared";
import { createCopyButton } from "../../src/copy-button";
import { createNotice } from "../../src/notice";
import { findTwitchChatInput, mountNotice } from "../../src/notice-placement";
import type { UploadReply } from "../../src/shared";

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

async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.push({ name });
  } catch (error) {
    results.push({ name, error: errorMessage(error) });
  }
}

function twitchChat() {
  const chat = document.createElement("div");
  chat.className = "chat-input";
  const wrapper = document.createElement("div");
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  editor.textContent = "unsent draft";
  wrapper.append(editor);
  chat.append(wrapper);
  document.body.append(chat);
  return { chat, editor };
}

test("inline notices only target a Twitch chat input, not other sites or editors", () => {
  const { chat, editor } = twitchChat();
  editor.setAttribute("data-a-target", "chat-input");
  assert(findTwitchChatInput(editor, "www.twitch.tv") === chat, "Twitch chat not found");
  assert(findTwitchChatInput(editor, "kick.com") === null, "Kick layout was changed");
  assert(findTwitchChatInput(editor, "fake-twitch.tv") === null, "lookalike host accepted");
  assert(findTwitchChatInput(textarea(), "www.twitch.tv") === null, "non-chat field accepted");
  editor.removeAttribute("data-a-target");
  chat.className = "";
  chat.setAttribute("data-a-target", "chat-input");
  assert(findTwitchChatInput(editor, "twitch.tv") === chat, "data attribute not recognized");
  chat.removeAttribute("data-a-target");
  editor.setAttribute("data-a-target", "chat-input");
  assert(
    findTwitchChatInput(editor, "twitch.tv") === null,
    "editor itself accepted as a panel host",
  );
});

test("inline notice sits above the chat editor without changing its draft or focus", () => {
  const { chat, editor } = twitchChat();
  editor.focus();
  window.getSelection()!.selectAllChildren(editor);
  const host = document.createElement("div");
  const unmount = mountNotice(host, chat);
  try {
    assert(chat.firstElementChild === host, "panel was not placed above the editor");
    assert(!editor.contains(host), "panel was inserted into the editor");
    assert(host.dataset.placement === "chat", "inline styling not selected");
    assert(getComputedStyle(host).position === "relative", "panel overlays the chat");
    assert(editor.textContent === "unsent draft", "draft changed");
    assert(document.activeElement === editor, "editor lost focus");
    assert(window.getSelection()!.toString() === "unsent draft", "selection changed");
  } finally {
    unmount();
    host.remove();
  }
});

test("unrecognized layouts keep a floating notification", () => {
  const host = document.createElement("div");
  const unmount = mountNotice(host, null);
  try {
    assert(host.parentElement === document.documentElement, "floating notice not mounted");
    assert(host.dataset.placement === "floating", "floating styling not selected");
    assert(getComputedStyle(host).position === "fixed", "floating position lost");
  } finally {
    unmount();
    host.remove();
  }
});

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
  field.addEventListener("input", () => {
    input = true;
  });
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
  field.addEventListener("input", () => {
    input = true;
  });
  assert(findEditor(span) === field, "nested editable not resolved");
  assert(captureInsertionPoint(field).insert("https://twir.app/u/test"), "insertion failed");
  assert(
    field.textContent === "hello https://twir.app/u/test",
    `unexpected text: ${field.textContent}`,
  );
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
  assert(
    document.activeElement === other && other.value === "another draft",
    "other field changed",
  );
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
  const name = "content script reads a page-owned File";
  try {
    assert(
      typeof browser.runtime.id === "string",
      "test must run as an actual extension content script",
    );
    const image = await serializeImage(pageFile);
    assert(image.mimeType === "image/png", "wrong image type");
    assert(image.name === "pasted-image.png", "original filename leaked");
    assert(image.base64 === "AAEC/w==", `incorrect bytes: ${image.base64}`);
    results.push({ name });
  } catch (error) {
    results.push({ name, error: errorMessage(error) });
  }
  const backgroundTest =
    "production background replies asynchronously and rejects non-allowlisted pages";
  try {
    const reply: UploadReply = await browser.runtime.sendMessage({
      type: "upload-image",
      image: { name: "test.png", mimeType: "image/png", base64: "AAEC/w==" },
    });
    assert(
      reply?.ok === false && reply.error === "Uploads are only allowed on Twitch and Kick.",
      "background did not enforce the site allowlist",
    );
    results.push({ name: backgroundTest });
  } catch (error) {
    results.push({ name: backgroundTest, error: errorMessage(error) });
  }
  await checkNoticePlacement();
  await checkCopyButtons();
  await checkNoticeCountdown();
  await fetch("/results", { method: "POST", body: JSON.stringify(results) });
}

async function checkNoticePlacement() {
  const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  await check("notice survives chat removal and reattaches when Twitch remounts chat", async () => {
    document.body.replaceChildren();
    const { chat } = twitchChat();
    const host = document.createElement("div");
    host.textContent = "https://twir.app/u/preserved";
    const unmount = mountNotice(host, chat);
    try {
      chat.remove();
      const bareEditor = document.createElement("div");
      bareEditor.contentEditable = "true";
      bareEditor.setAttribute("data-a-target", "chat-input");
      document.body.append(bareEditor);
      await tick();
      assert(host.isConnected, "links disappeared with the old chat");
      assert(
        host.getAttribute("data-placement") === "floating",
        "missing chat did not use fallback",
      );
      assert(!bareEditor.contains(host), "fallback panel was mounted inside a bare editor");
      const replacement = twitchChat();
      await tick();
      assert(replacement.chat.firstElementChild === host, "panel did not reattach");
      assert(host.getAttribute("data-placement") === "chat", "inline styling not restored");
      assert(host.textContent === "https://twir.app/u/preserved", "links lost on remount");
      host.remove();
      await tick();
      assert(host.isConnected, "Twitch removing only the panel was not repaired");
    } finally {
      unmount();
      host.remove();
    }
    await tick();
    assert(!host.isConnected, "dismissed panel reappeared");
  });
}

async function checkCopyButtons() {
  const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  await check(
    "copy button copies its own URL and morphs to a check only after success",
    async () => {
      let copied = "";
      const { promise, resolve } = Promise.withResolvers<void>();
      const control = createCopyButton(
        "https://twir.app/u/copy-test",
        (error) => {
          throw new Error(error);
        },
        (text) => {
          copied = text;
          return promise;
        },
      );
      document.body.append(control.element);
      try {
        const path = control.element.querySelector("path")!;
        const originalPath = path.getAttribute("d");
        assert(originalPath, "Morphicons copy icon wasn't rendered");
        control.element.click();
        assert(copied === "https://twir.app/u/copy-test", "wrong URL copied");
        assert(
          control.element.getAttribute("data-state") === "copying",
          "check shown before clipboard write finished",
        );
        assert(path.getAttribute("d") === originalPath, "icon changed before successful copy");
        resolve();
        await tick();
        assert(
          control.element.getAttribute("data-state") === "copied",
          "successful copy not indicated",
        );
        assert(
          control.element.getAttribute("aria-label") === "Copied",
          "accessible label not updated",
        );
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        assert(path.getAttribute("d") !== originalPath, "Morphicons didn't animate to the check");
        await new Promise((resolve) => window.setTimeout(resolve, 2_100));
        assert(
          control.element.getAttribute("data-state") === "idle",
          "copy state wasn't restored after two seconds",
        );
        assert(
          control.element.getAttribute("aria-label") === "Copy link",
          "copy label wasn't restored",
        );
      } finally {
        control.destroy();
        control.element.remove();
      }
    },
  );

  await check("copy failures keep the copy icon and report the actual error", async () => {
    let message = "";
    const control = createCopyButton(
      "https://twir.app/u/test",
      (error) => {
        message = error;
      },
      async () => {
        throw new DOMException("Clipboard blocked", "NotAllowedError");
      },
    );
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
    const control = createCopyButton(
      "https://twir.app/u/test",
      () => {},
      () => promise,
    );
    document.body.append(control.element);
    control.element.click();
    control.destroy();
    control.element.remove();
    resolve();
    await tick();
    assert(control.element.dataset.state === "copying", "destroyed control was updated");
  });
}

function testNotice(writeText: (text: string) => Promise<void>) {
  const attachShadow = Element.prototype.attachShadow;
  let root: ShadowRoot | undefined;
  Element.prototype.attachShadow = function (options) {
    root = attachShadow.call(this, options);
    return root;
  };
  try {
    const notify = createNotice(writeText);
    assert(root, "notice shadow root not created");
    return { notify, root, host: root.host };
  } finally {
    Element.prototype.attachShadow = attachShadow;
  }
}

async function checkNoticeCountdown() {
  const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  const waitForDismiss = () => new Promise<void>((resolve) => window.setTimeout(resolve, 3_100));
  let write: () => Promise<void> = async () => {};
  const { notify, root, host } = testNotice(() => write());

  await check(
    "successful copy starts a three-second countdown and dismisses a persistent notice",
    async () => {
      const pending = Promise.withResolvers<void>();
      write = () => pending.promise;
      try {
        notify("Uploaded. Copy the link:", ["https://twir.app/u/test"], true);
        const copy = root.querySelector<HTMLButtonElement>(".copy-button")!;
        const countdown = root.querySelector<HTMLElement>(".countdown")!;
        assert(countdown.hidden, "countdown visible before copying");
        copy.click();
        await tick();
        assert(countdown.hidden && host.isConnected, "countdown started before copy succeeded");
        pending.resolve();
        await tick();
        assert(!countdown.hidden, "countdown not shown after copying");
        const firstBar = countdown.firstElementChild!;
        assert(getComputedStyle(firstBar).animationDuration === "3s", "wrong countdown duration");
        write = () => Promise.resolve();
        copy.click();
        await tick();
        assert(
          countdown.firstElementChild !== firstBar,
          "repeat copy did not restart the countdown",
        );
        await waitForDismiss();
        assert(!host.isConnected, "persistent notice did not close after copying");
        await tick();
        assert(!host.isConnected, "dismissed notice was remounted");
      } finally {
        root.querySelector<HTMLButtonElement>("header button")!.click();
      }
    },
  );

  await check(
    "failed retry cancels an active countdown and leaves the notice visible",
    async () => {
      let fail = false;
      write = async () => {
        if (fail) throw new Error("Clipboard blocked");
      };
      try {
        notify("Uploaded. Copy the link:", ["https://twir.app/u/test"], true);
        const copy = root.querySelector<HTMLButtonElement>(".copy-button")!;
        copy.click();
        await tick();
        fail = true;
        copy.click();
        await tick();
        assert(
          root.querySelector<HTMLElement>(".countdown")!.hidden,
          "failed copy shows countdown",
        );
        assert(root.textContent!.includes("Clipboard blocked"), "copy error not shown");
        await waitForDismiss();
        assert(host.isConnected, "notice closed after a copy error");
      } finally {
        root.querySelector<HTMLButtonElement>("header button")!.click();
      }
    },
  );

  await check("updating a notice clears the previous copy countdown", async () => {
    write = async () => {};
    try {
      notify("Uploaded. Copy the link:", ["https://twir.app/u/test"], true);
      root.querySelector<HTMLButtonElement>(".copy-button")!.click();
      await tick();
      notify("Uploading another image…", [], true);
      assert(
        root.querySelector<HTMLElement>(".countdown")!.hidden,
        "stale countdown still visible",
      );
      await waitForDismiss();
      assert(host.isConnected, "previous countdown dismissed the updated notice");
    } finally {
      root.querySelector<HTMLButtonElement>("header button")!.click();
    }
  });
}

void checkClipboard();
