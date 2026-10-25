import { captureInsertionPoint, findEditor } from "../../src/editor";
import { browser } from "wxt/browser";
import { serializeImage } from "../../src/clipboard";
import { errorMessage } from "../../src/shared";
import { createCopyButton } from "../../src/copy-button";
import { createNotice } from "../../src/notice";
import { findTwitchChatInput, mountNotice } from "../../src/notice-placement";
import type { UploadReply } from "../../src/shared";
import { observeChatPreviews } from "../../src/chat-previews";

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

// Detached fixtures keep lazy images offscreen: these checks make no image requests.
function previewChat(hostname = "www.twitch.tv") {
  const root = document.createElement("div");
  root.id = "chatroom-messages";
  const message = document.createElement("div");
  message.className = hostname.endsWith("kick.com") ? "chat-entry" : "chat-line__message";
  const link = document.createElement("a");
  link.href = "https://twir.app/u/AbC123";
  link.textContent = link.href;
  message.append(link);
  root.append(message);
  return { root, message, link };
}

function previewHost(message: Element) {
  return message.querySelector<HTMLElement>("[data-imageuploader-preview]");
}

for (const hostname of ["www.twitch.tv", "kick.com"]) {
  test(`${hostname}: Uploader thumbnail is below the unchanged message link`, () => {
    const { root, message, link } = previewChat(hostname);
    const stop = observeChatPreviews(root, hostname);
    try {
      const host = previewHost(message);
      assert(host && message.lastElementChild === host, "preview not below message");
      assert(message.firstElementChild === link && link.textContent === link.href, "link changed");
      const image = host.shadowRoot!.querySelector("img")!;
      assert(image.src === link.href, "wrong image source");
      assert(image.loading === "lazy" && image.decoding === "async", "eager image loading");
      assert(image.referrerPolicy === "no-referrer", "page referrer can leak");
      const previewLink = image.parentElement as HTMLAnchorElement;
      assert(
        previewLink.target === "_blank" && previewLink.rel.includes("noreferrer"),
        "unsafe link",
      );
    } finally {
      stop();
    }
    assert(!previewHost(message), "cleanup left a preview behind");
  });
}

test("previews ignore other Twir pages, outside-chat links, editors and lookalike sites", () => {
  const { root, message, link } = previewChat();
  link.href = "https://twir.app/uploader";
  const outside = document.createElement("a");
  outside.href = "https://twir.app/u/Outside";
  root.append(outside);
  const editor = message.cloneNode(true) as HTMLElement;
  editor.contentEditable = "true";
  (editor.firstElementChild as HTMLAnchorElement).href = "https://twir.app/u/Draft";
  root.append(editor);
  const stop = observeChatPreviews(root, "www.twitch.tv");
  try {
    assert(!root.querySelector("[data-imageuploader-preview]"), "non-chat/image link previewed");
  } finally {
    stop();
  }
  link.href = "https://twir.app/u/AbC123";
  const stopUnsupported = observeChatPreviews(root, "twitch.tv.evil.com");
  assert(!previewHost(message), "unsupported host previewed");
  stopUnsupported();
});

test("duplicate image URLs are collapsed and previews per message are bounded", () => {
  const { root, message, link } = previewChat();
  for (const id of ["AbC123?duplicate=1", "Second", "Third", "Fourth"]) {
    const other = link.cloneNode(true) as HTMLAnchorElement;
    other.href = `https://twir.app/u/${id}`;
    message.append(other);
  }
  const stop = observeChatPreviews(root, "twitch.tv");
  try {
    assert(previewHost(message)?.shadowRoot?.querySelectorAll("img").length === 3, "wrong limit");
    assert(message.querySelectorAll("a").length === 5, "original links changed");
  } finally {
    stop();
  }
});

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
  await checkChatPreviews();
  await checkNoticePlacement();
  await checkCopyButtons();
  await checkNoticeCountdown();
  await fetch("/results", { method: "POST", body: JSON.stringify(results) });
}

async function checkChatPreviews() {
  const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  await check(
    "previews follow new messages, edited/deleted links and chat remounts without duplicates",
    async () => {
      const { root, message, link } = previewChat();
      const stop = observeChatPreviews(root, "twitch.tv");
      try {
        await tick();
        const first = previewHost(message);
        message.prepend(document.createTextNode("edited message "));
        await tick();
        assert(previewHost(message) === first, "unrelated mutations recreated preview");
        link.href = "http://twir.app/u/Changed?tracking=1#fragment";
        await tick();
        assert(
          previewHost(message)?.shadowRoot?.querySelector("img")?.src ===
            "https://twir.app/u/Changed",
          "edited URL ignored",
        );
        link.remove();
        await tick();
        assert(!previewHost(message), "deleted link left a preview");
        root.replaceChildren();
        const replacement = previewChat();
        root.append(replacement.message);
        await tick();
        assert(previewHost(replacement.message), "remounted chat ignored");
        replacement.message.querySelector("[data-imageuploader-preview]")!.remove();
        await tick();
        assert(
          replacement.message.querySelectorAll("[data-imageuploader-preview]").length === 1,
          "removed preview not restored exactly once",
        );
      } finally {
        stop();
      }
    },
  );
  await check("failed images disappear without retries or removing the original link", async () => {
    const { root, message, link } = previewChat();
    const stop = observeChatPreviews(root, "twitch.tv");
    try {
      previewHost(message)!.shadowRoot!.querySelector("img")!.dispatchEvent(new Event("error"));
      await tick();
      assert(!previewHost(message), "broken image retained");
      message.prepend(document.createTextNode("updated "));
      await tick();
      assert(!previewHost(message), "broken image retried");
      assert(link.parentElement === message, "original link removed");
    } finally {
      stop();
    }
  });
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

type TestNoticeFactory = (
  writeText: (text: string) => Promise<void>,
  chatInput?: Element | null,
) => { notify: ReturnType<typeof createNotice>; root: ShadowRoot; host: Element };

async function captureNotices(run: (create: TestNoticeFactory) => Promise<void>) {
  const attachShadow = Element.prototype.attachShadow;
  const roots: ShadowRoot[] = [];
  Element.prototype.attachShadow = function (options) {
    const root = attachShadow.call(this, options);
    roots.push(root);
    return root;
  };
  try {
    await run((writeText, chatInput = null) => {
      const index = roots.length;
      const notify = createNotice(writeText, chatInput);
      const root = roots[index];
      assert(root, "notice shadow root not created");
      return { notify, root, host: root.host };
    });
  } finally {
    Element.prototype.attachShadow = attachShadow;
  }
}

async function checkNoticePreviews(testNotice: TestNoticeFactory) {
  const { chat } = twitchChat();
  try {
    for (const placement of [null, chat]) {
      await check(
        `${placement ? "inline" : "floating"} upload panel shows a preview for each link`,
        async () => {
          let copied = "";
          const { notify, root } = testNotice(async (text) => {
            copied = text;
          }, placement);
          const urls = ["https://twir.app/u/First", "https://twir.app/u/Second"];
          try {
            notify("Uploaded. Copy the link:", urls, true);
            const images = root.querySelectorAll<HTMLImageElement>(".preview img");
            assert(images.length === 2, "missing upload previews");
            for (const [index, image] of images.entries()) {
              const preview = image.parentElement as HTMLAnchorElement;
              assert(
                image.src === urls[index] && preview.href === urls[index],
                "wrong preview URL",
              );
              assert(
                image.loading === "lazy" && image.decoding === "async",
                "eager preview loading",
              );
              assert(image.referrerPolicy === "no-referrer", "page referrer can leak");
              assert(
                preview.target === "_blank" && preview.rel.includes("noreferrer"),
                "unsafe preview link",
              );
              assert(
                preview.nextElementSibling?.className === "link",
                "preview not above its copy row",
              );
            }
            const links = root.querySelector<HTMLElement>(".links")!;
            assert(getComputedStyle(links).overflowY === "auto", "multiple uploads cannot scroll");
            images[0]!.dispatchEvent(new Event("error"));
            assert(root.querySelectorAll(".preview").length === 1, "broken preview retained");
            const inputs = root.querySelectorAll<HTMLInputElement>("input");
            assert(
              inputs.length === 2 && inputs[0]!.value === urls[0],
              "broken image removed its link",
            );
            root.querySelectorAll<HTMLButtonElement>(".copy-button")[1]!.click();
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
            assert(copied === urls[1], "preview changed copy behavior");
            notify("Uploading another image…", [], true);
            assert(!root.querySelector(".preview, .link"), "update retained old previews or links");
            notify("Not an Uploader image", ["https://twir.app/uploader"], true);
            assert(!root.querySelector(".preview"), "non-image URL previewed");
          } finally {
            root.querySelector<HTMLButtonElement>("header button")!.click();
          }
        },
      );
    }
  } finally {
    chat.remove();
  }
}

async function checkNoticeCountdown() {
  await captureNotices(async (testNotice) => {
    await checkNoticePreviews(testNotice);
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

    await check(
      "repeat copy cancels the old countdown before calling the Tampermonkey clipboard API",
      async () => {
        const countdown = root.querySelector<HTMLElement>(".countdown")!;
        let canceledBeforeWrite = false;
        write = () => {
          canceledBeforeWrite = countdown.hidden === true;
          // GM.setClipboard can return an already-fulfilled promise. Native clicks
          // may run its continuation before the next non-capturing click listener.
          return Promise.resolve();
        };
        try {
          notify("Uploaded. Copy the link:", ["https://twir.app/u/test"], true);
          const copy = root.querySelector<HTMLButtonElement>(".copy-button")!;
          copy.click();
          await tick();
          assert(!countdown.hidden, "initial copy did not start the countdown");
          copy.click();
          await tick();
          assert(canceledBeforeWrite, "old countdown was canceled after the clipboard call");
          assert(!countdown.hidden, "successful repeat copy lost its new countdown");
          await waitForDismiss();
          assert(!host.isConnected, "notice did not close after the repeat copy");
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

    await check(
      "new notices replace both floating and inline notices without reviving stale uploads",
      async () => {
        const { chat } = twitchChat();
        try {
          for (const placement of [null, chat]) {
            const pending = Promise.withResolvers<void>();
            const old = testNotice(() => pending.promise, placement);
            old.notify("Old upload", ["https://twir.app/u/old"], true);
            const copy = old.root.querySelector<HTMLButtonElement>(".copy-button")!;
            copy.click();
            const latest = testNotice(async () => {});
            try {
              latest.notify("New upload", [], true);
              assert(!old.host.isConnected, "previous notice is still visible");
              assert(latest.host.isConnected, "new notice is missing");
              pending.resolve();
              old.notify("Late upload result", ["https://twir.app/u/stale"], true);
              await tick();
              assert(!old.host.isConnected, "superseded notice was remounted");
              assert(copy.dataset.state === "copying", "pending copy updated a superseded notice");
              old.root.querySelector<HTMLButtonElement>("header button")!.click();
              assert(latest.host.isConnected, "old close handler dismissed the new notice");
            } finally {
              latest.root.querySelector<HTMLButtonElement>("header button")!.click();
            }
          }
        } finally {
          chat.remove();
        }
      },
    );

    await check("a replaced notice's copy countdown cannot dismiss the new notice", async () => {
      const old = testNotice(async () => {});
      old.notify("Old upload", ["https://twir.app/u/old"], true);
      old.root.querySelector<HTMLButtonElement>(".copy-button")!.click();
      await tick();
      const latest = testNotice(async () => {});
      try {
        latest.notify("New upload", [], true);
        await waitForDismiss();
        assert(!old.host.isConnected, "previous countdown notice reappeared");
        assert(latest.host.isConnected, "old countdown dismissed the new notice");
      } finally {
        latest.root.querySelector<HTMLButtonElement>("header button")!.click();
      }
    });
  });
}

void checkClipboard();
