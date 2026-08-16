/**
 * @vitest-environment jsdom
 *
 * The editor as a host page sees it: `mountEditor` over a `MemoryBackend`, then the loop that
 * matters — markdown in, document, edit, markdown out — plus the two states an author must never
 * be lied to about: what the file on the backend now says, and that someone else moved first.
 *
 * Timers are faked because everything here is debounced (400 ms serialize, 500 ms write, 300 ms
 * preview); the alternative is a suite that passes on a fast machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { mountEditor } from "../src/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { parseMarkdown } from "../src/model/parser.js";
import type { Editor } from "@tiptap/core";

// The preview hydrates Kineglyph figures through the host page's runtime, which a jsdom test has
// no import map for — and mounting real figures is not what any of this is testing.
vi.mock("kineglyph", () => ({ mountAll: async () => [], defaultTheme: {} }));

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published
nav:
  - { title: Home, page: index.md }
  - section: Guide
    children:
      - { title: Tabs, page: guide/tabs.md }
`;

const INDEX = `# Home

Welcome to the fixture.
`;

const TABS = `# Tabs and snippets

=== "Python"

    Some python.

=== "Rust"

    Some rust.
`;

const files = (): Record<string, string> => ({
  "article.yaml": ARTICLE,
  "index.md": INDEX,
  "guide/tabs.md": TABS,
});

let host: HTMLElement;
let backend: MemoryBackend;
let handle: ReturnType<typeof mountEditor>;

// React only enters `act`'s deterministic mode when a host declares itself a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no layout, and neither `Text` nor `Range` has any geometry method at all.
// ProseMirror measures a range around the caret whenever a command scrolls the selection into view
// (every `chain().focus()` does), so without these stubs any toolbar insertion throws here and only
// here. Zero-sized rects are the honest answer for a document that was never laid out.
const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
const GEOMETRY = {
  getClientRects: { value: () => [], configurable: true },
  getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
};
Object.defineProperties(Text.prototype, GEOMETRY);
Object.defineProperties(Range.prototype, GEOMETRY);

/**
 * Advances past every debounce in the app and lets the promise chains behind them settle.
 * Bounded rather than `runAllTimers` because the status bar keeps a `setInterval` running.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
}

/** The TipTap instance the pane built, reached the way a host page would: through the DOM. */
function editorOf(): Editor {
  const element = host.querySelector<HTMLElement & { editor?: Editor }>(".ProseMirror");
  if (element?.editor === undefined) throw new Error("editor view not mounted");
  return element.editor;
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  backend = new MemoryBackend(files());
});

afterEach(async () => {
  handle.destroy();
  await act(async () => {});
  host.remove();
  vi.useRealTimers();
});

async function mount(page = "index.md"): Promise<void> {
  await act(async () => {
    handle = mountEditor(host, { backend, page });
  });
  await settle();
}

describe("mountEditor", () => {
  it("opens the requested page as the document the model would parse", async () => {
    await mount();
    expect(editorOf().getJSON()).toEqual(parseMarkdown(INDEX).doc.toJSON());
  });

  it("writes an edit back to the store as markdown that still round-trips", async () => {
    await mount();
    await act(async () => {
      editorOf().commands.insertContentAt(editorOf().state.doc.content.size, "<p>Hello</p>");
    });
    await settle();

    const text = handle.store.files.get("index.md")?.text ?? "";
    expect(text).toContain("Hello");
    // Round-tripping the saved text has to reproduce the document, or the next open would differ.
    expect(parseMarkdown(text).doc.toJSON()).toEqual(editorOf().getJSON());
    // And it reached the backend, not just the mirror.
    expect((await backend.read("index.md")).text).toContain("Hello");
  });

  it("renders a tabs group through its node view, showing one panel at a time", async () => {
    await mount("guide/tabs.md");
    const tabs = host.querySelector(".pge-tabs");
    expect(tabs).not.toBeNull();

    const strip = [...(tabs?.querySelectorAll(".pge-tabs__tab") ?? [])];
    expect(strip.map((t) => t.textContent)).toEqual(["Python", "Rust"]);
    expect(strip.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);

    // The panels are ProseMirror's DOM, two levels below `NodeViewContent`; the view hides the
    // inactive ones by attribute. Getting that nesting wrong shows every tab at once.
    const panels = [...(tabs?.querySelectorAll(".pge-tab") ?? [])] as HTMLElement[];
    expect(panels).toHaveLength(2);
    expect(panels.map((p) => p.hidden)).toEqual([false, true]);

    await act(async () => {
      strip[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(panels.map((p) => p.hidden)).toEqual([true, false]);
  });

  it("inserts an admonition from the toolbar, and it serializes as one", async () => {
    await mount();
    const select = [...host.querySelectorAll("select")].find(
      (s) => s.getAttribute("aria-label") === "Insert admonition",
    );
    expect(select).toBeDefined();
    await act(async () => {
      select!.value = "note";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(handle.store.files.get("index.md")?.text ?? "").toContain("!!! note");
  });

  it("surfaces a conflict banner when the file moves underneath an unsaved edit", async () => {
    await mount();
    await act(async () => {
      editorOf().commands.insertContentAt(editorOf().state.doc.content.size, "<p>Mine</p>");
      await vi.advanceTimersByTimeAsync(450); // serialized into the store, not yet written
    });
    await act(async () => {
      await backend.emit({ type: "changed", path: "index.md", text: "# Theirs\n" });
    });
    await settle();

    expect(host.querySelector(".pge-conflict")?.textContent).toContain("index.md");
    expect(handle.store.files.get("index.md")?.status).toBe("conflict");

    // Taking theirs replaces the document — the pane must adopt text it did not write.
    await act(async () => {
      await handle.store.resolveConflict("index.md", "theirs");
    });
    await settle();
    expect(host.querySelector(".pge-conflict")).toBeNull();
    expect(editorOf().getText()).toContain("Theirs");
  });
});
