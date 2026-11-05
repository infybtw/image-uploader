type TextField = HTMLInputElement | HTMLTextAreaElement;
export type Editor = TextField | HTMLElement;

// Slate and Lexical keep their source of truth outside the DOM. Changing only the
// DOM lets the next editor reconciliation duplicate or erase the text. A synthetic
// beforeinput is handled by both editors and works from an isolated extension world.
function insertRichText(target: HTMLElement, text: string): boolean {
  return !target.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
}

function isStatefulEditor(element: HTMLElement): boolean {
  return (
    element.matches('[data-lexical-editor="true"], [data-slate-editor="true"]') ||
    Boolean(element.querySelector('[data-lexical-editor="true"], [data-slate-editor="true"]'))
  );
}

function isTextField(element: HTMLElement): element is TextField {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

export function findEditor(target: EventTarget | null): Editor | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.closest('[inert], [aria-disabled="true"]')) return null;
  if (target instanceof HTMLTextAreaElement)
    return target.disabled || target.readOnly ? null : target;
  if (target instanceof HTMLInputElement) {
    return ["text", "search", "url"].includes(target.type) && !target.disabled && !target.readOnly
      ? target
      : null;
  }
  if (!target.isContentEditable) return null;
  let editor = target;
  while (editor.parentElement?.isContentEditable) editor = editor.parentElement;
  return editor;
}

// Twitch sends on Enter and uses Shift+Enter for a newline. Kick's send button
// sits in the same composer, so watch both without touching the message itself.
const SEND_BUTTON =
  'button[type="submit"], [data-a-target="chat-send-button"], [data-testid="send-message-button"], [aria-label="Send"]';

export function observeSend(editor: Editor, onSend: () => void): () => void {
  const doc = editor.ownerDocument;
  const container = editor.closest(".chat-input, #chatroom-footer");
  const scope =
    container && container !== editor ? container : (editor.parentElement ?? doc.documentElement);
  const onKeyDown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key !== "Enter" || key.isComposing) return;
    if (key.shiftKey || key.ctrlKey || key.altKey || key.metaKey) return;
    onSend();
  };
  const onClick = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest(SEND_BUTTON);
    if (!button || !scope.contains(button)) return;
    if (button.matches(":disabled, [aria-disabled='true']")) return;
    onSend();
  };
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (form instanceof Node && (form === editor || form.contains(editor))) onSend();
  };
  editor.addEventListener("keydown", onKeyDown);
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("submit", onSubmit, true);
  return () => {
    editor.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("submit", onSubmit, true);
  };
}

export interface InsertionPoint {
  insert(text: string): boolean;
  dispose(): void;
}

export function captureInsertionPoint(editor: Editor): InsertionPoint {
  const page = location.href;
  const original = isTextField(editor) ? editor.value : editor.innerHTML;
  const start = isTextField(editor) ? editor.selectionStart : null;
  const end = isTextField(editor) ? editor.selectionEnd : null;
  const selection = window.getSelection();
  const range =
    !isTextField(editor) &&
    selection?.rangeCount &&
    editor.contains(selection.getRangeAt(0).commonAncestorContainer)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  // Even typing and then deleting changes the draft: don't restore stale selections.
  let changed = false;
  const markChanged = () => {
    changed = true;
  };
  editor.addEventListener("input", markChanged);

  return {
    dispose() {
      editor.removeEventListener("input", markChanged);
    },
    insert(text) {
      editor.removeEventListener("input", markChanged);
      if (changed || !editor.isConnected || location.href !== page || findEditor(editor) !== editor)
        return false;
      if ((isTextField(editor) ? editor.value : editor.innerHTML) !== original) return false;
      // Do not steal focus from another editor while the request is in flight.
      if (document.activeElement !== editor && !editor.contains(document.activeElement))
        return false;
      if (isTextField(editor)) {
        if (start === null || end === null) return false;
        editor.setSelectionRange(start, end);
      } else {
        if (!range || !selection || !editor.contains(range.commonAncestorContainer)) return false;
        selection.removeAllRanges();
        selection.addRange(range);
        const target =
          document.activeElement instanceof HTMLElement && editor.contains(document.activeElement)
            ? document.activeElement
            : editor;
        if (insertRichText(target, text)) return true;
        // Never fall back to a DOM-only edit in an editor with external state.
        if (isStatefulEditor(editor)) return false;
      }
      // Native editing updates Slate/Lexical/React and preserves the undo stack.
      if (document.execCommand("insertText", false, text)) return true;
      if (!isTextField(editor)) return false; // Never mutate a rich editor's DOM behind its framework.
      const prototype =
        editor instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter || start === null || end === null) return false;
      setter.call(editor, original.slice(0, start) + text + original.slice(end));
      editor.setSelectionRange(start + text.length, start + text.length);
      editor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
      );
      return true;
    },
  };
}
