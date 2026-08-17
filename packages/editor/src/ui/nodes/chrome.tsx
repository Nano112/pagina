/**
 * The chrome every block node view wears, so that all of them behave the same way.
 *
 * Two node views had a remove button, four had none, and the keyboard could not delete any of
 * them — which is how an author ended up with an admonition that survived eight Backspaces. The
 * rule is now one rule, and it lives here rather than being retyped per view:
 *
 *  - a quiet **remove** control, revealed on hover or focus, labelled with the thing it removes;
 *  - **clicking the chrome selects the node**, so cut, copy and drag reach the whole block and so
 *    Backspace has something to delete;
 *  - and the keystrokes themselves, which are ProseMirror commands in
 *    `src/model/block-controls.ts` because a React `keydown` cannot see ProseMirror's selection.
 *
 * The click-to-select handler deliberately ignores clicks that land on a control: selecting the
 * node blurs whatever the author was typing into, and a title field that loses focus on mousedown
 * is unusable.
 */
import { useCallback, type MouseEvent, type ReactNode } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Trash2 } from "lucide-react";

/** Controls own their own clicks; everything else in the chrome selects the node. */
const CONTROLS = "input, button, select, textarea, label, a, [contenteditable='true']";

export interface BlockChrome {
  /** Deletes the whole node. Bound to the remove control, and mirrored by Backspace/Delete. */
  readonly remove: () => void;
  /** Puts a `NodeSelection` on the node, so the clipboard and the keyboard can reach it. */
  readonly select: () => void;
  /** Spread onto the chrome element: a click anywhere but a control selects the node. */
  readonly chromeProps: { readonly onMouseDown: (event: MouseEvent) => void };
}

export function useBlockChrome(editor: Editor, getPos: () => number | undefined, node: ProseMirrorNode): BlockChrome {
  const remove = useCallback((): void => {
    const pos = getPos();
    if (pos === undefined) return;
    const { state, dispatch } = editor.view;
    dispatch(state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
    editor.commands.focus();
  }, [editor, getPos, node.nodeSize]);

  const select = useCallback((): void => {
    const pos = getPos();
    if (pos === undefined) return;
    const { state, dispatch } = editor.view;
    if (pos < 0 || pos >= state.doc.content.size) return;
    dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
    editor.view.focus();
  }, [editor, getPos]);

  const onMouseDown = useCallback(
    (event: MouseEvent): void => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement | null)?.closest(CONTROLS) !== null) return;
      event.preventDefault();
      select();
    },
    [select],
  );

  return { remove, select, chromeProps: { onMouseDown } };
}

export interface RemoveBlockProps {
  /** What the control removes, lower case: "admonition", "tab group", "figure". */
  readonly thing: string;
  readonly onRemove: () => void;
}

/** The remove control. Quiet until the block is hovered or something inside it has focus. */
export function RemoveBlock({ thing, onRemove }: RemoveBlockProps): ReactNode {
  return (
    <button
      type="button"
      className="pge-icon pge-block__remove"
      title={`Remove ${thing}`}
      aria-label={`Remove ${thing}`}
      onClick={onRemove}
    >
      <Trash2 size={14} aria-hidden="true" />
    </button>
  );
}
