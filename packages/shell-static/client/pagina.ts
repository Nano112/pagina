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
  // Static `<picture>` fallbacks (pre-rendered SVGs) pick the dark variant via a
  // `prefers-color-scheme` media query, which does not track an explicit manual toggle away
  // from the system preference — swap the `<img>` src directly so they stay in sync too.
  for (const img of document.querySelectorAll<HTMLImageElement>("picture.kg-static img"))
    img.src = img.src.replace(/\.(light|dark)\.svg(\?.*)?$/, `.${next}.svg$2`);
});

// --- tabs (a11y: click + arrow-key roving tabindex) ---------------------------------------

for (const group of document.querySelectorAll<HTMLElement>("[data-pg-tabs]")) {
  const tabs = [...group.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (i: number) =>
    tabs.forEach((t, j) => {
      const on = i === j;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const p = document.getElementById(t.getAttribute("aria-controls") ?? "");
      if (p) p.hidden = !on;
      if (on) t.focus({ preventScroll: true });
    });
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        select((i + 1) % tabs.length);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        select((i - 1 + tabs.length) % tabs.length);
      }
    });
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
  figures = await mountAll({ theme: () => themes[current()] });
} catch (e) {
  console.warn("pagina: kineglyph mount failed", e);
}
