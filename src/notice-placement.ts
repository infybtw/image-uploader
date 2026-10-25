const CHAT_INPUT = '.chat-input, [data-a-target="chat-input"]';
const FLOATING_STYLE =
  "all:initial;display:block;position:fixed;top:20px;right:20px;z-index:2147483647;max-width:calc(100vw - 40px)";
const INLINE_STYLE =
  "all:initial;display:block;position:relative;width:100%;min-width:0;margin-bottom:8px";

function isChatContainer(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    !element.isContentEditable &&
    !element.matches("input, textarea")
  );
}

export function findTwitchChatInput(editor: HTMLElement, hostname = location.hostname) {
  if (hostname !== "twitch.tv" && !hostname.endsWith(".twitch.tv")) return null;
  // Twitch can put data-a-target="chat-input" on the contenteditable itself.
  const container = editor.closest(".chat-input") ?? editor.closest('[data-a-target="chat-input"]');
  return container !== editor && isChatContainer(container) ? container : null;
}

// Keep our DOM outside the editor, and recover if Twitch replaces the chat input.
export function mountNotice(host: HTMLElement, chatInput: Element | null) {
  const inline = chatInput !== null;
  const place = () => {
    if (inline && !chatInput?.isConnected) {
      chatInput = [...document.querySelectorAll(CHAT_INPUT)].find(isChatContainer) ?? null;
    }
    const target = chatInput?.isConnected ? chatInput : null;
    const placement = target ? "chat" : "floating";
    if (host.dataset.placement !== placement) {
      host.dataset.placement = placement;
      host.style.cssText = target ? INLINE_STYLE : FLOATING_STYLE;
    }
    if (target) {
      if (host.parentElement !== target) target.prepend(host);
    } else if (host.parentElement !== document.documentElement) {
      document.documentElement.append(host);
    }
  };
  place();
  const observer = inline ? new MutationObserver(place) : null;
  observer?.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer?.disconnect();
}
