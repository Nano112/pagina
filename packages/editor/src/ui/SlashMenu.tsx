/**
 * `/` at the start of an empty-ish line opens the block menu.
 *
 * There is no ProseMirror plugin behind this and deliberately so: the trigger is a *reading* of the
 * selection after each transaction, and the menu is ordinary React positioned at the caret. That
 * keeps the document model out of it entirely — nothing here can decorate, transform or block a
 * transaction, so a bug in the menu can never corrupt a page.
 *
 * The slash and its query are deleted before the chosen block is inserted, in one chain each, so an
 * undo takes the author back to the text they typed rather than to a half-applied state.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import type { ArticleStore } from "../store/index.js";
import { filterInserts, type InsertAction, type InsertContext } from "./inserts.js";
import { useFigureBuilder, useNotify, usePagePath } from "./context.js";

/** The trigger: a `/` at the start of a text block, followed by word characters only. */
const TRIGGER = /^\/([\w-]*)$/;

interface Trigger {
  readonly query: string;
  /** Document range covering the `/query` text, so it can be removed before inserting. */
  readonly from: number;
  readonly to: number;
  readonly left: number;
  readonly top: number;
}

/**
 * Reads the trigger out of the current selection, or `undefined` when there is not one.
 *
 * Code is excluded in both of its forms, for the same reason: `/` is a character there, not a
 * command. A fenced block is a node (`codeBlock`); inline code is a *mark*, which has to be read
 * off the stored marks (set but not yet applied, right after `⌘E`) as well as off the marks either
 * side of the caret, or `/join` inside `` `…` `` opens the menu and then eats what was typed.
 */
function triggerAt(editor: Editor): Trigger | undefined {
  const { selection } = editor.state;
  if (!selection.empty) return undefined;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock") return undefined;
  const code = editor.schema.marks["code"];
  if (code !== undefined && code.isInSet(editor.state.storedMarks ?? $from.marks()) !== undefined) {
    return undefined;
  }
  const start = $from.start();
  const text = editor.state.doc.textBetween(start, $from.pos, "\n", "￼");
  const match = TRIGGER.exec(text);
  if (match === null) return undefined;
  const coords = editor.view.coordsAtPos($from.pos);
  return { query: match[1] ?? "", from: start, to: $from.pos, left: coords.left, top: coords.bottom };
}

export interface SlashMenuProps {
  readonly editor: Editor | null;
  readonly store: ArticleStore;
  /** Opens the host's file chooser — the `upload` action's only way out of the document model. */
  readonly onPickFile: () => void;
}

export function SlashMenu({ editor, store, onPickFile }: SlashMenuProps): ReactNode {
  const pagePath = usePagePath();
  const openBuilder = useFigureBuilder();
  const notify = useNotify();
  const [trigger, setTrigger] = useState<Trigger | undefined>(undefined);
  const [active, setActive] = useState(0);
  /** Dismissed with Escape: stays shut until the author leaves the line and types `/` again. */
  const dismissed = useRef(false);

  const actions = trigger === undefined ? [] : filterInserts(trigger.query);
  const current = Math.min(active, Math.max(actions.length - 1, 0));

  // The state the keyboard handler needs, in a ref: the handler is installed once per editor, and
  // re-installing it on every keystroke would drop keys pressed during the re-render.
  const view = useRef({ trigger, actions, current });
  view.current = { trigger, actions, current };

  const choose = useCallback(
    (action: InsertAction): void => {
      const at = view.current.trigger;
      if (editor === null || at === undefined) return;
      setTrigger(undefined);
      dismissed.current = true;
      editor.chain().focus().deleteRange({ from: at.from, to: at.to }).run();
      const ctx: InsertContext = {
        editor,
        store,
        pagePath,
        ...(openBuilder === undefined ? {} : { openBuilder }),
        ...(notify === undefined ? {} : { notify }),
        pickFile: onPickFile,
      };
      action.run(ctx);
    },
    [editor, store, pagePath, openBuilder, notify, onPickFile],
  );

  useEffect(() => {
    if (editor === null) return;
    const update = (): void => {
      const next = triggerAt(editor);
      if (next === undefined) {
        dismissed.current = false;
        setTrigger(undefined);
        return;
      }
      if (dismissed.current) return;
      setTrigger(next);
      setActive(0);
    };
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  useEffect(() => {
    if (editor === null) return;
    const onKey = (event: KeyboardEvent): void => {
      const state = view.current;
      if (state.trigger === undefined) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dismissed.current = true;
        setTrigger(undefined);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => {
          const count = state.actions.length;
          return count === 0 ? 0 : (((index + delta) % count) + count) % count;
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        const action = state.actions[state.current];
        if (action === undefined) return;
        event.preventDefault();
        choose(action);
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
  }, [editor, choose]);

  if (trigger === undefined || actions.length === 0) return null;

  return (
    <div
      className="pge-slash"
      role="listbox"
      aria-label="Insert block"
      style={{ left: `${trigger.left}px`, top: `${trigger.top + 6}px` }}
    >
      {actions.map((action, index) => (
        <div key={action.id}>
          {index === 0 || actions[index - 1]!.group !== action.group ? (
            <p className="pge-slash__group">{action.group}</p>
          ) : null}
          <button
            type="button"
            role="option"
            className="pge-slash__item"
            aria-selected={index === current}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(action)}
          >
            {action.label}
          </button>
        </div>
      ))}
    </div>
  );
}
