import type { Accounts, TwirAccountStatus } from "./accounts";
import { errorMessage } from "./shared";

export function createAccountsUi(doc: Document, accounts?: Accounts) {
  const section = doc.createElement("section");
  section.className = "account";
  section.setAttribute("aria-labelledby", "twir-account-title");
  const title = doc.createElement("strong");
  title.id = "twir-account-title";
  title.textContent = "Twir";
  const description = doc.createElement("p");
  description.className = "status";
  description.textContent =
    "Connect Twir to save new uploads to your account. Images are still public by link.";
  const state = doc.createElement("p");
  state.className = "status";
  state.setAttribute("role", "status");
  state.setAttribute("aria-live", "polite");
  section.append(title, description, state);

  if (!accounts) {
    state.textContent =
      "Not available in the userscript version. Install the Chrome or Firefox extension to connect an account.";
    return { section, dispose() {} };
  }

  const scope = doc.createElement("p");
  scope.className = "status";
  scope.textContent =
    "Twir grants file upload and deletion access together. Viewer Companion only uses it to upload images.";
  const actions = doc.createElement("div");
  actions.className = "actions";
  const connect = doc.createElement("button");
  connect.type = "button";
  connect.className = "action primary";
  connect.textContent = "Connect Twir";
  const disconnect = doc.createElement("button");
  disconnect.type = "button";
  disconnect.className = "action";
  disconnect.textContent = "Disconnect";
  disconnect.hidden = true;
  const feedback = doc.createElement("p");
  feedback.className = "status";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  actions.append(connect, disconnect);
  section.append(scope, actions, feedback);

  let disposed = false;
  let busy = false;
  let current: TwirAccountStatus | undefined;
  let version = 0;
  const render = () => {
    state.textContent =
      current === "connected"
        ? "Connected · New uploads go to your Twir account."
        : current === "reconnect-required"
          ? "Connection expired · Reconnect to upload. Nothing will be uploaded anonymously."
          : current === "connecting"
            ? "Finish signing in in the Twir window."
            : current === "disconnected"
              ? "Not connected · Uploads are anonymous."
              : "Checking connection…";
    state.dataset.tone = current === "reconnect-required" ? "error" : "info";
    connect.textContent =
      current === "reconnect-required"
        ? "Reconnect Twir"
        : current === "connecting"
          ? "Connecting…"
          : "Connect Twir";
    connect.hidden = current === "connected";
    connect.disabled = busy || !current || current === "connecting";
    disconnect.hidden = !current || current === "disconnected";
    // Cancel remains available while the OAuth window is open.
    disconnect.disabled = busy && current !== "connecting";
    disconnect.textContent = current === "connecting" ? "Cancel sign-in" : "Disconnect";
  };
  const refresh = async () => {
    const requestVersion = version;
    try {
      const next = await accounts.status();
      if (disposed || requestVersion !== version) return;
      current = next;
      render();
    } catch {
      if (!disposed && requestVersion === version) {
        feedback.textContent = "Could not check Twir. Close settings and try again.";
        feedback.dataset.tone = "error";
      }
    }
  };
  const run = async (operation: "connect" | "disconnect") => {
    if (busy && !(operation === "disconnect" && current === "connecting")) return;
    const operationVersion = ++version;
    busy = true;
    feedback.textContent = "";
    feedback.dataset.tone = "info";
    if (operation === "connect") current = "connecting";
    render();
    try {
      if (operation === "connect") await accounts.connect();
      else {
        const result = await accounts.disconnect();
        if (!disposed && operationVersion === version) {
          feedback.textContent = result.revoked
            ? "Disconnected. Existing images have not been deleted."
            : "Disconnected on this device. Twir could not confirm revocation; revoke access in Twir to finish.";
        }
      }
    } catch (error) {
      if (!disposed && operationVersion === version) {
        feedback.textContent = errorMessage(error);
        feedback.dataset.tone = "error";
      }
    } finally {
      if (!disposed && operationVersion === version) {
        busy = false;
        await refresh();
      }
    }
  };
  connect.addEventListener("click", () => void run("connect"));
  disconnect.addEventListener("click", () => void run("disconnect"));
  render();
  void refresh();
  // Poll only while this panel is open and Accounts is visible. No credentials
  // are exposed through storage change events or runtime replies.
  const timer = doc.defaultView?.setInterval(() => {
    if (!doc.hidden && section.isConnected && !section.parentElement?.hidden && !busy)
      void refresh();
  }, 3_000);
  return {
    section,
    dispose() {
      disposed = true;
      doc.defaultView?.clearInterval(timer);
    },
  };
}
