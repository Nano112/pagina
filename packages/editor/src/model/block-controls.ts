/**
 * One rule for getting *out* of a block, and one for getting *rid* of it.
 *
 * Every custom node in the dialect is a box the caret can fall into: `admonition` and `tab` hold
 * content, the rest are atoms with a form on top. Before this, none of them could be removed from
 * the keyboard — selecting an admonition's whole body and pressing Backspace eight times left the
 * node, and its text, exactly where they were — and a block written as the last thing in a
 * document had nothing after it to click into. Both are the same defect wearing two hats: the
 * node knew how to exist and not how to stop.
 *
 * The commands here are ProseMirror commands, not DOM handling, because the node views are React
 * and a DOM-level `keydown` cannot see the selection ProseMirror is actually holding. They live in
 * `src/model` with the schema rather than in `src/ui` for the reason the whole model layer does:
 * no React, no DOM, so the round-trip tests can import it in Node.
 */
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Command, type EditorState } from "@tiptap/pm/state";

/**
 * The blocks a remove control removes and a `NodeSelection` + Backspace deletes.
 *
 * `tab` is deliberately absent: a single panel is removed by the tab strip's `×`, and deleting one
 * from under the caret would leave a tab group the author never asked to restructure. The group is
 * here instead.
 */
export const REMOVABLE_BLOCKS = ["tabs", "admonition", "snippet", "figureKg", "figureImage", "modelViewer", "htmlBlock"] as const;

/** Blocks with editable content, whose first position needs a way back out. */
const CONTAINERS = new Set(["admonition", "tab"]);

/** Containers whose content is lifted into the parent rather than thrown away. */
const LIFTABLE = new Set(["admonition"]);

const REMOVABLE = new Set<string>(REMOVABLE_BLOCKS);

/** Whether a node carries anything an author would mind losing. */
function isBlank(node: ProseMirrorNode): boolean {
  if (node.textContent.trim() !== "") return false;
  let carries = false;
  node.descendants((child) => {
    if (child.isAtom || child.isLeaf) carries = true;
    return !carries;
  });
  return !carries;
}

/** The removable block the selection is on or inside, innermost first. */
export function enclosingBlock(state: EditorState): { node: ProseMirrorNode; pos: number } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && REMOVABLE.has(selection.node.type.name)) {
    return { node: selection.node, pos: selection.from };
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (REMOVABLE.has(node.type.name)) return { node, pos: $from.before(depth) };
  }
  return null;
}

/**
 * The container the caret sits at the very *start* of, if any.
 *
 * "The very start" means the caret is at offset 0 of its textblock *and* that textblock is the
 * first child at every level down to the container — otherwise Backspace in the second paragraph
 * of an admonition would dissolve the block, which is a different keystroke's job.
 */
function containerAtStart(state: EditorState): { node: ProseMirrorNode; pos: number } | null {
  const { selection } = state;
  if (!selection.empty || selection.$from.parentOffset !== 0) return null;
  const { $from } = selection;
  let first = true;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (first && CONTAINERS.has(node.type.name)) return { node, pos: $from.before(depth) };
    if ($from.index(depth - 1) !== 0) first = false;
  }
  return null;
}

/** Deletes the block node a `NodeSelection` is on — what Backspace/Delete must do to a chrome click. */
export const deleteSelectedBlock: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || !REMOVABLE.has(selection.node.type.name)) return false;
  dispatch?.(state.tr.deleteSelection().scrollIntoView());
  return true;
};

/**
 * Backspace at the start of a container: lift, or remove, but never nothing.
 *
 * An empty container goes away entirely. A container with content is dissolved into its parent,
 * which is the non-destructive half — the author gets the text back as ordinary blocks rather
 * than losing it. A `tab` is neither: its group is `isolating` and restructuring it from a
 * keystroke is a worse outcome than the trap, so the *group* is removed when the whole thing is
 * empty and left alone otherwise.
 */
export const escapeBlockStart: Command = (state, dispatch) => {
  const target = containerAtStart(state);
  if (target === null) return false;
  const { node, pos } = target;

  if (LIFTABLE.has(node.type.name)) {
    const tr = state.tr;
    if (isBlank(node)) tr.delete(pos, pos + node.nodeSize);
    else tr.replaceWith(pos, pos + node.nodeSize, node.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, pos))));
    dispatch?.(tr.scrollIntoView());
    return true;
  }

  // A `tab`: reach for the group it belongs to.
  const group = enclosingBlock(state);
  if (group === null || !isBlank(group.node)) return false;
  const tr = state.tr.delete(group.pos, group.pos + group.node.nodeSize);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, group.pos))));
  dispatch?.(tr.scrollIntoView());
  return true;
};

/**
 * Cmd/Ctrl-Enter: a paragraph *after* this block, so the last block in a document is never a
 * dead end.
 *
 * A trailing paragraph could have been kept in the document instead, and was rejected: an empty
 * paragraph serializes to blank lines the parser does not read back, so every page would come
 * back dirty the moment it was opened. An explicit keystroke costs one shortcut and keeps the
 * file honest.
 */
export const paragraphAfterBlock: Command = (state, dispatch) => {
  const target = enclosingBlock(state);
  if (target === null) return false;
  const type = state.schema.nodes["paragraph"];
  if (type === undefined) return false;
  const at = target.pos + target.node.nodeSize;
  const tr = state.tr.insert(at, type.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  dispatch?.(tr.scrollIntoView());
  return true;
};

/**
 * True when the selection sits *inside* an `admonition` — the one nesting the dialect renders badly.
 *
 * "Inside" and not "on": a `NodeSelection` on an admonition resolves to the position *before* it,
 * so the loop below correctly says no. That is the right answer — an insert there replaces the
 * block rather than nesting inside it, and refusing would be a refusal the author cannot act on.
 */
export function insideAdmonition(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "admonition") return true;
  }
  return false;
}

/**
 * The keymap. Registered in `editorExtensions()` so the schema tests, the round-trip tests and the
 * mounted editor all see the same document model — the extension adds no node and no attribute, so
 * `getSchema()` is unchanged by it.
 */
export const BlockControls = Extension.create({
  name: "paginaBlockControls",
  // Ahead of the core keymap: Backspace at the start of an admonition would otherwise be answered
  // by `clearNodes`, which strips the *paragraph's* formatting and leaves the box exactly where it
  // was — the shape of the original defect.
  priority: 1000,
  addKeyboardShortcuts() {
    const run = (command: Command) => (): boolean => command(this.editor.state, this.editor.view.dispatch, this.editor.view);
    return {
      Backspace: (): boolean =>
        run(deleteSelectedBlock)() || run(escapeBlockStart)(),
      Delete: run(deleteSelectedBlock),
      "Mod-Enter": run(paragraphAfterBlock),
    };
  },
});
