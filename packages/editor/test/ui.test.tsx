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
import { settle } from "./settle.js";
import type { Editor } from "@tiptap/core";

// The preview hydrates Kineglyph figures through the host page's runtime, which a jsdom test has
// no import map for — and mounting real figures is not what any of this is testing.
vi.mock("kineglyph", () => ({
  mountAll: async () => [],
  mountAllKineglyphLabs: async () => [],
  mountKineglyph: () => ({ destroy() {}, setTheme() {}, setScene() {} }),
  defaultTheme: {},
}));

/**
 * A switch the serializer test flips.
 *
 * A throwing serializer cannot be arranged from the document side — every document the parser
 * produces serialises — so the failure is injected instead. `vi.hoisted` is required: the factory
 * below is lifted above the imports, and a plain `const` would not exist yet when it runs.
 */
const serializer = vi.hoisted(() => ({ fail: false }));

vi.mock("../src/model/serializer.js", async () => {
  const actual = await vi.importActual<typeof import("../src/model/serializer.js")>("../src/model/serializer.js");
  return {
    ...actual,
    serializeMarkdown: (...args: Parameters<typeof actual.serializeMarkdown>): string => {
      if (serializer.fail) throw new Error("a node has no serializer");
      return actual.serializeMarkdown(...args);
    },
  };
});

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
  serializer.fail = false;
  handle.destroy();
  await act(async () => {});
  host.remove();
  vi.useRealTimers();
});

/**
 * A backend that tracks nobody: every method delegated, but change events carrying no author and
 * no `history` method at all.
 *
 * Delegated explicitly rather than through `Object.create`, because `MemoryBackend`'s state lives
 * in `#private` fields and a prototype-linked object is not an instance as far as those are
 * concerned — the methods throw on the first call rather than working through.
 */
function anonymousBackend(
  inner: MemoryBackend,
  listeners: Set<(ev: { type: "changed" | "deleted"; path: string; version?: string }) => void>,
): MemoryBackend {
  return {
    list: () => inner.list(),
    read: (p: string) => inner.read(p),
    readBinary: (p: string) => inner.readBinary(p),
    write: (p: string, t: string, o?: unknown) => inner.write(p, t, o as never),
    upload: (f: Blob | File, p?: string) => (p === undefined ? inner.upload(f) : inner.upload(f, p)),
    delete: (p: string) => inner.delete(p),
    rename: (a: string, b: string) => inner.rename(a, b),
    stat: (p: string) => inner.stat(p),
    publish: (payload: unknown) => inner.publish(payload as never),
    subscribe(cb: (ev: { type: "changed" | "deleted"; path: string; version?: string }) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  } as unknown as MemoryBackend;
}

async function mount(page = "index.md", over: MemoryBackend = backend): Promise<void> {
  await act(async () => {
    handle = mountEditor(host, { backend: over, page });
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

  it("gives the tab strip the keyboard behaviour its roles promise", async () => {
    await mount("guide/tabs.md");
    const tabs = host.querySelector(".pge-tabs");
    const strip = [...(tabs?.querySelectorAll<HTMLElement>(".pge-tabs__tab") ?? [])];
    const panels = [...(tabs?.querySelectorAll(".pge-tab") ?? [])] as HTMLElement[];

    // Each tab names the panel it controls, and each panel names the tab that labels it.
    expect(strip.map((t) => t.getAttribute("aria-controls"))).toEqual(panels.map((p) => p.id));
    expect(panels.map((p) => p.getAttribute("role"))).toEqual(["tabpanel", "tabpanel"]);
    expect(panels.map((p) => p.getAttribute("aria-labelledby"))).toEqual(strip.map((t) => t.id));

    // Roving tabindex: the strip is one tab stop, not one per tab.
    expect(strip.map((t) => t.tabIndex)).toEqual([0, -1]);

    const press = async (key: string): Promise<void> => {
      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    };

    strip[0]?.focus();
    await press("ArrowRight");
    expect(strip.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(panels.map((p) => p.hidden)).toEqual([true, false]);
    expect(document.activeElement).toBe(strip[1]);
    expect(strip.map((t) => t.tabIndex)).toEqual([-1, 0]);

    // …and it wraps, which is what makes it a strip rather than a list.
    await press("ArrowRight");
    expect(strip.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);

    await press("End");
    expect(strip.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    await press("Home");
    expect(strip.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("inserts an admonition from the toolbar, and it serializes as one", async () => {
    await mount();
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Insert admonition"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    const item = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (b) => b.textContent === "Note",
    );
    expect(item, "the admonition menu has no Note").toBeDefined();
    await act(async () => item!.click());
    await settle();

    expect(handle.store.files.get("index.md")?.text ?? "").toContain("!!! note");
  });

  it("says so when it cannot serialize the page, and keeps the edit", async () => {
    await mount();
    serializer.fail = true;
    await act(async () => {
      editorOf().commands.insertContentAt(editorOf().state.doc.content.size, "<p>First</p>");
    });
    await settle();

    // The store never heard about the edit, so it still reads "Saved" — which is exactly why the
    // failure has to be said out loud somewhere the author is looking.
    expect(host.querySelector(".pge-status")?.textContent).toContain("Couldn't serialize this page");
    expect(host.querySelector(".pge-status")?.textContent).toContain("a node has no serializer");
    expect(handle.store.files.get("index.md")?.text ?? "").not.toContain("First");

    // Typing still works, and the moment the serializer recovers the pending edit lands — including
    // the text typed while it was broken.
    serializer.fail = false;
    await act(async () => {
      editorOf().commands.insertContentAt(editorOf().state.doc.content.size, "<p>Second</p>");
    });
    await settle();

    const text = handle.store.files.get("index.md")?.text ?? "";
    expect(text).toContain("First");
    expect(text).toContain("Second");
    expect(host.querySelector(".pge-status")?.textContent).not.toContain("Couldn't serialize");
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

  /**
   * The reason the whole feature exists, on screen.
   *
   * "index.md changed on the server" tells an author they have a decision. "Alice changed index.md"
   * tells them enough to make it. Both sentences are asserted, because the fallback is not a
   * degraded path to be tolerated — it is the correct thing to say when nobody knows who wrote.
   */
  it("names the person in the conflict banner", async () => {
    await mount();
    await act(async () => {
      editorOf().commands.insertContentAt(editorOf().state.doc.content.size, "<p>Mine</p>");
      await vi.advanceTimersByTimeAsync(450);
    });
    await act(async () => {
      await backend.emit({
        type: "changed", path: "index.md", text: "# Theirs\n",
        by: { id: "u-alice", name: "Alice" },
      });
    });
    await settle();

    const named = host.querySelector(".pge-conflict")?.textContent ?? "";
    expect(named).toContain("Alice");
    expect(named).toContain("index.md");
    expect(named).toContain("while you were editing it");
    // The old wording is gone when there is a better one: two sentences saying the same thing in
    // one banner is worse than either.
    expect(named).not.toContain("changed on the server");
  });

  it("falls back to today's wording when the backend reports nobody", async () => {
    // A backend that tracks no identity is not a broken one — a plain file server is exactly this
    // — so the sentence it produces has to stay good. This is the path that must not rot.
    const anonymous = new MemoryBackend(files());
    const listeners = new Set<(ev: { type: "changed" | "deleted"; path: string; version?: string }) => void>();
    await mount("index.md", anonymousBackend(anonymous, listeners));
    await act(async () => {
      editorOf().commands.insertContentAt(editorOf().state.doc.content.size, "<p>Mine</p>");
      await vi.advanceTimersByTimeAsync(450);
    });
    await act(async () => {
      for (const cb of listeners) cb({ type: "changed", path: "index.md", version: "later" });
    });
    await settle();

    const text = host.querySelector(".pge-conflict")?.textContent ?? "";
    expect(text).toContain("index.md");
    expect(text).toContain("changed on the server while you were editing it");
  });
});

describe("the history panel", () => {
  it("is absent when the backend keeps no history, and lists edits when it does", async () => {
    const { MemoryBackend: Memory } = await import("../src/store/memory-backend.js");
    const { ArticleStore } = await import("../src/store/article-store.js");

    const keeping = new Memory(files(), { author: { id: "u1", name: "Ada" } });
    const store = new ArticleStore(keeping);
    expect(store.hasHistory).toBe(true);
    await store.load();
    await store.createFile("new.md", "# New\n");
    const edits = await store.history();
    expect(edits[0]).toMatchObject({ path: "new.md", action: "write", by: { name: "Ada" } });
    store.destroy();

    // A backend with no `history` method: the store says so, and `Sidebar` renders nothing at all
    // rather than an empty list, which would read as "nobody has edited this".
    const other = new ArticleStore(anonymousBackend(new Memory(files()), new Set()));
    expect(other.hasHistory).toBe(false);
    await expect(other.history()).rejects.toThrow(/keeps no history/);
    other.destroy();
  });
});
