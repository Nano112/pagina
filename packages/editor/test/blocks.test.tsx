/**
 * @vitest-environment jsdom
 *
 * A block node must be possible to *leave* and possible to *remove*, and until now none of them
 * were reliably either.
 *
 * The reported symptom: select an admonition's whole body, press Backspace eight times, and the
 * node is still there with its text unchanged. The cause is two missing halves of one contract —
 * no node view offered a remove control (two of seven did), and no keystroke could reach the node
 * because ProseMirror's own Backspace bindings answer with `clearNodes`, which reformats the
 * paragraph *inside* the box and leaves the box.
 *
 * So this suite asserts the contract rather than the symptom, and asserts it for every block type
 * at once — the defect was that the types disagreed, and a test that checks admonitions only would
 * let them disagree again:
 *
 *  1. every block has a labelled remove control, and clicking it removes the node;
 *  2. every block is deletable from the keyboard once selected;
 *  3. an admonition's start is an exit, not a trap;
 *  4. a block at the end of the document is not a dead end;
 *  5. an admonition refuses to go inside an admonition, out loud.
 *
 * Everything runs through `mountEditor` over a `MemoryBackend`, i.e. the editor a host page gets,
 * because the remove control is React and the keystrokes are ProseMirror and only the mounted
 * editor has both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { mountEditor } from "../src/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { REMOVABLE_BLOCKS } from "../src/model/block-controls.js";
import { serializeMarkdown } from "../src/model/serializer.js";
import { NESTED_ADMONITION_MESSAGE } from "../src/ui/inserts.js";
import { settle } from "./settle.js";

vi.mock("kineglyph", () => ({
  mountAll: async () => [],
  mountKineglyph: () => ({ destroy() {}, setTheme() {}, setScene() {} }),
  defaultTheme: {},
}));

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published
nav:
  - { title: Blocks, page: blocks.md }
`;

/**
 * One page carrying every block the dialect has.
 *
 * Written as markdown rather than assembled as a document on purpose: the parser is what a real
 * page goes through, and a node built by hand can carry attribute shapes the parser never
 * produces.
 */
const BLOCKS = `# Blocks

!!! note "Heads up"
    Inside the admonition.

=== "One"

    First tab.

=== "Two"

    Second tab.

--8<-- "snippets/hello.py:main"

<figure class="kg" data-static="media/static.svg"><img src="media/static.svg" alt="static"></figure>

<figure markdown="span">
  ![A](media/static.svg)
  <figcaption>Cap.</figcaption>
</figure>

<model-viewer src="media/model.glb" alt="A model"></model-viewer>

<div class="callout">
  <p>Raw HTML no node models.</p>
</div>
`;

/** The node type each remove control belongs to, and the accessible name it must carry. */
const BLOCK_TYPES = [
  { type: "admonition", label: "Remove admonition" },
  { type: "tabs", label: "Remove tab group" },
  { type: "snippet", label: "Remove snippet" },
  { type: "figureKg", label: "Remove figure" },
  { type: "figureImage", label: "Remove image figure" },
  { type: "modelViewer", label: "Remove model" },
  { type: "htmlBlock", label: "Remove HTML block" },
] as const;

let host: HTMLElement;
let backend: MemoryBackend;
let handle: ReturnType<typeof mountEditor> | undefined;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, and ProseMirror measures a range whenever a command scrolls the selection
// into view — which every command here does.
const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
const GEOMETRY = {
  getClientRects: { value: () => [], configurable: true },
  getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
};
Object.defineProperties(Text.prototype, GEOMETRY);
Object.defineProperties(Range.prototype, GEOMETRY);
Object.defineProperties(Element.prototype, GEOMETRY);

function editorOf(): Editor {
  const element = host.querySelector<HTMLElement & { editor?: Editor }>(".ProseMirror");
  if (element?.editor === undefined) throw new Error("editor view not mounted");
  return element.editor;
}

/** Every position at which a node of `type` starts, outermost first. */
function positionsOf(doc: ProseMirrorNode, type: string): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === type) found.push(pos);
    return true;
  });
  return found;
}

const countOf = (type: string): number => positionsOf(editorOf().state.doc, type).length;

/** The document as the file would be written — the only view of it the site ever sees. */
const markdown = (): string => serializeMarkdown(editorOf().state.doc);

/**
 * A keystroke, the way the browser delivers one.
 *
 * Dispatched on ProseMirror's own DOM rather than calling the command directly: the thing under
 * test is that the *keymap* reaches these commands ahead of the base bindings, and calling the
 * command would pass even with the keymap unregistered.
 */
async function press(key: string, modifiers: { mod?: boolean } = {}): Promise<void> {
  const dom = editorOf().view.dom;
  await act(async () => {
    dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        // `Mod` is Cmd on a Mac and Ctrl everywhere else, and prosemirror-keymap decides which
        // from the platform it is *running* on — which under jsdom is not a Mac, whatever the
        // machine running the suite is. Sending `metaKey` here would produce a binding named
        // `Meta-Enter`, which nothing is bound to, and the test would pass or fail by laptop.
        ctrlKey: modifiers.mod ?? false,
      }),
    );
  });
}

/** Puts a `NodeSelection` on the first node of `type` — what clicking a block's chrome does. */
async function selectNode(type: string): Promise<void> {
  await act(async () => {
    const editor = editorOf();
    const pos = positionsOf(editor.state.doc, type)[0];
    if (pos === undefined) throw new Error(`no ${type} in the document`);
    const { state, dispatch } = editor.view;
    dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  });
}

const controlFor = (label: string): HTMLButtonElement => {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`no control labelled "${label}"`);
  return button;
};

beforeEach(() => {
  vi.useFakeTimers();
  // Cleared, not merely reassigned on mount: `afterEach` would otherwise destroy the *previous*
  // test's editor on behalf of a test that never made one.
  handle = undefined;
  host = document.createElement("div");
  document.body.append(host);
  backend = new MemoryBackend({ "article.yaml": ARTICLE, "blocks.md": BLOCKS });
});

afterEach(async () => {
  // Not every test mounts — the two that compare lists never touch the DOM.
  handle?.destroy();
  await act(async () => {});
  host.remove();
  vi.useRealTimers();
});

async function mount(page = "blocks.md"): Promise<void> {
  await act(async () => {
    handle = mountEditor(host, { backend, page });
  });
  await settle();
}

describe("the block chrome", () => {
  it("covers every block the model says is removable", () => {
    // The list above is the *test's*; `REMOVABLE_BLOCKS` is the model's. Binding them means a
    // block added to the dialect cannot quietly arrive without a remove control and a keystroke —
    // which is exactly how five of the seven ended up without one.
    expect([...BLOCK_TYPES].map((b) => b.type).sort()).toEqual([...REMOVABLE_BLOCKS].sort());
  });

  it("parses the page into one of every block the dialect has", async () => {
    // The guard on every assertion below: a suite that silently found no figures would pass.
    await mount();
    for (const { type } of BLOCK_TYPES) expect(countOf(type), type).toBe(1);
  });

  it("gives every block a remove control with a name that says what it removes", async () => {
    await mount();
    for (const { label } of BLOCK_TYPES) {
      const button = controlFor(label);
      // Reachable by keyboard, not only by hover: the control is *quiet* until hover, which is a
      // stylesheet's business, but it must never leave the tab order.
      expect(button.tabIndex, label).toBeGreaterThanOrEqual(0);
      expect(button.disabled, label).toBe(false);
    }
  });

  it.each(BLOCK_TYPES)("removes a $type through its control", async ({ type, label }) => {
    await mount();
    expect(countOf(type)).toBe(1);
    await act(async () => {
      controlFor(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(countOf(type), `${type} survived its remove control`).toBe(0);
  });

  it.each(BLOCK_TYPES)("deletes a selected $type with Backspace", async ({ type }) => {
    await mount();
    await selectNode(type);
    await press("Backspace");
    expect(countOf(type), `${type} survived Backspace`).toBe(0);
  });

  it.each(BLOCK_TYPES)("deletes a selected $type with Delete", async ({ type }) => {
    await mount();
    await selectNode(type);
    await press("Delete");
    expect(countOf(type), `${type} survived Delete`).toBe(0);
  });

  it("writes the removal to the file, not only to the document", async () => {
    await mount();
    await act(async () => {
      controlFor("Remove admonition").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    const text = handle!.store.files.get("blocks.md")?.text ?? "";
    expect(text).not.toContain("!!! note");
    expect(text).toContain('=== "One"');
    expect((await backend.read("blocks.md")).text).not.toContain("!!! note");
  });
});

describe("the start of an admonition", () => {
  /** Puts the caret at offset 0 of the admonition's first paragraph. */
  async function caretAtBodyStart(): Promise<void> {
    await act(async () => {
      const editor = editorOf();
      const pos = positionsOf(editor.state.doc, "admonition")[0]!;
      editor.commands.setTextSelection(pos + 2);
    });
  }

  it("lifts the body out rather than trapping the caret", async () => {
    await mount();
    await caretAtBodyStart();
    await press("Backspace");

    // The block is gone and the words are not: the non-destructive half of the rule.
    expect(countOf("admonition")).toBe(0);
    expect(editorOf().state.doc.textContent).toContain("Inside the admonition.");
    expect(markdown()).not.toContain("!!! note");
    expect(markdown()).toContain("Inside the admonition.");
  });

  it("removes an emptied admonition entirely on the next Backspace", async () => {
    // The author's actual keystrokes: select the body, delete it, then keep pressing Backspace.
    await mount();
    await act(async () => {
      const editor = editorOf();
      const pos = positionsOf(editor.state.doc, "admonition")[0]!;
      const node = editor.state.doc.nodeAt(pos)!;
      editor.commands.setTextSelection({ from: pos + 2, to: pos + node.nodeSize - 2 });
      editor.commands.deleteSelection();
    });
    expect(countOf("admonition")).toBe(1);

    await press("Backspace");
    expect(countOf("admonition"), "an emptied admonition survived Backspace").toBe(0);
  });

  it("leaves Backspace alone in the middle of a body", async () => {
    await mount();
    await act(async () => {
      const editor = editorOf();
      const pos = positionsOf(editor.state.doc, "admonition")[0]!;
      editor.commands.setTextSelection(pos + 6);
    });
    await press("Backspace");
    // A keystroke that dissolves the block from the middle of a sentence would be far worse than
    // the trap it replaced.
    expect(countOf("admonition")).toBe(1);
  });
});

/**
 * "Never a dead end" has two halves, and only one of them is new.
 *
 * The *end of the document* is already covered: StarterKit's trailing-node rule keeps an empty
 * paragraph after a final block node, so the caret always has somewhere to land. That is only the
 * end, though — a block in the middle of a page, or the last thing inside a tab, has no such
 * paragraph and no way to grow one — so `Cmd/Ctrl-Enter` puts one directly after whatever block
 * the selection is in, wherever that is.
 *
 * Both halves have to be *asserted*, not assumed: the trailing rule is a dependency's behaviour,
 * and the day StarterKit drops it the escape hatch silently becomes half a hatch.
 */
describe("a block at the end of the document", () => {
  const ENDS_WITH_BLOCK = `# Trapped\n\n!!! danger "The last thing on the page"\n    Nothing follows this.\n`;

  beforeEach(() => {
    backend = new MemoryBackend({ "article.yaml": ARTICLE, "blocks.md": ENDS_WITH_BLOCK });
  });

  it("always has an empty paragraph after it for the caret to land in", async () => {
    await mount();
    const doc = editorOf().state.doc;
    expect(doc.lastChild?.type.name).toBe("paragraph");
    expect(doc.lastChild?.content.size).toBe(0);
    expect(doc.child(doc.childCount - 2).type.name).toBe("admonition");
  });

  it("does not let that paragraph reach the file", async () => {
    // The escape hatch must cost the author nothing: a trailing empty paragraph that serialized
    // to blank lines would make every page report itself dirty the instant it was opened, and
    // then grow on every save.
    await mount();
    await settle();
    expect(markdown()).toBe(ENDS_WITH_BLOCK);
    expect(handle!.store.files.get("blocks.md")?.text ?? ENDS_WITH_BLOCK).toBe(ENDS_WITH_BLOCK);
  });

  it("escapes with Cmd/Ctrl-Enter without disturbing the block", async () => {
    await mount();
    const before = editorOf().state.doc.childCount;
    await act(async () => {
      const editor = editorOf();
      editor.commands.setTextSelection(positionsOf(editor.state.doc, "admonition")[0]! + 2);
    });
    await press("Enter", { mod: true });

    const doc = editorOf().state.doc;
    expect(doc.childCount).toBe(before + 1);
    expect(countOf("admonition")).toBe(1);
    expect(doc.textContent).toContain("Nothing follows this.");
    // The caret is in the new paragraph, or the hatch only moved the wall.
    const { $from } = editorOf().state.selection;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.parent.content.size).toBe(0);
    expect($from.pos).toBeGreaterThan(positionsOf(doc, "admonition")[0]!);
  });
});

describe("a block in the middle of the document", () => {
  it("grows a paragraph immediately after itself on Cmd/Ctrl-Enter", async () => {
    // The half StarterKit's trailing node cannot reach: a block with something already after it.
    await mount();
    await act(async () => {
      const editor = editorOf();
      editor.commands.setTextSelection(positionsOf(editor.state.doc, "admonition")[0]! + 2);
    });
    await press("Enter", { mod: true });

    const doc = editorOf().state.doc;
    const admonition = positionsOf(doc, "admonition")[0]!;
    const after = doc.resolve(admonition).index() + 1;
    expect(doc.child(after).type.name).toBe("paragraph");
    expect(doc.child(after).content.size).toBe(0);
    expect(editorOf().state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("escapes an atom the same way", async () => {
    await mount();
    await selectNode("figureKg");
    await press("Enter", { mod: true });
    const doc = editorOf().state.doc;
    const figure = positionsOf(doc, "figureKg")[0]!;
    expect(doc.child(doc.resolve(figure).index() + 1).type.name).toBe("paragraph");
    expect(countOf("figureKg")).toBe(1);
  });

  it("escapes a block nested inside a tab, into that tab", async () => {
    backend = new MemoryBackend({
      "article.yaml": ARTICLE,
      "blocks.md": `=== "One"\n\n    !!! note "Inside"\n\n        Body.\n`,
    });
    await mount();
    await act(async () => {
      const editor = editorOf();
      editor.commands.setTextSelection(positionsOf(editor.state.doc, "admonition")[0]! + 2);
    });
    await press("Enter", { mod: true });

    // The paragraph lands in the tab beside the admonition, not outside the group.
    const { $from } = editorOf().state.selection;
    expect($from.parent.type.name).toBe("paragraph");
    expect($from.node($from.depth - 1).type.name).toBe("tab");
    expect(countOf("tabs")).toBe(1);
  });
});

describe("an admonition inside an admonition", () => {
  const insertAdmonition = async (): Promise<void> => {
    const select = [...host.querySelectorAll("select")].find(
      (s) => s.getAttribute("aria-label") === "Insert admonition",
    );
    if (select === undefined) throw new Error("no admonition insert control");
    await act(async () => {
      select.value = "tip";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("is refused, and the refusal is said out loud", async () => {
    await mount();
    await act(async () => {
      const editor = editorOf();
      editor.commands.setTextSelection(positionsOf(editor.state.doc, "admonition")[0]! + 3);
    });
    expect(countOf("admonition")).toBe(1);

    await insertAdmonition();

    expect(countOf("admonition"), "an admonition was nested").toBe(1);
    expect(host.textContent).toContain(NESTED_ADMONITION_MESSAGE);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(NESTED_ADMONITION_MESSAGE);
  });

  it("still inserts one anywhere else, including inside a tab", async () => {
    await mount();
    await act(async () => {
      const editor = editorOf();
      // Inside the first tab's paragraph: nesting the dialect's pages genuinely use.
      editor.commands.setTextSelection(positionsOf(editor.state.doc, "tab")[0]! + 3);
    });
    await insertAdmonition();
    expect(countOf("admonition")).toBe(2);
    await settle();
    expect(handle!.store.files.get("blocks.md")?.text ?? "").toContain("!!! tip");
  });
});
