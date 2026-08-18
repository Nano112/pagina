import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createTheme, defaultTheme, inheritTheme, overrideTheme, type ThemeTokens } from "@kineglyph/core";
import { prerender, rewriteImports } from "@kineglyph/export";
import { FIGURE_WIDTHS, isKineglyphThemeModule, THEME_INHERIT } from "@pagina/core";
import type { DrawnFigure } from "@pagina/core";
import type { ArticleConfig, Diagnostic, RenderedArticle } from "@pagina/core";
import { resolveKineglyphBundle } from "./kineglyph.js";

export interface KineglyphThemes {
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
  /**
   * The article's `kineglyph.themes`, resolved — the vocabulary a single `<figure>` picks from.
   *
   * Loaded here, at publish time, and named the same way in the browser, so the drawing a reader
   * gets before the runtime lands and the one they get after it are painted from one declaration.
   */
  readonly named?: Readonly<Record<string, ThemeTokens>>;
}

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
/**
 * A theme module's export, as the theme a figure is actually drawn with.
 *
 * Kineglyph's themes now record which colour roles they *claim*: a claimed role is pinned on the
 * drawing's own root and holds against the page, an unclaimed one resolves from the page's
 * `--kg-color-*`, and naming a role in an override is what claims it. So a **partial** theme — the
 * shape an author almost always writes, three colours and nothing else — has to reach
 * `createTheme` as an override rather than be spread over the defaults, or every one of the twenty
 * roles would be claimed and the article would go back to overruling its own host.
 *
 * A complete `ThemeTokens` is passed through untouched, because it already carries whatever it
 * decided about claims: `inheritTheme()` claims nothing and `overrideTheme()` claims everything,
 * and re-running either through `createTheme` would silently make it the other one.
 */
function asTheme(value: unknown): ThemeTokens | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  // "Complete" is the shape Kineglyph's own constructors return: a palette *and* the geometry that
  // goes with it. Anything less was hand-written, and the roles it names are the roles it means.
  const complete = typeof o["colors"] === "object" && typeof o["typography"] === "object" && typeof o["spacing"] === "object";
  return complete ? (value as ThemeTokens) : createTheme(value as Parameters<typeof createTheme>[0]);
}

/**
 * A theme named rather than shipped — `inherit`, or a name a runtime knows.
 *
 * `inherit` is the reserved one and pagina resolves it here, because it is the answer that must
 * mean the same thing on every host: draw with the default palette and claim none of it, so every
 * paint resolves from the page. Any other name is Kineglyph's registry to answer, and it answers
 * `undefined` for one it does not know — which is inherit as well, and the right outcome for a typo
 * as much as for a decision. pagina asks the runtime rather than keeping a list, so a name it has
 * never heard of works the moment the runtime learns it.
 *
 * Note that `default` therefore inherits: it claims no roles, so it follows the page. A theme that
 * is meant to hold its palette against the page says so with `overrideTheme()`.
 */
async function themeNamed(name: string, base: ThemeTokens = defaultTheme): Promise<ThemeTokens> {
  if (name !== THEME_INHERIT) {
    try {
      const web = (await import("@kineglyph/web")) as { themeByName?: (n: string) => ThemeTokens | undefined };
      const found = web.themeByName?.(name);
      if (found !== undefined) return found;
    } catch {
      // A runtime that cannot be loaded here (or predates `themeByName`) is not an error: the name
      // simply resolves to nothing, and nothing is inherit.
    }
  }
  // `inherit` against whatever it is inheriting *from*, which is the enclosing declaration rather
  // than Kineglyph's default. The claims are what inherit is about and `inheritTheme` drops them
  // all; keeping the base's literals only decides what the figure looks like on a page that maps
  // no `--kg-color-*` at all, and there the article's own palette is the better answer than a
  // palette nobody in this folder chose.
  return inheritTheme(base);
}

/** One theme module of the article's, evaluated: `{ light, dark }` as the author exported it. */
async function loadThemeModule(folder: string, rel: string): Promise<{ light: ThemeTokens; dark: ThemeTokens }> {
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
  const mod = (await import(url)) as { default?: { light?: unknown; dark?: unknown }; light?: unknown; dark?: unknown };
  const light = asTheme(mod.light ?? mod.default?.light) ?? defaultTheme;
  const dark = asTheme(mod.dark ?? mod.default?.dark) ?? light;
  return { light, dark };
}

/**
 * A named palette, from a module the article ships or from the runtime's own registry.
 *
 * A figure naming this holds it against the page, so `overrideTheme` is applied to a *named* one:
 * `kineglyph.themes: { midnight: midnight }` is an author asking for midnight's colours, and a
 * built-in that claims nothing would silently mean "inherit" — the one reading nobody writing that
 * line intends. A module the article ships is left exactly as authored, because `createTheme`
 * already recorded what it named and that is the author's own answer.
 */
async function loadNamedTheme(folder: string, spec: string): Promise<ThemeTokens> {
  if (isKineglyphThemeModule(spec)) return (await loadThemeModule(folder, spec)).light;
  const found = await themeNamed(spec);
  return spec === THEME_INHERIT ? found : overrideTheme(found);
}

export async function loadKineglyphThemes(folder: string, config: ArticleConfig): Promise<KineglyphThemes> {
  const entries = Object.entries(config.kineglyph?.themes ?? {});
  const named = Object.fromEntries(
    await Promise.all(entries.map(async ([name, spec]) => [name, await loadNamedTheme(folder, spec)] as const)),
  );
  const withNamed = (base: { light: ThemeTokens; dark: ThemeTokens }): KineglyphThemes =>
    entries.length === 0 ? base : { ...base, named };
  const rel = config.kineglyph?.theme;
  if (rel === undefined) return withNamed({ light: defaultTheme, dark: defaultTheme });
  if (!isKineglyphThemeModule(rel)) {
    const one = await themeNamed(rel);
    return withNamed({ light: one, dark: one });
  }
  return withNamed(await loadThemeModule(folder, rel));
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
  /**
   * The theme list one figure is drawn with — the article's, unless the figure named its own.
   *
   * A figure's declaration replaces *both* schemes rather than one, and that is the point of it:
   * a declared theme claims its roles, so it holds against whatever the page is painting, in light
   * and in dark alike. That is what "this figure decides its own colours" has to mean; a
   * declaration that still flipped with the page would be a preference, not an override.
   *
   * Resolved once per name, because the same name on twelve figures is one answer.
   */
  const named = new Map<string, Promise<ThemeTokens>>();
  const themesFor = async (fig: { theme?: string }): Promise<typeof themeList> => {
    if (fig.theme === undefined) return themeList;
    let tokens = named.get(fig.theme);
    if (tokens === undefined) {
      const declared = themes.named?.[fig.theme];
      // The article's own vocabulary first, then the runtime's registry. `inherit` resolves
      // against the *article's* theme — the declaration this figure is escaping.
      tokens = declared === undefined ? themeNamed(fig.theme, themes.light) : Promise.resolve(declared);
      named.set(fig.theme, tokens);
    }
    const t = await tokens;
    return [{ name: "light", tokens: t }, { name: "dark", tokens: t }];
  };
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
        const results = await prerender(source, { themes: await themesFor(fig), widths: widthList, baseUrl, idPrefix: fig.id });
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
