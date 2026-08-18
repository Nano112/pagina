/**
 * @vitest-environment jsdom
 *
 * The preview pane paints a figure in the article's colours, not in the runtime's.
 *
 * The preview is the *only* place an author sees a figure before publishing, so a figure that is
 * one colour here and another on the page is a bug found by readers. It was: `mountAll` was called
 * with no theme at all, so every figure was drawn in Kineglyph's default palette — and drawn is
 * only half of it, because `pagina.css` (which the editor links, for preview parity) points every
 * `--kg-color-*` at a `--pg-*` token, which repaints even a correctly drawn figure.
 *
 * Both halves are checked here, against the article's declared theme module:
 *
 *  - the tokens handed to `mountAll`, which decide the literals baked into the SVG;
 *  - the `--kg-color-*` custom properties on the preview container, which decide what the browser
 *    actually paints — the same variables the published page emits from the same declaration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { ArticleStore } from "../src/store/article-store.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { Preview } from "../src/ui/Preview.js";

/** The article's own palette — Nucleation's, which is where the mismatch was found. */
const LIGHT = { name: "vellum", colors: { canvas: "#f4f1e9", accent: "#237f74", surfaceRaised: "#fffdf8" } };
const DARK = { name: "basalt", colors: { canvas: "#101216", accent: "#67cbbb", surfaceRaised: "#1b1f25" } };
/**
 * What the runtime falls back to, and what the preview used to show regardless of the above.
 * Hoisted with the mock factory, which vitest lifts above every import in this file.
 */
const { RUNTIME_DEFAULT, mounts } = vi.hoisted(() => ({
  RUNTIME_DEFAULT: { name: "default", colors: { canvas: "#f6f7f9", accent: "#3b5bdb" } },
  mounts: { calls: [] as { theme?: (() => unknown) | unknown }[] },
}));

vi.mock("kineglyph", () => ({
  mountAll: async (options: { theme?: () => unknown }) => {
    mounts.calls.push(options);
    return [];
  },
  mountAllKineglyphLabs: async () => [],
  defaultTheme: RUNTIME_DEFAULT,
}));

/**
 * The theme module the article ships. `Preview` reaches it with a dynamic `import()` of the URL
 * `article.yaml` declares, which in a browser is a real request and here is a data URL — the point
 * being that nothing about the palette is known to the editor until that module is fetched.
 */
const THEME_MODULE = `data:text/javascript,${encodeURIComponent(
  `export const light=${JSON.stringify(LIGHT)};export const dark=${JSON.stringify(DARK)};`,
)}`;

const ARTICLE = (theme: string | undefined): string =>
  `slug: t\ntitle: T\nform: docs\nstatus: published\nnav:\n  - { title: Home, page: index.md }\n${theme === undefined ? "" : `kineglyph:\n  theme: ${theme}\n`}`;

const PAGE = `# Home\n\n<figure class="kg" data-scene="scenes/one.mjs" id="one"></figure>\n`;

async function preview(theme: string | undefined): Promise<HTMLElement> {
  const store = new ArticleStore(new MemoryBackend({ "article.yaml": ARTICLE(theme), "index.md": PAGE }));
  await store.load();
  const view = render(<Preview store={store} path="index.md" />);
  // The render is debounced, and the hydration effect runs a paint later still.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return view.container.querySelector<HTMLElement>(".pg-content")!;
}

const theme = (): unknown => {
  const last = mounts.calls.at(-1)?.theme;
  return typeof last === "function" ? (last as () => unknown)() : last;
};

beforeEach(() => {
  mounts.calls = [];
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.documentElement.dataset["theme"] = "light";
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the preview's kineglyph theme", () => {
  it("draws with the theme the article declares, not the runtime default", async () => {
    await preview(THEME_MODULE);
    expect(theme()).toEqual(LIGHT);
  });

  it("paints with it too — the variables that outrank pagina's --pg-* bridge", async () => {
    const container = await preview(THEME_MODULE);
    expect(container.style.getPropertyValue("--kg-color-canvas")).toBe("#f4f1e9");
    expect(container.style.getPropertyValue("--kg-color-accent")).toBe("#237f74");
    // The token is spelled the way Kineglyph spells it, or the variable names nothing.
    expect(container.style.getPropertyValue("--kg-color-surface-raised")).toBe("#fffdf8");
  });

  it("draws and paints the same colours, which is the whole point", async () => {
    const container = await preview(THEME_MODULE);
    const drawn = theme() as { colors: Record<string, string> };
    expect(container.style.getPropertyValue("--kg-color-canvas")).toBe(drawn.colors["canvas"]);
    expect(container.style.getPropertyValue("--kg-color-accent")).toBe(drawn.colors["accent"]);
  });

  it("follows the page's light/dark switch", async () => {
    const container = await preview(THEME_MODULE);
    document.documentElement.dataset["theme"] = "dark";
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.style.getPropertyValue("--kg-color-canvas")).toBe("#101216");
    expect(theme()).toEqual(DARK);
  });

  it("leaves an article that declares no theme to its host, as before", async () => {
    const container = await preview(undefined);
    expect(theme()).toEqual(RUNTIME_DEFAULT);
    expect(container.style.getPropertyValue("--kg-color-canvas")).toBe("");
  });
});
