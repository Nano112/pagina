/**
 * @vitest-environment jsdom
 *
 * Publish, and then *read what you published*.
 *
 * The complaint this answers was that Publish "does real work with no destination" — it rendered
 * every page and every figure in the browser, handed the result to a backend, and left the author
 * looking at the same editor, with nothing to tell them apart from a button that did nothing. So
 * the payload is now shown: the editor is replaced by the reading view of the article it just
 * rendered, with a way back.
 *
 * `kineglyph` is stubbed because none of this is about drawing a diagram; the fixture has no
 * figures, and the stub exists only so `publish.ts`'s static imports resolve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { mountEditor } from "../src/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { settle } from "./settle.js";

vi.mock("kineglyph", () => ({
  defaultTheme: { name: "default" },
  documentFontFamily: () => undefined,
  withFontFamily: (theme: unknown) => theme,
  resolveFigure: () => ({ diagnostics: [], timeline: { duration: 0 } }),
  seekTimeline: (scene: unknown) => scene,
  sceneNeedsRuntime: () => false,
  renderSvg: () => "<svg></svg>",
  mountAll: async () => [],
  mountAllKineglyphLabs: async () => [],
  mountKineglyph: () => ({ destroy() {}, setTheme() {}, setScene() {} }),
}));

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published
nav:
  - { title: Home, page: index.md }
  - { title: Tabs, page: guide/tabs.md }
`;

const files = (): Record<string, string> => ({
  "article.yaml": ARTICLE,
  "index.md": "# Home\n\nWelcome.\n",
  "guide/tabs.md": '# Tabs\n\n=== "Python"\n\n    Some python.\n\n=== "Rust"\n\n    Some rust.\n',
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
const GEOMETRY = {
  getClientRects: { value: () => [], configurable: true },
  getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
};
Object.defineProperties(Text.prototype, GEOMETRY);
Object.defineProperties(Range.prototype, GEOMETRY);

let host: HTMLElement;
let backend: MemoryBackend;
let handle: ReturnType<typeof mountEditor>;

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

const publish = async (): Promise<void> => {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(".pge-bar__publish")!.click();
  });
  // Wait for the view, rather than for a number of scheduler turns. Publishing renders every page
  // and every figure before the reading view exists, so the three rounds a bare `settle()` gives
  // are a guess — and CI is the machine that gets the guess wrong: this failed there on a null
  // click while passing every local run.
  await settle(2_000, () => host.querySelector(".pge-published") !== null);
};

describe("Publish", () => {
  it("takes the author out of the editor and into the article they just wrote", async () => {
    await mount("guide/tabs.md");
    await publish();

    expect(host.querySelector(".pge-panes")).toBeNull();
    const published = host.querySelector<HTMLElement>(".pge-published")!;
    expect(published).not.toBeNull();
    // The page that was open is the page they land on.
    expect(published.querySelector("h1")?.textContent).toBe("Tabs");
    expect(published.querySelector(".pge-published__note")?.textContent).toContain("rendered in this browser");
  });

  it("really published: the backend has the rendered pages", async () => {
    await mount();
    await publish();
    expect(backend.published?.pages["/"]).toContain("Welcome.");
    expect(Object.keys(backend.published?.pages ?? {})).toContain("/guide/tabs/");
  });

  it("saves before it renders, so what is published is what is on screen", async () => {
    await mount();
    await act(async () => {
      const view = host.querySelector<HTMLElement & { editor?: { commands: { insertContentAt: (at: number, content: string) => void } } }>(".ProseMirror");
      view?.editor?.commands.insertContentAt(1, "Fresh words. ");
    });
    // Deliberately no `settle()` here: the serialize debounce is still pending, which is the state
    // an author is in when they reach for Publish straight after typing.
    await publish();
    expect(backend.published?.pages["/"]).toContain("Fresh words.");
  });

  it("carries the article's nav, and its tabs work", async () => {
    await mount();
    await publish();
    const nav = [...host.querySelectorAll<HTMLButtonElement>(".pge-published__nav button")];
    expect(nav.map((b) => b.textContent)).toEqual(["Home", "Tabs"]);

    await act(async () => {
      nav[1]!.click();
    });
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('.pge-published__page [role="tab"]')];
    const panels = [...host.querySelectorAll<HTMLElement>('.pge-published__page [role="tabpanel"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Python", "Rust"]);
    expect(panels.map((p) => p.hidden)).toEqual([false, true]);
    await act(async () => {
      tabs[1]!.click();
    });
    expect(panels.map((p) => p.hidden)).toEqual([true, false]);
  });

  it("comes back to the editor, on the page it left", async () => {
    await mount("guide/tabs.md");
    await publish();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".pge-published__bar .pge-btn--primary")!.click();
    });
    await settle();
    expect(host.querySelector(".pge-published")).toBeNull();
    expect(host.querySelector(".pge-status__path")?.textContent).toBe("guide/tabs.md");
  });

  it("hands the rendered article back to the caller, not just a timestamp", async () => {
    await mount();
    const result = await handle.publish();
    expect(result.publishedAt).toMatch(/^\d{4}-/);
    expect(result.article.pages["/"]?.html).toContain("Welcome.");
  });
});
