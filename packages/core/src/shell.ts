import type { RenderedArticle } from "./types.js";

/**
 * Context a shell gets for one render pass. All URLs are site URLs (they include `base`).
 *
 * This lives in `@pagina/core` rather than next to the build that supplies it, so a shell
 * implementation (`@pagina/shell-static` and any third-party one) can type itself against the
 * contract without taking a dependency on the Vite-based builder that happens to call it.
 * `@pagina/vite` re-exports both types for compatibility.
 */
/**
 * How much of pagina's own CSS a page carries.
 *
 * - `"full"` — the whole stylesheet: tokens, the reading layer and the chrome layer. The default.
 * - `"tokens"` — the token contract plus the minimal reset only, for a host that wants pagina's
 *   structure and `--pg-*` variables but styles the content column itself.
 * - `"none"` — no pagina stylesheet at all; the markup and its `pg-*` class names are the
 *   entire contract.
 *
 * All three emit identical HTML: this picks the stylesheet, never the structure. `chrome` is the
 * separate axis (see {@link ShellContext.chrome}).
 */
export type ThemeLevel = "full" | "tokens" | "none";

export interface ShellContext {
  readonly base: string;
  readonly kineglyphRuntimeUrl: string;
  readonly clientUrl: string;
  readonly cssUrl: string;
  /** URL of the tokens-only sheet, used when {@link theme} is `"tokens"`. Absent means the
   *  shell derives it from {@link cssUrl}. */
  readonly tokensCssUrl?: string;
  /** How much pagina CSS to link. Defaults to `"full"`. */
  readonly theme?: ThemeLevel;
  /** Render pagina's own site header (brand row + theme toggle). Defaults to `true`; a host
   *  that supplies its own header sets `false`. The sidebar, TOC and pager belong to the
   *  article, not to the host chrome, and are unaffected. */
  readonly chrome?: boolean;
  readonly dev: boolean;
  /** The dev server is running with `--edit`, so a shell may offer an "Edit this page" link
   *  into `/__edit/<href>`. Absent (or false) everywhere else, including every static build. */
  readonly edit?: boolean;
  /** Where a shell loads Google's `<model-viewer>` element from, for pages that embed one.
   *  Absent means "the shell's own default"; a site that self-hosts the element sets it. */
  readonly modelViewerUrl?: string;
  /** Absolute origin the site is served from, for `link rel=canonical`, `og:url` and `og:image`.
   *  Absent — and absent from `article.yaml` too — those tags are omitted rather than emitted
   *  relative, and the build warns. */
  readonly siteUrl?: string;
  /** Absolute URL, path included, of the deployment this one mirrors. Set, every page's canonical
   *  and `og:url` address the primary's copy of that page instead of this build's own. Absent for
   *  a site that is nobody's copy, which is the usual case. */
  readonly mirrorOf?: string;
  /**
   * The article's Kineglyph theme, already loaded — the same tokens the builder drew the
   * pre-rendered figures with. A shell publishes their colours as `--kg-color-*` so the page paints
   * a figure in the colours it was drawn in; without that the CSS token bridge in `pagina.css`
   * silently repaints every figure in the host's palette. Absent when the article declares no
   * theme, which is the case where following the host is the right answer.
   */
  readonly kineglyphTheme?: KineglyphThemeColors;
  /**
   * Site URL of the search index the build wrote — `/_pagina/search.json` for a pagina build, or
   * wherever a host serves its own copy from.
   *
   * A shell that gets one may offer search; a shell that does not must not, because there is
   * nothing behind the box. Absent is therefore not "search is off by configuration" but "no index
   * exists", which is the only thing a page can honestly act on.
   */
  readonly searchUrl?: string;
}

/**
 * Just the colours, of each of an article theme's two palettes.
 *
 * Structural on purpose: `@pagina/core` renders no figures and must not depend on Kineglyph's
 * types, but the object `@pagina/vite` loads from the article's theme module satisfies this.
 */
export interface KineglyphThemeColors {
  readonly light: { readonly colors: Readonly<Record<string, string>> };
  readonly dark: { readonly colors: Readonly<Record<string, string>> };
}

/** A page shell: turns a rendered article into files (`out path` → contents). */
export interface Shell {
  readonly clientEntry: string;
  render(article: RenderedArticle, ctx: ShellContext): Promise<Record<string, string | Uint8Array>>;
}
