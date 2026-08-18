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
import { createTheme, defaultTheme, type ThemeTokens } from "kineglyph";

/**
 * A theme module's export, as a theme.
 *
 * The same rule the builder uses (`@pagina/vite`'s `prerender.ts`), and it has to be the same one:
 * a partial theme claims the colour roles it *names* and inherits the rest from the page, so
 * spreading it over the defaults here would make the preview claim twenty roles the published page
 * claims three of. A complete `ThemeTokens` is passed through — it already carries its own answer.
 */
function asTheme(value: unknown): ThemeTokens | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const complete = typeof o["colors"] === "object" && typeof o["typography"] === "object" && typeof o["spacing"] === "object";
  return complete ? (value as ThemeTokens) : createTheme(value as Parameters<typeof createTheme>[0]);
}

export interface KineglyphThemes {
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

/** Both palettes, from a theme module's `light`/`dark` (or its default export's). */
export async function loadKineglyphThemes(url: string | undefined): Promise<KineglyphThemes> {
  const fallback = { light: defaultTheme, dark: defaultTheme };
  if (url === undefined || url === "") return fallback;
  try {
    const m = (await import(/* @vite-ignore */ url)) as { light?: unknown; dark?: unknown; default?: { light?: unknown; dark?: unknown } };
    const light = asTheme(m.light ?? m.default?.light) ?? defaultTheme;
    return { light, dark: asTheme(m.dark ?? m.default?.dark) ?? light };
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

/** Calls back whenever the page's `data-theme` changes; returns the unsubscribe. */
export function onThemeChange(run: () => void): () => void {
  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
