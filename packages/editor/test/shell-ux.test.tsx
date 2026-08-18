/**
 * @vitest-environment jsdom
 *
 * The shell's own affordances, as an author reaches them: the preview's tabs, the delete control
 * on each tab, the resizable sidebar, and the pages dialog that stands in for the sidebar when the
 * editor is too narrow to show one.
 *
 * Every case here is a defect that shipped. The preview's tabs did not respond to a click (the
 * behaviour lived in the site's client bundle and nowhere else); deleting a tab was a single
 * control in the strip that acted on "whichever tab is selected", and refused outright on the last
 * one; the sidebar was a constant; and below the layout's breakpoint the pages list was hidden with
 * *nothing* in its place, so switching pages, creating one and uploading were unreachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { mountEditor } from "../src/index.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { ArticleStore } from "../src/store/article-store.js";
import { parseMarkdown } from "../src/model/parser.js";
import { Preview } from "../src/ui/Preview.js";
import { SIDEBAR_DEFAULT, loadSidebarWidth, saveSidebarWidth } from "../src/ui/layout.js";
import { settle } from "./settle.js";

vi.mock("kineglyph", () => ({
  mountAll: async () => [],
  mountAllKineglyphLabs: async () => [],
  mountKineglyph: () => ({ destroy() {}, setTheme() {}, setScene() {} }),
  defaultTheme: {},
}));

const ARTICLE = `slug: fixture
title: Fixture Docs
form: docs
status: published
nav:
  - { title: Home, page: index.md }
  - { title: Tabs, page: guide/tabs.md }
`;

const INDEX = "# Home\n\nWelcome.\n";

const TABS = `# Tabs

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, and ProseMirror measures a range whenever a command scrolls the selection
// into view. Zero rects are the honest answer for a document that was never laid out.
const ZERO_RECT = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
const GEOMETRY = {
  getClientRects: { value: () => [], configurable: true },
  getBoundingClientRect: { value: () => ZERO_RECT, configurable: true },
};
Object.defineProperties(Text.prototype, GEOMETRY);
Object.defineProperties(Range.prototype, GEOMETRY);

describe("the preview's tab groups", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /**
   * The preview renders `@pagina/core`'s HTML in the browser. On the published page the tabs are
   * made to work by the site's client bundle, which the preview does not load — so until the
   * behaviour moved into `@pagina/shell-static`, the second tab here could not be selected at all.
   */
  it("responds to a click, exactly as the published page does", async () => {
    const store = new ArticleStore(new MemoryBackend(files()));
    await store.load();
    const view = render(<Preview store={store} path="guide/tabs.md" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const tabs = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...view.container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Python", "Rust"]);
    expect(panels.map((p) => p.hidden)).toEqual([false, true]);

    await act(async () => {
      tabs[1]!.click();
    });
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(panels.map((p) => p.hidden)).toEqual([true, false]);
  });
});

describe("the editor shell", () => {
  let host: HTMLElement;
  let backend: MemoryBackend;
  let handle: ReturnType<typeof mountEditor>;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.localStorage.clear();
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

  const text = (): string => handle.store.files.get("guide/tabs.md")?.text ?? "";

  describe("a tab's delete control", () => {
    it("sits on the tab it deletes, and names it", async () => {
      await mount("guide/tabs.md");
      const closes = [...host.querySelectorAll<HTMLButtonElement>(".pge-tabs__close")];
      expect(closes).toHaveLength(2);
      expect(closes.map((c) => c.getAttribute("aria-label"))).toEqual([
        'Delete the tab "Python"',
        'Delete the tab "Rust"',
      ]);
      // Roving tabindex, shared with the tabs: the selected tab and its own delete are the strip's
      // only stops, so Tab leaves the strip rather than walking every control in it.
      expect(closes.map((c) => c.tabIndex)).toEqual([0, -1]);
    });

    it("removes that tab and nothing else, and the markdown still round-trips", async () => {
      await mount("guide/tabs.md");
      await act(async () => {
        host.querySelectorAll<HTMLButtonElement>(".pge-tabs__close")[1]!.click();
      });
      await settle();

      expect([...host.querySelectorAll(".pge-tabs__tab")].map((t) => t.textContent)).toEqual(["Python"]);
      expect(text()).toContain('=== "Python"');
      expect(text()).not.toContain('=== "Rust"');
      expect(text()).not.toContain("Some rust.");
      expect(parseMarkdown(text()).doc.toJSON()).toEqual(
        parseMarkdown('# Tabs\n\n=== "Python"\n\n    Some python.\n').doc.toJSON(),
      );
    });

    /**
     * The defined behaviour for the last tab.
     *
     * A tabs node with no children cannot exist — the schema needs one, and there is no `=== "…"`
     * syntax for an empty group — so "delete the only tab" has to mean something. It removes the
     * group. Refusing was the old answer and it made the control on a one-tab group inert; this is
     * the honest reading of the request, and one undo away.
     */
    it("removes the whole group when the tab is the last one, and says so first", async () => {
      await mount("guide/tabs.md");
      await act(async () => {
        host.querySelectorAll<HTMLButtonElement>(".pge-tabs__close")[1]!.click();
      });
      await settle();

      const last = host.querySelector<HTMLButtonElement>(".pge-tabs__close")!;
      expect(last.getAttribute("aria-label")).toBe(
        'Delete the tab "Python" — the last one, which removes the tab group',
      );

      await act(async () => {
        last.click();
      });
      await settle();

      expect(host.querySelector(".pge-tabs")).toBeNull();
      expect(text().trim()).toBe("# Tabs");
      expect(parseMarkdown(text()).doc.toJSON()).toEqual(parseMarkdown("# Tabs\n").doc.toJSON());
    });

    it("is reachable from the keyboard, without seeing it", async () => {
      await mount("guide/tabs.md");
      const strip = host.querySelector<HTMLElement>(".pge-tabs__strip")!;
      await act(async () => {
        strip.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      });
      await settle();
      expect([...host.querySelectorAll(".pge-tabs__tab")].map((t) => t.textContent)).toEqual(["Rust"]);
    });
  });

  describe("the sidebar splitter", () => {
    it("is a separator the keyboard can move, and reports where it is", async () => {
      await mount();
      const handleEl = host.querySelector<HTMLElement>(".pge-handle--sidebar")!;
      expect(handleEl.getAttribute("role")).toBe("separator");
      expect(handleEl.tabIndex).toBe(0);
      expect(handleEl.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_DEFAULT));

      await act(async () => {
        handleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });
      const widened = Number(handleEl.getAttribute("aria-valuenow"));
      expect(widened).toBeGreaterThan(SIDEBAR_DEFAULT);

      // Clamped at both ends, so neither pane can be dragged out of existence.
      await act(async () => {
        handleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      });
      expect(handleEl.getAttribute("aria-valuenow")).toBe(handleEl.getAttribute("aria-valuemax"));
      await act(async () => {
        handleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      });
      expect(handleEl.getAttribute("aria-valuenow")).toBe(handleEl.getAttribute("aria-valuemin"));
    });

    it("remembers the width across a mount", async () => {
      await mount();
      const handleEl = host.querySelector<HTMLElement>(".pge-handle--sidebar")!;
      await act(async () => {
        handleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      });
      const chosen = handleEl.getAttribute("aria-valuenow");
      expect(loadSidebarWidth()).toBe(Number(chosen));

      handle.destroy();
      await act(async () => {});
      host.replaceChildren();
      await mount();
      expect(host.querySelector(".pge-handle--sidebar")?.getAttribute("aria-valuenow")).toBe(chosen);
    });
  });

  /**
   * jsdom reports every element as zero-width, so the shell is always in its compact layout here —
   * which is exactly the state this needs.
   */
  describe("the pages dialog", () => {
    it("opens the same pages list the sidebar shows, and closes on a choice", async () => {
      await mount();
      const fab = host.querySelector<HTMLButtonElement>(".pge-pages-fab")!;
      expect(fab.getAttribute("aria-haspopup")).toBe("dialog");

      await act(async () => {
        fab.focus();
        fab.click();
      });
      const dialog = host.querySelector<HTMLElement>(".pge-modal--pages")!;
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      // Not a stub: the real `<Sidebar>`, so New page and Upload are reachable here too.
      expect([...dialog.querySelectorAll(".pge-tree__link")].map((b) => b.textContent)).toEqual(["Home", "Tabs"]);
      expect(dialog.textContent).toContain("New page");
      expect(dialog.textContent).toContain("Upload");
      // Focus moved into the dialog rather than being left behind it.
      expect(dialog.contains(document.activeElement)).toBe(true);

      await act(async () => {
        dialog.querySelectorAll<HTMLButtonElement>(".pge-tree__link")[1]!.click();
      });
      await settle();
      expect(host.querySelector(".pge-modal--pages")).toBeNull();
      expect(host.querySelector(".pge-status__path")?.textContent).toBe("guide/tabs.md");
    });

    it("closes on Escape and gives focus back to the control that opened it", async () => {
      await mount();
      const fab = host.querySelector<HTMLButtonElement>(".pge-pages-fab")!;
      await act(async () => {
        fab.focus();
        fab.click();
      });
      const dialog = host.querySelector<HTMLElement>(".pge-modal--pages")!;
      await act(async () => {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(host.querySelector(".pge-modal--pages")).toBeNull();
      expect(document.activeElement).toBe(host.querySelector(".pge-pages-fab"));
    });

    it("traps Tab inside itself, which is what `aria-modal` promises", async () => {
      await mount();
      await act(async () => {
        host.querySelector<HTMLButtonElement>(".pge-pages-fab")!.click();
      });
      const dialog = host.querySelector<HTMLElement>(".pge-modal--pages")!;
      const stops = [...dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")];
      const last = stops[stops.length - 1]!;

      last.focus();
      await act(async () => {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      });
      expect(document.activeElement).toBe(stops[0]);

      await act(async () => {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
      });
      expect(document.activeElement).toBe(last);
    });
  });
});

describe("the remembered sidebar width", () => {
  beforeEach(() => globalThis.localStorage.clear());

  it("falls back to the default, and clamps what it is given", () => {
    expect(loadSidebarWidth()).toBe(SIDEBAR_DEFAULT);
    globalThis.localStorage.setItem("pagina:editor:sidebar-width", "not a number");
    expect(loadSidebarWidth()).toBe(SIDEBAR_DEFAULT);
    saveSidebarWidth(10_000);
    expect(loadSidebarWidth()).toBe(520);
    saveSidebarWidth(1);
    expect(loadSidebarWidth()).toBe(160);
  });
});
