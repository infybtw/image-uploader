import { browser } from "wxt/browser";
import type { AccountAction, AccountReply, Accounts } from "./accounts";

export function createExtensionAccounts(): Accounts {
  async function send(type: AccountAction) {
    const reply: AccountReply | undefined = await browser.runtime.sendMessage({ type });
    if (!reply)
      throw new Error("The extension background is unavailable. Reload the page and try again.");
    if (!reply.ok) throw new Error(reply.error);
    return reply;
  }
  return {
    async status() {
      return (await send("twir-status")).status;
    },
    async connect() {
      await send("twir-connect");
    },
    async disconnect() {
      return { revoked: (await send("twir-disconnect")).revoked === true };
    },
  };
}
