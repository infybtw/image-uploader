import { observeChatPreviews } from "../../src/chat-previews";
import { createSettings } from "../../src/settings";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
const preview = (message: Element) =>
  message.querySelector<HTMLElement>("[data-imageuploader-preview]");

function fixture(hostname: string, username: string) {
  const kick = hostname === "kick.com";
  const root = document.createElement("div");
  root.id = "chatroom-messages";
  const message = document.createElement("div");
  message.className = kick ? "chat-entry" : "chat-line__message";
  const author = document.createElement(kick ? "button" : "span");
  author.className = kick ? "font-bold" : "chat-author__display-name";
  if (!kick) author.setAttribute("data-a-user", username);
  author.textContent = username;
  const link = document.createElement("a");
  link.href = "https://images.example/photo.png";
  link.textContent = link.href;
  message.append(author, link);
  root.append(message);
  return { root, message, author, link };
}

export async function checkPreviewFilters(check: Check) {
  for (const hostname of ["www.twitch.tv", "kick.com"]) {
    await check(
      `${hostname}: username exclusions update existing and new messages without hiding text`,
      async () => {
        const settings = createSettings({ load: () => undefined, save: () => {} });
        await settings.ready;
        const { root, message, author, link } = fixture(hostname, "SomeUser");
        const stop = observeChatPreviews(root, hostname, undefined, undefined, () =>
          settings.get(),
        );
        const unsubscribe = settings.subscribe(() => stop.refresh());
        try {
          assert(preview(message), "initial preview missing");
          settings.update({ blockedUsers: ["@SOMEUSER"] });
          assert(!preview(message), "existing excluded preview remains");
          assert(
            link.parentElement === message && author.parentElement === message,
            "message content changed",
          );
          assert(
            message.textContent!.includes("SomeUser") && message.contains(link),
            "original message hidden",
          );
          const next = fixture(hostname, "SomeUser");
          root.append(next.message);
          await tick();
          assert(!preview(next.message), "new message bypassed exclusion");
          settings.update({ blockedUsers: [] });
          assert(
            preview(message) && preview(next.message),
            "removing exclusion did not restore previews",
          );
        } finally {
          unsubscribe();
          stop();
        }
      },
    );

    await check(
      `${hostname}: bot filtering uses known accounts or a badge, not nickname suffixes`,
      async () => {
        const settings = createSettings({ load: () => ({ hideBots: true }), save: () => {} });
        await settings.ready;
        for (const [name, badge, hidden] of [
          ["Nightbot", false, true],
          ["StreamElements", false, true],
          ["CustomService", true, true],
          ["FriendlyRobot", false, false],
        ] as const) {
          const { root, message } = fixture(hostname, name);
          if (badge) {
            const image = document.createElement("img");
            image.className = "chat-badge";
            image.alt = "Bot";
            message.prepend(image);
          }
          const stop = observeChatPreviews(root, hostname, undefined, undefined, () =>
            settings.get(),
          );
          try {
            assert(Boolean(preview(message)) !== hidden, `wrong bot classification for ${name}`);
            settings.update({ hideBots: false });
            stop.refresh();
            assert(preview(message), "turning off bot filter did not restore preview");
            settings.update({ hideBots: true });
          } finally {
            stop();
          }
        }
      },
    );
  }

  await check(
    "domain exclusions skip only matching links, including subdomains, before requesting images",
    async () => {
      const settings = createSettings({
        load: () => ({ blockedDomains: ["example.com"] }),
        save: () => {},
      });
      await settings.ready;
      const { root, message, link } = fixture("www.twitch.tv", "viewer");
      link.href = "https://cdn.example.com/image.png";
      const allowed = document.createElement("a");
      allowed.href = "https://notexample.com/image.png";
      message.append(allowed);
      let requests = 0;
      const stop = observeChatPreviews(
        root,
        "twitch.tv",
        async () => {
          requests++;
          return null;
        },
        undefined,
        () => settings.get(),
      );
      try {
        const images = preview(message)?.shadowRoot?.querySelectorAll("img");
        assert(
          images?.length === 1 && images[0]!.src === allowed.href,
          "excluded image created or allowed link hidden",
        );
        assert(requests === 0, "blocked link requested metadata");
        assert(message.contains(link) && message.contains(allowed), "original links removed");
      } finally {
        stop();
      }
    },
  );

  await check("unrelated exclusion edits do not recreate allowed previews", async () => {
    const settings = createSettings({ load: () => undefined, save: () => {} });
    await settings.ready;
    const { root, message } = fixture("www.twitch.tv", "viewer");
    const stop = observeChatPreviews(root, "twitch.tv", undefined, undefined, () => settings.get());
    try {
      const host = preview(message);
      settings.update({ blockedUsers: ["unrelated"] });
      stop.refresh();
      assert(preview(message) === host, "allowed images recreated while editing filters");
      settings.update({ blockedDomains: ["other.site"] });
      stop.refresh();
      assert(preview(message) === host, "unrelated domain change recreated images");
    } finally {
      stop();
    }
  });

  await check("metadata thumbnails from excluded domains never load", async () => {
    const settings = createSettings({
      load: () => ({ blockedDomains: ["cdn.example"] }),
      save: () => {},
    });
    await settings.ready;
    const { root, message } = fixture("www.twitch.tv", "viewer");
    const stop = observeChatPreviews(
      root,
      "twitch.tv",
      async () => "https://img.cdn.example/thumb.png",
      undefined,
      () => settings.get(),
    );
    try {
      const image = preview(message)!.shadowRoot!.querySelector("img")!;
      const source = image.src;
      image.dispatchEvent(new Event("error"));
      await tick();
      assert(image.src === source && !preview(message), "excluded metadata source was loaded");
    } finally {
      stop();
    }
  });

  await check("changing a domain exclusion removes and restores resolved thumbnails", async () => {
    const settings = createSettings({ load: () => undefined, save: () => {} });
    await settings.ready;
    const { root, message } = fixture("www.twitch.tv", "viewer");
    const source = "https://cdn.example/thumb.png";
    const stop = observeChatPreviews(
      root,
      "twitch.tv",
      async () => source,
      undefined,
      () => settings.get(),
    );
    try {
      const loadMetadata = async () => {
        preview(message)!.shadowRoot!.querySelector("img")!.dispatchEvent(new Event("error"));
        await tick();
      };
      await loadMetadata();
      assert(
        preview(message)!.shadowRoot!.querySelector("img")!.src === source,
        "metadata not loaded",
      );
      settings.update({ blockedDomains: ["cdn.example"] });
      stop.refresh();
      await loadMetadata();
      assert(!preview(message), "existing excluded thumbnail retained");
      settings.update({ blockedDomains: [] });
      stop.refresh();
      await loadMetadata();
      assert(
        preview(message)!.shadowRoot!.querySelector("img")!.src === source,
        "removed exclusion did not restore thumbnail",
      );
    } finally {
      stop();
    }
  });

  await check(
    "changing filters invalidates pending metadata and author edits reapply exclusions",
    async () => {
      const settings = createSettings({ load: () => undefined, save: () => {} });
      await settings.ready;
      const { root, message, author } = fixture("www.twitch.tv", "viewer");
      const pending = Promise.withResolvers<string | null>();
      const stop = observeChatPreviews(
        root,
        "twitch.tv",
        () => pending.promise,
        undefined,
        () => settings.get(),
      );
      const unsubscribe = settings.subscribe(() => stop.refresh());
      try {
        const image = preview(message)!.shadowRoot!.querySelector("img")!;
        const source = image.src;
        image.dispatchEvent(new Event("error"));
        await tick();
        settings.update({ blockedUsers: ["viewer"] });
        pending.resolve("https://images.example/late.png");
        await tick();
        assert(
          !preview(message) && image.src === source,
          "late metadata restored excluded preview",
        );
        author.setAttribute("data-a-user", "other");
        await tick();
        assert(preview(message), "changed author did not restore preview");
        author.setAttribute("data-a-user", "viewer");
        await tick();
        assert(!preview(message), "changed author bypassed exclusion");
      } finally {
        unsubscribe();
        stop();
      }
    },
  );
}
