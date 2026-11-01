import { observeChatPreviews } from "../../src/chat-previews";
import type { ResolvePreviewPage } from "../../src/preview-page";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await frame();
  await frame();
};
const atBottom = (element: HTMLElement) =>
  Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1;

function fixture(layout: string, resolvePage?: ResolvePreviewPage, historyHeight = 600) {
  const scroller = document.createElement("div");
  scroller.style.cssText =
    "position:fixed;top:0;right:0;width:280px;height:220px;overflow-y:auto;overflow-anchor:none;scroll-behavior:smooth";
  const root = document.createElement("div");
  root.id = "chatroom-messages";
  const history = document.createElement("div");
  history.style.height = `${historyHeight}px`;
  root.append(history);
  scroller.append(root);
  document.body.append(scroller);
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
  const stop = observeChatPreviews(
    root,
    layout === "kick" ? "kick.com" : "www.twitch.tv",
    resolvePage,
  );
  return {
    scroller,
    root,
    append(count = 1) {
      const message = document.createElement("div");
      message.className =
        layout === "7tv"
          ? "seventv-user-message"
          : layout === "kick"
            ? "chat-entry"
            : "chat-line__message";
      message.style.height = "24px";
      for (let index = 0; index < count; index++) {
        const link = document.createElement("a");
        link.href = `${location.origin}/preview-image?image=${index}`;
        link.textContent = "image";
        message.append(link);
      }
      if (layout === "7tv") {
        const row = document.createElement("div");
        row.className = "seventv-message";
        const slider = document.createElement("div");
        slider.className = "seventv-ban-slider";
        slider.style.overflow = "hidden";
        slider.append(message);
        row.append(slider);
        root.append(row);
      } else root.append(message);
      return message;
    },
    close() {
      stop();
      scroller.remove();
    },
    stop,
  };
}

export async function checkPreviewScroll(check: Check) {
  for (const layout of ["twitch", "kick", "7tv"]) {
    await check(`${layout}: native chat autoscroll includes the image preview`, async () => {
      const chat = fixture(layout);
      try {
        chat.append();
        // The host chat scrolls to the message before our MutationObserver runs.
        chat.scroller.scrollTo({ top: chat.scroller.scrollHeight, behavior: "instant" });
        await settle();
        assert(chat.root.querySelector("[data-imageuploader-preview]"), "preview missing");
        assert(atBottom(chat.scroller), "preview was left below the chat viewport");
        const preview = chat.root.querySelector("[data-imageuploader-preview]")!;
        assert(
          preview.getBoundingClientRect().bottom <=
            chat.scroller.getBoundingClientRect().bottom + 1,
          "preview not visible after autoscroll",
        );
      } finally {
        chat.close();
      }
    });

    await check(`${layout}: previews do not interrupt reading chat history`, async () => {
      const chat = fixture(layout);
      try {
        chat.scroller.scrollTo({ top: 100, behavior: "instant" });
        chat.append(2);
        await settle();
        assert(chat.scroller.scrollTop === 100, "preview pulled the reader down");
      } finally {
        chat.close();
      }
    });

    await check(`${layout}: a batch of previews keeps chat at the bottom`, async () => {
      const chat = fixture(layout);
      try {
        chat.append(2);
        chat.append();
        chat.scroller.scrollTo({ top: chat.scroller.scrollHeight, behavior: "instant" });
        await settle();
        assert(atBottom(chat.scroller), "batched preview heights were not included");
      } finally {
        chat.close();
      }
    });
  }

  await check("previews include a new text line before native autoscroll runs", async () => {
    const chat = fixture("twitch");
    try {
      chat.append();
      await settle();
      assert(atBottom(chat.scroller), "the new text line prevented preview autoscroll");
    } finally {
      chat.close();
    }
  });

  await check(
    "scrolling up before the next frame cancels the final preview correction",
    async () => {
      const chat = fixture("twitch");
      try {
        chat.append();
        chat.scroller.scrollTo({ top: chat.scroller.scrollHeight, behavior: "instant" });
        await Promise.resolve();
        assert(chat.root.querySelector("[data-imageuploader-preview]"), "preview not mounted yet");
        chat.scroller.scrollTo({ top: 100, behavior: "instant" });
        await settle();
        assert(chat.scroller.scrollTop === 100, "pending frame pulled the reader back down");
      } finally {
        chat.close();
      }
    },
  );

  await check("previews follow the bottom when a short chat first starts overflowing", async () => {
    const chat = fixture("twitch", undefined, 0);
    try {
      chat.append(2);
      await settle();
      assert(chat.scroller.scrollHeight > chat.scroller.clientHeight, "fixture did not overflow");
      assert(atBottom(chat.scroller), "newly overflowing chat did not follow previews");
    } finally {
      chat.close();
    }
  });

  for (const readingHistory of [false, true]) {
    await check(
      `late metadata preview ${readingHistory ? "preserves history position" : "keeps chat at the bottom"}`,
      async () => {
        const result = Promise.withResolvers<string | null>();
        const chat = fixture("twitch", () => result.promise);
        try {
          chat.append();
          chat.scroller.scrollTo({ top: chat.scroller.scrollHeight, behavior: "instant" });
          await settle();
          const host = chat.root.querySelector<HTMLElement>("[data-imageuploader-preview]")!;
          host.shadowRoot!.querySelector("img")!.dispatchEvent(new Event("error"));
          await settle();
          if (readingHistory) chat.scroller.scrollTo({ top: 100, behavior: "instant" });
          result.resolve(`${location.origin}/preview-image?metadata`);
          await settle();
          assert(
            readingHistory ? chat.scroller.scrollTop === 100 : atBottom(chat.scroller),
            "late thumbnail did not respect the current scroll position",
          );
        } finally {
          result.resolve(null);
          chat.close();
        }
      },
    );
  }
}
