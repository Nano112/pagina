/**
 * @vitest-environment jsdom
 *
 * The slash menu, and the shared insert list behind it.
 *
 * What matters is that `/` reaches the *document*: the menu is only a way of running one of the
 * commands the toolbar also runs, so the assertions end at the serialized markdown rather than at
 * the DOM the menu drew.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { mountEditor } from "../src/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { filterInserts, INSERTS } from "../src/ui/inserts.js";
import { settle } from "./settle.js";

vi.mock("kineglyph", () => ({ mountAll: async () => [], defaultTheme: {} }));

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published
nav:
  - { title: Home, page: index.md }
`;

let host: HTMLElement;
let backend: MemoryBackend;
let handle: ReturnType<typeof mountEditor>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout; ProseMirror measures the caret on every focused command, and the slash menu
// asks for the caret's coordinates on purpose. Zero rects are the honest answer here.
const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
const GEOMETRY = {
  getClientRects: { value: () => [], configurable: true },
  getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
};
Object.defineProperties(Text.prototype, GEOMETRY);
Object.defineProperties(Range.prototype, GEOMETRY);
Object.defineProperties(Element.prototype, { getBoundingClientRect: GEOMETRY.getBoundingClientRect });

function editorOf(): Editor {
  const element = host.querySelector<HTMLElement & { editor?: Editor }>(".ProseMirror");
  if (element?.editor === undefined) throw new Error("editor view not mounted");
  return element.editor;
}

/** Types `text` into a fresh empty paragraph at the end of the document. */
async function typeOnNewLine(text: string): Promise<void> {
  const editor = editorOf();
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
    editor.commands.focus("end");
    editor.commands.insertContent(text);
  });
}

const menu = (): HTMLElement | null => host.querySelector(".pge-slash");
const items = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".pge-slash__item")];

beforeEach(async () => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  backend = new MemoryBackend({ "article.yaml": ARTICLE, "index.md": "# Home\n\nWelcome.\n" });
  await act(async () => {
    handle = mountEditor(host, { backend, page: "index.md" });
  });
  await settle();
});

afterEach(async () => {
  handle.destroy();
  await act(async () => {});
  host.remove();
  vi.useRealTimers();
});

describe("insert list", () => {
  it("filters on labels and on keywords", () => {
    expect(filterInserts("")).toHaveLength(INSERTS.length);
    expect(filterInserts("warning").map((a) => a.id)).toEqual(["admonition-warning"]);
    // `glb` is a keyword, not a word in any label.
    expect(filterInserts("glb").map((a) => a.id)).toEqual(["model"]);
    expect(filterInserts("no such block")).toHaveLength(0);
  });

  it("has a unique id per action, since both surfaces address them by id", () => {
    expect(new Set(INSERTS.map((a) => a.id)).size).toBe(INSERTS.length);
  });
});

describe("slash menu", () => {
  it("opens on `/` at the start of a line and filters as the author types", async () => {
    await typeOnNewLine("/");
    expect(menu()).not.toBeNull();
    expect(items().length).toBe(INSERTS.length);

    await typeOnNewLine("");
    await act(async () => {
      editorOf().commands.insertContent("warn");
    });
    expect(items().map((i) => i.textContent)).toEqual(["Admonition: warning"]);
  });

  it("does not open in the middle of a line", async () => {
    await typeOnNewLine("text /");
    expect(menu()).toBeNull();
  });

  // Both forms of code, because `/` is a character there and not a command — and because a menu
  // that opens over code also *eats* what was typed when the author presses Enter.
  it("does not open inside a fenced code block", async () => {
    const editor = editorOf();
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
      editor.commands.focus("end");
      editor.commands.setCodeBlock();
      editor.commands.insertContent("/warning");
    });
    expect(editorOf().isActive("codeBlock")).toBe(true);
    expect(menu()).toBeNull();
  });

  it("does not open inside inline code", async () => {
    const editor = editorOf();
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
      editor.commands.focus("end");
      editor.commands.setMark("code");
      editor.commands.insertContent("/warning");
    });
    expect(editorOf().isActive("code")).toBe(true);
    expect(menu()).toBeNull();

    // …and still opens on the next plain line, so the guard is not a blanket "never again".
    await typeOnNewLine("/warning");
    expect(menu()).not.toBeNull();
  });

  it("inserts the chosen block on Enter and removes the `/` text", async () => {
    await typeOnNewLine("/warning");
    expect(items()).toHaveLength(1);

    await act(async () => {
      fireEvent.keyDown(editorOf().view.dom, { key: "Enter" });
    });
    await settle();

    const text = handle.store.files.get("index.md")?.text ?? "";
    expect(text).toContain("!!! warning");
    expect(text).not.toContain("/warning");
    expect(menu()).toBeNull();
  });

  it("moves the selection with the arrow keys", async () => {
    await typeOnNewLine("/list");
    const labels = items().map((i) => i.textContent);
    expect(labels.length).toBeGreaterThan(1);
    expect(items()[0]?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(editorOf().view.dom, { key: "ArrowDown" });
    });
    expect(items()[1]?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(editorOf().view.dom, { key: "ArrowUp" });
    });
    expect(items()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("closes on Escape and stays closed while the author keeps typing", async () => {
    await typeOnNewLine("/warn");
    expect(menu()).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(editorOf().view.dom, { key: "Escape" });
    });
    expect(menu()).toBeNull();

    await act(async () => {
      editorOf().commands.insertContent("ing");
    });
    expect(menu()).toBeNull();
  });
});
