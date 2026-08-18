/**
 * The article's Kineglyph theme, in the browser.
 *
 * A theme is a **module the article ships** (`kineglyph: { theme: theme/kineglyph.mjs }` in
 * `article.yaml`), exporting `light` and `dark` token objects. The page shell puts its URL on
 * `<html data-kg-theme>` and loads it before hydrating figures; the editor's preview has to load
 * the same module for the same reason, or a figure is painted one way while being edited and
 * another way once published — with a palette that appears nowhere in the article.
 *
 * Nothing here picks colours. If the article declares no theme, or the module fails to load, the
 * runtime's own `defaultTheme` is what remains — which is what an article with no theme should
 * look like, and is the only reason `defaultTheme` is named at all.
 */
import { kineglyphColorVars } from "@pagina/core";
import { defaultTheme, type ThemeTokens } from "kineglyph";

export interface KineglyphThemes {
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

/** Both palettes, from a theme module's `light`/`dark` (or its default export's). */
export async function loadKineglyphThemes(url: string | undefined): Promise<KineglyphThemes> {
  const fallback = { light: defaultTheme, dark: defaultTheme };
  if (url === undefined || url === "") return fallback;
  try {
    const m = (await import(/* @vite-ignore */ url)) as Partial<KineglyphThemes> & { default?: Partial<KineglyphThemes> };
    return {
      light: m.light ?? m.default?.light ?? defaultTheme,
      dark: m.dark ?? m.default?.dark ?? m.light ?? defaultTheme,
    };
  } catch (e) {
    console.warn("pagina: kineglyph theme failed to load", e);
    return fallback;
  }
}

/**
 * Which of the two the page is showing. Read at paint time rather than captured, so that toggling
 * the theme repaints the figures that are already mounted.
 */
export const currentThemeName = (): "light" | "dark" =>
  document.documentElement.dataset["theme"] === "dark" ? "dark" : "light";

/**
 * Paints one subtree in the article theme's colours.
 *
 * A figure resolves every fill through `var(--kg-color-<role>, <literal>)`, and `pagina.css` — which
 * the editor links so the preview matches the page — points every one of those at a `--pg-*` token.
 * So handing `mountAll` a theme is only half of it: without these variables the preview draws in the
 * article's palette and then paints in pagina's, which is precisely the mismatch a reader sees.
 * Set on the preview container rather than on `:root`, so the editor's own chrome is left alone.
 */
export function applyThemeVars(element: HTMLElement, themes: KineglyphThemes | undefined): void {
  // Cleared first, and cleared entirely when there is no theme: an article that declares none must
  // keep following its host's tokens, which is the other half of the same contract. Leaving a stale
  // `--kg-color-*` behind would pin the figure to a palette nobody asked for.
  for (const name of [...element.style].filter((n) => n.startsWith("--kg-color-"))) element.style.removeProperty(name);
  if (themes === undefined) return;
  for (const [name, value] of Object.entries(kineglyphColorVars(themes[currentThemeName()]?.colors))) {
    element.style.setProperty(name, value);
  }
}

/** Calls back whenever the page's `data-theme` changes; returns the unsubscribe. */
export function onThemeChange(run: () => void): () => void {
  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
