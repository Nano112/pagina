import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultTheme, type ThemeTokens } from "@kineglyph/core";
import { prerender, rewriteImports } from "@kineglyph/export";
import { FIGURE_WIDTHS } from "@pagina/core";
import type { DrawnFigure } from "@pagina/core";
import type { ArticleConfig, Diagnostic, RenderedArticle } from "@pagina/core";
import { resolveKineglyphBundle } from "./kineglyph.js";

export interface KineglyphThemes { readonly light: ThemeTokens; readonly dark: ThemeTokens }

/**
 * Loads the `{ light, dark }` token pair named by `article.yaml`'s `kineglyph.theme`
 * (a module path relative to the folder). Falls back to Kineglyph's default theme.
 *
 * This is a plain Node `import()`, outside Vite's module graph, so — unlike the browser
 * bundle (aliased in `dev.ts`/`build.ts`) or scene figures (rewritten by
 * `@kineglyph/export`'s `prerender`) — the bare `kineglyph` specifier a theme module uses
 * has nothing to resolve it. Read the source as text and rewrite that one specifier (and
 * any relative imports, resolved against the theme file's own location) before evaluating
 * it, the same technique `@kineglyph/export` uses internally for scene modules.
 */
export async function loadKineglyphThemes(folder: string, config: ArticleConfig): Promise<KineglyphThemes> {
  const rel = config.kineglyph?.theme;
  if (rel === undefined) return { light: defaultTheme, dark: defaultTheme };
  const abs = resolve(folder, rel);
  const baseUrl = pathToFileURL(abs).href;
  const source = await readFile(abs, "utf8");
  const rewritten = rewriteImports(source, (specifier) => {
    if (specifier === "kineglyph") return pathToFileURL(resolveKineglyphBundle("import")).href;
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/"))
      return new URL(specifier, baseUrl).href;
    return specifier;
  });
  const url = `data:text/javascript;base64,${Buffer.from(rewritten, "utf8").toString("base64")}`;
  const mod = (await import(url)) as { default?: Partial<KineglyphThemes>; light?: ThemeTokens; dark?: ThemeTokens };
  const light = mod.light ?? mod.default?.light ?? defaultTheme;
  const dark = mod.dark ?? mod.default?.dark ?? light;
  return { light, dark };
}

/** Site-absolute URL (which includes `base`) → folder-relative path. */
function toFolderRelative(url: string, base: string): string {
  return (url.startsWith(base) ? url.slice(base.length) : url).replace(/^\/+/, "");
}

/** One theme's rendering of one figure, plus whether hydrating it could show a reader more. */
export interface PrerenderedFigure {
  readonly theme: string;
  readonly svg: string;
  readonly inlineSvg: string;
  /** `sceneNeedsRuntime` for the resolved scene — see `@kineglyph/export`. */
  readonly needsRuntime: boolean;
  /** The container width this drawing was measured for. */
  readonly containerWidth: number;
}

export interface PrerenderedFigures {
  /**
   * Figure id → one entry per theme per width, widest first. Only figures that rendered appear.
   *
   * `svg` is the standalone document written to `_pagina/figures/…`; `inlineSvg` is the same
   * frame as an HTML fragment, which is what goes into the page.
   */
  readonly figures: Map<string, PrerenderedFigure[]>;
  readonly diagnostics: Diagnostic[];
}

/**
 * Pre-renders every inline and module figure of an article to one SVG per theme.
 * Static figures are skipped.
 *
 * A figure that fails to render (bad scene module, missing file, layout error) does not
 * abort the pass: it is reported as a `figure-prerender` diagnostic and the remaining
 * figures are still attempted, so one build reports every broken figure at once.
 */
export async function prerenderFigures(
  article: RenderedArticle,
  folder: string,
  themes: KineglyphThemes,
  widths: number | readonly number[] = FIGURE_WIDTHS,
  base = "/",
): Promise<PrerenderedFigures> {
  const widthList = typeof widths === "number" ? [widths] : [...widths];
  const figures = new Map<string, PrerenderedFigure[]>();
  const diagnostics: Diagnostic[] = [];
  const themeList = [{ name: "light", tokens: themes.light }, { name: "dark", tokens: themes.dark }];
  for (const page of Object.values(article.pages)) {
    for (const fig of page.figures) {
      if (fig.kind === "static") continue;
      try {
        let source: string;
        let baseUrl: string;
        if (fig.kind === "inline") {
          source = fig.source ?? "";
          baseUrl = pathToFileURL(resolve(folder, page.path)).href;
        } else {
          const abs = resolve(folder, toFolderRelative(fig.scene ?? "", base));
          source = await readFile(abs, "utf8");
          baseUrl = pathToFileURL(abs).href;
        }
        // `@kineglyph/export` appends the theme name, so the SVG's root id is `${fig.id}-light`.
        // That matters now the SVG is inlined: its ids share a namespace with the `<figure>` that
        // holds it, and `fig.id` is already taken by the figure element.
        const results = await prerender(source, { themes: themeList, widths: widthList, baseUrl, idPrefix: fig.id });
        figures.set(
          fig.id,
          results.map((r) => ({ theme: r.theme, svg: r.svg, inlineSvg: r.inlineSvg, needsRuntime: r.needsRuntime, containerWidth: r.containerWidth })),
        );
      } catch (error) {
        diagnostics.push({
          severity: "error",
          code: "figure-prerender",
          message: `${fig.id} (${page.path}): ${error instanceof Error ? error.message : String(error)}`,
          page: page.path,
        });
      }
    }
  }
  return { figures, diagnostics };
}

/**
 * The drawing a page inlines: the widest variant, and every variant for the stylesheet to pick from.
 *
 * Only one theme's drawings are kept. Colour is CSS's job now — every figure is painted from
 * `--kg-color-*` at view time — so a second theme's copies are the same pictures with different
 * numbers baked into attributes nothing reads, and inlining them would double the page for nothing.
 * The themed SVGs are still written out as files, which is what `figures` in the manifest is for.
 */
export function drawnFigure(results: readonly PrerenderedFigure[] | undefined): DrawnFigure | undefined {
  if (results === undefined || results.length === 0) return undefined;
  const theme = results[0]!.theme;
  const mine = results.filter((r) => r.theme === theme);
  const widest = mine[0]!;
  return {
    svg: widest.inlineSvg,
    needsRuntime: widest.needsRuntime,
    ...(mine.length < 2
      ? {}
      : { variants: mine.map((r) => ({ containerWidth: r.containerWidth, svg: r.inlineSvg })) }),
  };
}

/**
 * The container widths an article's figures are drawn at.
 *
 * A bare `width` is honoured as a single drawing rather than folded into the defaults: it is the
 * setting that existed before variants did, and it says "this article's figures are this size" —
 * an article that pinned them keeps them pinned, and adds `widths` when it wants the choice.
 */
export function figureWidths(config: ArticleConfig): readonly number[] {
  const kg = config.kineglyph;
  if (kg?.widths !== undefined && kg.widths.length > 0) return kg.widths;
  if (kg?.width !== undefined) return [kg.width];
  return FIGURE_WIDTHS;
}

/**
 * One drawing per theme — the widest — for the standalone SVG files.
 *
 * `_pagina/figures/<id>.<theme>.svg` is the figure as a *file*: something to link to, download, or
 * open on its own. A file has no container to answer to, so the question the variants exist to
 * answer does not arise and the fullest drawing is the right one. Results arrive widest first, so
 * the first of each theme is that theme's widest.
 */
export function widestPerTheme(results: readonly PrerenderedFigure[]): PrerenderedFigure[] {
  const seen = new Map<string, PrerenderedFigure>();
  for (const r of results) if (!seen.has(r.theme)) seen.set(r.theme, r);
  return [...seen.values()];
}
