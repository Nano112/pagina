/**
 * @vitest-environment jsdom
 *
 * The preview pane draws a figure with the theme the article declares.
 *
 * The preview is the *only* place an author sees a figure before publishing, so a figure that is
 * one colour here and another on the page is a bug found by readers. `mountAll` was once called
 * with no theme at all, so every figure was drawn in Kineglyph's default palette; it is handed the
 * article's module now, and — this is the part that changed — handed it the way the *builder*
 * hands it over, so a partial theme claims the three roles it names here as well as there.
 *
 * What the preview no longer does is paint `--kg-color-*` onto the container. That was pagina
 * pinning the declared palette over the page's tokens, which is the inversion this undid: the
 * roles a theme claims are pinned by Kineglyph on the drawing's own root, and everything else
 * resolves from the page, in the preview exactly as on the published page.
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
  // Stands in for the real one closely enough for what is asserted: it fills the geometry from the
  // base and records the colour roles the override *named*, which is the whole of the contract the
  // editor has to honour — a partial theme must arrive partial.
  createTheme: (o: { colors?: Record<string, string> }) => ({
    ...RUNTIME_DEFAULT, ...o,
    colors: { ...RUNTIME_DEFAULT.colors, ...o.colors },
    declaredColors: Object.keys(o.colors ?? {}),
  }),
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
    expect(theme()).toMatchObject({ name: "vellum", colors: expect.objectContaining(LIGHT.colors) });
  });

  it("keeps a partial theme partial, so unnamed roles still follow the page", async () => {
    // Three roles named is three roles claimed. Spread over the defaults instead — which is what
    // this did — the theme would arrive claiming every role and the article would go back to
    // overruling its own host.
    await preview(THEME_MODULE);
    expect(theme()).toMatchObject({ declaredColors: ["canvas", "accent", "surfaceRaised"] });
  });

  it("paints no --kg-color-* of its own, because the page is what paints a figure", async () => {
    const container = await preview(THEME_MODULE);
    expect(container.style.getPropertyValue("--kg-color-canvas")).toBe("");
    expect(container.style.getPropertyValue("--kg-color-accent")).toBe("");
  });

  it("follows the page's light/dark switch", async () => {
    await preview(THEME_MODULE);
    document.documentElement.dataset["theme"] = "dark";
    await act(async () => {
      await Promise.resolve();
    });
    expect(theme()).toMatchObject({ name: "basalt", colors: expect.objectContaining(DARK.colors) });
  });

  it("leaves an article that declares no theme to its host, as before", async () => {
    const container = await preview(undefined);
    expect(theme()).toEqual(RUNTIME_DEFAULT);
    expect(container.style.getPropertyValue("--kg-color-canvas")).toBe("");
  });
});
