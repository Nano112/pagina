/**
 * Publishing from the browser.
 *
 * A published page carries its figures as pre-rendered SVG — one per theme — so a reader sees the
 * diagram before (or without) any JavaScript. The build does that in Node through
 * `@kineglyph/export`'s `prerender`, which is not available here: the editor runs in a page, with
 * only the bare `kineglyph` runtime the host's import map gives it. So this is the same recipe by
 * hand — evaluate the scene module, `resolveFigure` it at the article's width against each theme's
 * tokens, seek the timeline to its end, `renderSvg` the frame — over the *store's* text rather than
 * the disk's, which is what makes "publish" mean "publish what I am looking at".
 *
 * A figure that will not render is reported to the console and left out. Publishing an article
 * because one diagram is broken is worse than publishing it with that one figure hydrating
 * client-side, which is exactly what the page falls back to.
 */
// Bare specifier on purpose — see `kineglyph.ts`.
import { defaultTheme, renderSvg, resolveFigure, seekTimeline } from "kineglyph";
import type { RenderedArticle } from "@pagina/core";
import type { ArticleStore } from "../store/index.js";
import { evaluateModule, evaluateSceneModule } from "./kineglyph.js";

/** What `resolveFigure` takes and what it wants for a theme, without reaching past `kineglyph`. */
type FigureSource = Parameters<typeof resolveFigure>[0];
type ThemeTokens = NonNullable<Parameters<typeof resolveFigure>[1]["theme"]>;

/** The layout width figures are resolved at when `article.yaml` does not say. */
export const DEFAULT_FIGURE_WIDTH = 960;

/** The two themes every figure is rendered for. Their names are the ones the manifest uses. */
export interface FigureThemes {
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

/** Figure id → theme name → SVG, which is the shape `POST {base}/publish` carries. */
export type FigureSvgs = Record<string, Record<string, string>>;

/**
 * The `{ light, dark }` token pair named by `article.yaml`'s `kineglyph.theme`, or Kineglyph's
 * default for both when there is none — or when the module will not load, which must not be the
 * thing that stops a publish.
 */
export async function loadFigureThemes(store: ArticleStore): Promise<FigureThemes> {
  const rel = store.article?.kineglyph?.theme;
  if (rel === undefined || rel === "") return { light: defaultTheme, dark: defaultTheme };
  try {
    const source = store.files.get(rel)?.text ?? (await store.open(rel)).text ?? "";
    const module = await evaluateModule(source);
    const fallback = (module["default"] ?? {}) as { light?: ThemeTokens; dark?: ThemeTokens };
    const light = (module["light"] as ThemeTokens | undefined) ?? fallback.light ?? defaultTheme;
    const dark = (module["dark"] as ThemeTokens | undefined) ?? fallback.dark ?? light;
    return { light, dark };
  } catch (error) {
    console.warn(`pagina: the theme module ${rel} did not load, using the default theme — ${messageOf(error)}`);
    return { light: defaultTheme, dark: defaultTheme };
  }
}

/** Site-absolute URL (which includes `base`) → folder-relative path, as `@pagina/vite` does it. */
function toFolderRelative(url: string, base: string): string {
  return (url.startsWith(base) ? url.slice(base.length) : url).replace(/^\/+/, "");
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Every module and inline figure of `article`, rendered to one SVG per theme. Static figures are
 * skipped: they are already an asset, and the publish payload has nothing to add to them.
 */
export async function renderArticleFigures(
  store: ArticleStore,
  article: RenderedArticle,
  themes: FigureThemes,
  width: number = DEFAULT_FIGURE_WIDTH,
): Promise<FigureSvgs> {
  const figures: FigureSvgs = {};
  const themeList: readonly (readonly [string, ThemeTokens])[] = [["light", themes.light], ["dark", themes.dark]];
  for (const page of Object.values(article.pages)) {
    for (const fig of page.figures) {
      if (fig.kind === "static") continue;
      try {
        const source = fig.kind === "inline"
          ? fig.source ?? ""
          : await sceneSource(store, toFolderRelative(fig.scene ?? "", store.base));
        const figure = await evaluateSceneModule(source);
        if (figure === null || typeof figure !== "object") {
          throw new Error("the module's default export is not a scene");
        }
        const svgs: Record<string, string> = {};
        for (const [name, tokens] of themeList) {
          const scene = resolveFigure(figure as FigureSource, { width, theme: tokens });
          const errors = (scene.diagnostics ?? []).filter((d) => d.severity === "error");
          if (errors.length > 0) {
            throw new Error(errors.map((d) => `${d.code}: ${d.message}`).join("; "));
          }
          const frame = seekTimeline(scene, scene.timeline?.duration ?? 0);
          svgs[name] = renderSvg(frame, { idPrefix: `${fig.id}-${name}` });
        }
        figures[fig.id] = svgs;
      } catch (error) {
        // Deliberately not thrown: one broken diagram must not cost the author the whole publish.
        console.warn(`pagina: figure ${fig.id} (${page.path}) did not render — ${messageOf(error)}`);
      }
    }
  }
  return figures;
}

/** The scene module's text, preferring the store's copy so unsaved edits are what gets published. */
async function sceneSource(store: ArticleStore, path: string): Promise<string> {
  const mirrored = store.files.get(path)?.text;
  if (mirrored !== undefined) return mirrored;
  return (await store.open(path)).text ?? "";
}

/**
 * Renders the article, renders its figures, and ships both through the backend's publish endpoint.
 * This is what `mountEditor(...).publish()` and `<pagina-editor>.publish()` call.
 */
export async function publishArticle(store: ArticleStore): Promise<{ publishedAt: string }> {
  const article = await store.renderAll();
  const themes = await loadFigureThemes(store);
  const width = store.article?.kineglyph?.width ?? DEFAULT_FIGURE_WIDTH;
  const figures = await renderArticleFigures(store, article, themes, width);
  return await store.publish(figures, article);
}
