// Vite's lib build only emits a page's CSS as a separate asset when the client entry itself
// imports it (see `@pagina/vite`'s `bundleClient`, which sets `assetFileNames: "pagina.[ext]"`
// and `cssCodeSplit: false`); the dev server instead serves this file directly at
// `/@fs<clientDir>/pagina.css`.
import "./pagina.css";
// The bare `kineglyph` specifier is resolved by the page's import map in production and by
// `@pagina/vite`'s dev-server alias in dev; it must stay a bare import here (never
// `@kineglyph/web/bundle` directly) or the client bundle would inline a second copy of the
// runtime instead of sharing the one the import map points at. This static import cannot be
// try/caught (an import-map misconfiguration is a page-level error, not something this module
// can recover from) — everything below that does NOT depend on it resolving (tabs, code-copy,
// theme toggle, HMR bridge) is wired up before the guarded `mountAll` call further down, so a
// runtime load failure or a figure throwing doesn't take those features down with it.
import { mountAll, defaultTheme, type ThemeTokens, type EmbeddedFigure } from "kineglyph";
// pagina's editorial default: a figure in prose is a picture, and the instrument is opted into
// with `data-instrument="true"`. See the module for why that opinion lives here and not in the
// library.
import { figureChrome } from "./figure-chrome.js";
// Relative rather than through the package's own name: `client/` is source that a consumer's Vite
// compiles, so it must not depend on this package having been built into `dist/` first.
import { wireTabs } from "../src/interactive.js";

type Themes = { light: ThemeTokens; dark: ThemeTokens };
type Theme = "light" | "dark";

const root = document.documentElement;
const current = (): Theme => (root.dataset.theme === "dark" ? "dark" : "light");

// --- theme init -------------------------------------------------------------------------
// The `<head>` inline script already set `data-theme` from localStorage/prefers-color-scheme
// before this module loads (avoids a flash of the wrong theme); nothing to do here but read it.

let themes: Themes = { light: defaultTheme, dark: defaultTheme };
// Populated once `mountAll` (below) settles; starts empty so the toggle works immediately even
// if mounting is slow, fails, or never resolves.
let figures: EmbeddedFigure[] = [];

// --- theme toggle -------------------------------------------------------------------------
// Wired before any await point: reads `themes`/`figures` through closures, so it works
// correctly whether it fires before or after those variables are populated below.

document.querySelector("[data-pagina-theme-toggle]")?.addEventListener("click", () => {
  const next: Theme = current() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("pagina-theme", next);
  } catch {
    /* private mode / storage disabled */
  }
  for (const f of figures) f.controller.setTheme(themes[next]);
  // Pre-rendered figures need nothing here. They are inline SVG whose every paint reads a
  // `--kg-color-*` that `tokens.css` maps onto `--pg-*`, so flipping `data-theme` above has
  // already re-tinted them — in the same repaint, with no second variant to swap in and no
  // `prefers-color-scheme` query asking the wrong question of a manual toggle.
});

// --- tabs (a11y: click + arrow-key roving tabindex) ---------------------------------------
// The implementation is in `../src/interactive.ts` rather than here, because this is not the only
// place core's HTML is put into a DOM: the editor's preview and its published view render the same
// markup in the browser without loading this bundle, and had no working tabs at all until the
// behaviour stopped living inside the site's client entry.

wireTabs(document);

// --- search -----------------------------------------------------------------------------------
// Wired here, loaded elsewhere. This block is a listener and a dynamic `import()`; the dialog, its
// styles' behaviour and — much the largest part — the index itself are fetched the first time a
// reader asks for search and never on a page they only read. See `client/search.ts`.
//
// `data-pg-search` is the page telling us an index exists. Without it there is nothing to search,
// the shell rendered no trigger, and the keys stay unbound: `/` still types a slash.

const searchUrl = root.dataset.pgSearch;
if (searchUrl !== undefined && searchUrl !== "") {
  const wiring = { url: searchUrl, base: root.dataset.pgBase ?? "/" };
  // The chunk is fetched once and shared; a second press while the first is in flight awaits it.
  let chunk: Promise<typeof import("./search.js")> | undefined;
  const open = (initial = ""): void => {
    chunk ??= import("./search.js");
    void chunk.then((m) => { m.openSearch(wiring, initial); }).catch((e: unknown) => {
      console.warn("pagina: search failed to load", e);
    });
  };

  // Anything the shell — or a host with its own chrome — marked as a trigger.
  for (const trigger of document.querySelectorAll<HTMLButtonElement>("[data-pg-search-open]")) {
    // Rendered `disabled` with a `title` explaining that it needs script. It has script now.
    trigger.disabled = false;
    trigger.removeAttribute("title");
    trigger.addEventListener("click", () => { open(); });
  }

  document.addEventListener("keydown", (event) => {
    // ⌘K / Ctrl-K anywhere, `/` only when the reader is not already typing into something. A
    // shortcut that eats a slash inside a form field is a shortcut that broke the field.
    const target = event.target;
    const typing = target instanceof HTMLElement
      && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
    const combo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
    const slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (!combo && !slash) return;
    event.preventDefault();
    open();
  });
}

// --- code-copy buttons ---------------------------------------------------------------------

for (const pre of document.querySelectorAll<HTMLElement>(".pg-content pre")) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pg-copy";
  btn.textContent = "Copy";
  btn.addEventListener("click", () => {
    void navigator.clipboard.writeText(pre.querySelector("code")?.innerText ?? pre.innerText).then(() => {
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
  });
  pre.append(btn);
}

// --- HMR bridge -----------------------------------------------------------------------------
// `@pagina/vite`'s dev server pushes kineglyph scene/theme updates over Vite's HMR channel;
// re-dispatch them as the plain DOM CustomEvent that `@kineglyph/web`'s `mountAll` listens for
// (see `installUpdateListener` in `@kineglyph/web/embed`), so dev and prod share one code path.
const hot = (import.meta as unknown as { hot?: { on(event: string, cb: (data: { url: string }) => void): void } }).hot;
hot?.on("kineglyph:update", (d) => document.dispatchEvent(new CustomEvent("kineglyph:update", { detail: d })));

// --- kineglyph theme + mount (async; guarded so a failure here never disables the above) ----

const kgThemeUrl = root.dataset.kgTheme;
if (kgThemeUrl !== undefined && kgThemeUrl !== "") {
  try {
    const m = (await import(/* @vite-ignore */ kgThemeUrl)) as Partial<Themes> & { default?: Partial<Themes> };
    themes = {
      light: m.light ?? m.default?.light ?? defaultTheme,
      dark: m.dark ?? m.default?.dark ?? m.light ?? defaultTheme,
    };
  } catch (e) {
    console.warn("pagina: kineglyph theme failed to load", e);
  }
}

try {
  figures = await mountAll({ theme: () => themes[current()], mountOptions: figureChrome });
} catch (e) {
  console.warn("pagina: kineglyph mount failed", e);
}
