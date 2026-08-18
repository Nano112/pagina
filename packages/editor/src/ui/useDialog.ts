/**
 * What every modal in the editor owes the keyboard.
 *
 * `role="dialog" aria-modal="true"` is a promise to an assistive technology that the rest of the
 * page is unreachable while the dialog is open. The editor's dialogs made that promise and did not
 * keep it: Tab walked straight out of them into the toolbar behind, and closing one left focus on
 * `<body>`, which is where the next Tab starts from — so an author who opened the pages list with
 * the keyboard could not get back to what they were editing.
 *
 * Three obligations, in one hook, because they are always wanted together:
 *
 *  - **Escape closes.** Captured on the dialog rather than on the document, so a nested control
 *    that wants Escape for itself (an inline rename, a native select) can stop it first.
 *  - **Tab is trapped.** Wrapping at both ends, over whatever is focusable *now* — a dialog's
 *    contents change while it is open, so the list cannot be computed once.
 *  - **Focus is restored.** To the element that had it when the dialog opened, which is the control
 *    that opened it.
 */
import { useEffect, useRef, type RefObject } from "react";

/** Everything the browser will focus, minus the things it will not. */
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Hidden-ness is tested with the `hidden` attribute rather than with layout (`offsetParent`,
 * `getClientRects`) on purpose: layout is what jsdom does not have, so a layout-based filter makes
 * every stop invisible under test and silently turns the trap off in exactly the place that is
 * supposed to prove it is on.
 */
const focusable = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.closest("[hidden]") === null);

/**
 * Attaches modal keyboard behaviour to the element the returned ref is put on.
 *
 * `onClose` is read through a ref so a caller may pass an inline arrow without re-installing the
 * listeners on every render.
 */
export function useDialog(onClose: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const doc = root.ownerDocument;
    const restoreTo = doc.activeElement;

    // Focus the first thing in the dialog, so the keyboard starts inside it rather than behind it.
    (focusable(root)[0] ?? root).focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = focusable(root);
      if (stops.length === 0) return;
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = doc.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) restoreTo.focus();
    };
  }, []);

  return ref;
}
