// Allow for the last text line arriving before the host chat's autoscroll runs.
const BOTTOM_THRESHOLD = 48;

function scrollContainer(message: Element, view: Window): HTMLElement | null {
  const document = message.ownerDocument;
  for (let parent = message.parentElement; parent; parent = parent.parentElement) {
    // Never scroll the stream page itself, only an enclosing chat viewport.
    if (parent === document.body || parent === document.documentElement) break;
    if (parent.clientHeight > 0 && /^(auto|scroll)$/.test(view.getComputedStyle(parent).overflowY))
      return parent;
  }
  return null;
}

export function createChatPreviewScroll(document: Document) {
  const view = document.defaultView;
  const pending = new Map<HTMLElement, { frame: number; top: number }>();
  let stopped = false;

  return {
    preserve<T>(message: Element, change: () => T): T {
      const container = !stopped && view ? scrollContainer(message, view) : null;
      // Measure before adding/removing a preview, not after its height has already
      // pushed a previously pinned chat away from the bottom.
      const pinned =
        container &&
        container.scrollHeight - container.clientHeight - container.scrollTop <= BOTTOM_THRESHOLD;
      const result = change();
      if (!pinned || !view) return result;

      container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
      const previous = pending.get(container);
      if (previous) {
        previous.top = container.scrollTop;
        return result;
      }
      const state = {
        top: container.scrollTop,
        frame: view.requestAnimationFrame(() => {
          pending.delete(container);
          // Finish after the host's layout work, unless the reader has moved in
          // the meantime. Coalesce multiple previews into one final correction.
          if (container.isConnected && Math.abs(container.scrollTop - state.top) <= 1)
            container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
        }),
      };
      pending.set(container, state);
      return result;
    },
    stop() {
      stopped = true;
      for (const { frame } of pending.values()) view?.cancelAnimationFrame(frame);
      pending.clear();
    },
  };
}
