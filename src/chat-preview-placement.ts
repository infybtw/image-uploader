const SEVENTV_ROW = ".seventv-message";

interface PreviewSlot {
  parent: Element;
  after: Element | null;
}

// Keep previews outside the chat renderer's message subtree. 7TV wraps messages
// in a moderation slider; mounting inside it makes the slider cover the preview.
export function previewSlot(message: Element): PreviewSlot | null {
  const row = message.closest(SEVENTV_ROW);
  if (row && row !== message) return { parent: row, after: null };
  const parent = message.parentElement;
  return parent ? { parent, after: message } : null;
}

export function mountPreview(host: HTMLElement, message: Element): boolean {
  const slot = previewSlot(message);
  if (!slot) return false;
  if (!slot.after) {
    if (host.parentElement !== slot.parent) slot.parent.append(host);
    return true;
  }
  if (host.parentElement !== slot.parent || host.previousElementSibling !== slot.after) {
    slot.after.after(host);
  }
  return true;
}

export function isPreviewMounted(host: HTMLElement, message: Element): boolean {
  const slot = previewSlot(message);
  if (!slot) return false;
  if (host.parentElement !== slot.parent) return false;
  return slot.after ? host.previousElementSibling === slot.after : true;
}
