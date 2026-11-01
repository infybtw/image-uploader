// Test-only companion to the production background. No Twir requests are made.
import { browser } from "wxt/browser";
import { createAuthStore } from "../../src/twir-auth-store";

const store = createAuthStore(browser.storage.session);
browser.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== browser.runtime.id ||
    !sender.url ||
    new URL(sender.url).hostname !== "127.0.0.1" ||
    new URL(sender.url).pathname !== "/test" ||
    (message?.type !== "test-auth-seed" && message?.type !== "test-auth-clear")
  )
    return;
  void (async () => {
    if (message.type === "test-auth-clear") {
      await store.write({});
      await store.writeSession({});
      return { ok: true };
    }
    await store.write({
      client: { id: "test-client", redirectUri: "https://extension.chromiumapp.org/" },
      grant: { id: "test-grant", refreshToken: "test-refresh-secret" },
    });
    await store.writeSession({
      access: {
        grantId: "test-grant",
        token: "test-access-secret",
        expiresAt: Date.now() + 60_000,
      },
    });
    const reopened = createAuthStore(browser.storage.session);
    return {
      ok:
        (await reopened.read()).grant?.refreshToken === "test-refresh-secret" &&
        (await reopened.readSession()).access?.token === "test-access-secret",
    };
  })().then(respond, (error) => respond({ ok: false, error: String(error) }));
  return true;
});
