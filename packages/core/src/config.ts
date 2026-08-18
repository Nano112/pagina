import { parse } from "yaml";
import type { ArticleConfig, CoverFit, CoverOn, NavEntry } from "./types.js";

/** Every value `cover_on` may take, in the order the doc lists them. */
export const COVER_ON: readonly CoverOn[] = ["root", "all", "none"];
/** Every value `cover_fit` may take. `contain` is the default — see {@link CoverFit}. */
export const COVER_FIT: readonly CoverFit[] = ["contain", "cover"];
/**
 * The word a level of the theme cascade writes to say "I have no opinion, use the level above".
 *
 * The same value everywhere `theme:` is accepted, because a cascade with a different way of
 * declining at each level is four mechanisms again. It is also exactly what omitting the key does;
 * it exists so that following the level above can be a decision an author wrote down.
 */
export const THEME_INHERIT = "inherit";

function fail(field: string, why: string): never {
  throw new Error(`article.yaml: ${field} ${why}`);
}
function str(v: unknown, field: string): string {
  if (typeof v !== "string" || v === "") fail(field, "must be a non-empty string");
  return v;
}
/** An optional string field: absent stays absent, present must be a non-empty string. */
function optionalStr(v: unknown, field: string): Record<string, string> {
  if (v === undefined || v === null) return {};
  return { [field]: str(v, field) };
}
/**
 * An ISO-8601-ish date, as a string.
 *
 * `yaml` resolves an unquoted `2026-08-17` to a `Date`, and a quoted one to a string; both are
 * legitimate things to write, and `article:published_time` wants one shape. Anything that is
 * neither is an error rather than a silently dropped tag.
 */
function optionalDate(v: unknown, field: string): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (v instanceof Date) return { [field]: v.toISOString() };
  if (typeof v === "string" && v !== "") return { [field]: v };
  return fail(field, "must be a date or a non-empty string");
}
function parseNav(v: unknown, path: string): NavEntry[] {
  if (!Array.isArray(v)) fail(path, "must be a list");
  return v.map((item, i) => {
    const at = `${path}[${i}]`;
    if (item === null || typeof item !== "object") fail(at, "must be a mapping");
    const o = item as Record<string, unknown>;
    if ("section" in o) return { section: str(o.section, `${at}.section`), children: parseNav(o.children, `${at}.children`) };
    if (!("page" in o)) fail(at, "must have `page` or `section`");
    return { title: str(o.title, `${at}.title`), page: str(o.page, `${at}.page`) };
  });
}

/**
 * Whether `kineglyph.theme` names a **module the article ships** rather than a theme by name.
 *
 * The two are told apart the way an author would tell them apart: a module is a file, so it has a
 * path in it — a directory separator, a dot-relative prefix, a `.mjs`/`.js`/`.ts` extension, or a
 * URL. `midnight` is a name; `theme/kineglyph.mjs` is a file. A name is resolved by Kineglyph's
 * `themeByName`, which reserves `inherit` and answers `undefined` for anything it does not know —
 * and `undefined` means inherit, which is the right answer for a typo as well as for a decision.
 */
export const isKineglyphThemeModule = (theme: string): boolean =>
  theme !== THEME_INHERIT && (/[/\\]/.test(theme) || /^\.{1,2}$|^\.{1,2}[/\\]/.test(theme) || /\.(?:mjs|cjs|js|ts)$/i.test(theme) || /^[a-z][a-z0-9+.-]*:/i.test(theme));

/**
 * Where the article's Kineglyph theme module is served from, or `undefined` when it ships none.
 *
 * One function rather than one expression per consumer, because the consumers have to agree: the
 * page shell puts this URL on `<html data-kg-theme>`, and the editor's preview loads the same
 * module so that a figure being edited is painted in the colours it will be published in. They
 * disagreed once — the preview simply had no theme — and a figure that changes colour between the
 * editor and the page is a bug a reader sees before its author does.
 *
 * `inherit`, and any other bare *name*, has no module to fetch: it is resolved by name inside the
 * runtime, so there is nothing for the page to load.
 */
export const kineglyphThemeHref = (article: { readonly kineglyph?: { readonly theme?: string } | undefined }, base: string): string | undefined => {
  const theme = article.kineglyph?.theme;
  if (theme === undefined || !isKineglyphThemeModule(theme)) return undefined;
  // A theme that already names where it lives — an absolute URL, a scheme, a root-relative path —
  // is not a file inside the article, and prefixing the site base would break it.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(theme)) return theme;
  return `${base.replace(/\/$/, "")}/${theme}`;
};

/**
 * `kineglyph.widths`, checked.
 *
 * Every width is a full copy of every figure in the page it appears on, so the cap is not a
 * formality: eight variants of a six-figure page is a megabyte of SVG to save a reader one pinch.
 * Five leaves room above the four defaults and is still bounded.
 */
const MAX_FIGURE_WIDTHS = 5;

function figureWidths(value: unknown): readonly number[] {
  if (!Array.isArray(value)) fail("kineglyph.widths", "must be a list of pixel widths");
  const widths = (value as unknown[]).map((w, i) => {
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0)
      fail(`kineglyph.widths[${i}]`, "must be a positive number of pixels");
    return w as number;
  });
  if (widths.length === 0) fail("kineglyph.widths", "must name at least one width");
  if (widths.length > MAX_FIGURE_WIDTHS)
    fail("kineglyph.widths", `must name at most ${MAX_FIGURE_WIDTHS} widths (each one is another copy of every figure)`);
  return [...new Set(widths)].sort((a, b) => b - a);
}

export function parseArticleConfig(text: string): ArticleConfig {
  const raw = parse(text) as unknown;
  if (raw === null || typeof raw !== "object") fail("(root)", "must be a mapping");
  const o = raw as Record<string, unknown>;
  const form = str(o.form ?? "docs", "form");
  if (form !== "docs") fail("form", `must be "docs" (got "${form}")`);
  const status = (o.status ?? "draft") as string;
  if (status !== "draft" && status !== "published") fail("status", "must be draft|published");
  const visibility = (o.visibility ?? "public") as string;
  if (!["public", "members", "authors"].includes(visibility)) fail("visibility", "must be public|members|authors");
  const snippets = (o.snippets ?? {}) as Record<string, unknown>;
  const roots = snippets.roots === undefined ? ["."] : (snippets.roots as unknown[]).map((r, i) => str(r, `snippets.roots[${i}]`));
  const kg = (o.kineglyph ?? undefined) as Record<string, unknown> | undefined;
  // A cover belongs to the article, so the default is its landing page and nowhere else. A typo
  // here is an error rather than a silent fallback: `cover_on: rooot` would otherwise hide the
  // header on every page and look exactly like the bug this option exists to fix.
  const coverOn = (o.cover_on ?? "root") as string;
  if (!COVER_ON.includes(coverOn as CoverOn)) fail("cover_on", `must be ${COVER_ON.join("|")} (got "${coverOn}")`);
  // `contain` by default, for the reason `CoverFit` gives: pagina never decodes the image, so it
  // cannot tell a photograph from a wordmark, and only one of the two answers is destructive.
  const coverFit = (o.cover_fit ?? "contain") as string;
  if (!COVER_FIT.includes(coverFit as CoverFit)) fail("cover_fit", `must be ${COVER_FIT.join("|")} (got "${coverFit}")`);
  // A misspelt key here does not fail a build, it publishes a folder — so `exclude` is validated
  // as a list of non-empty strings rather than coerced, and a scalar `exclude: notes` (which YAML
  // is happy to hand back as a string, and which would then be iterated character by character)
  // is refused rather than silently excluding `n`, `o`, `t`…
  if (o.exclude !== undefined && o.exclude !== null && !Array.isArray(o.exclude)) fail("exclude", "must be a list of glob patterns");
  const exclude = Array.isArray(o.exclude) ? o.exclude.map((p, i) => str(p, `exclude[${i}]`)) : [];
  if (o.exclude_gitignore !== undefined && o.exclude_gitignore !== null && typeof o.exclude_gitignore !== "boolean")
    fail("exclude_gitignore", "must be a boolean");
  const excludeGitignore = o.exclude_gitignore !== false;
  return {
    slug: str(o.slug, "slug"),
    title: str(o.title, "title"),
    form: "docs",
    status,
    visibility: visibility as ArticleConfig["visibility"],
    ...(o.category === undefined ? {} : { category: str(o.category, "category") }),
    tags: Array.isArray(o.tags) ? o.tags.map((t, i) => str(t, `tags[${i}]`)) : [],
    ...(o.theme === undefined ? {} : { theme: str(o.theme, "theme") }),
    ...optionalStr(o.cover, "cover"),
    // `cover_alt` in the file, `coverAlt` in the object — the same snake_case rule as `site_url`.
    ...(o.cover_alt === undefined || o.cover_alt === null ? {} : { coverAlt: str(o.cover_alt, "cover_alt") }),
    coverOn: coverOn as CoverOn,
    coverFit: coverFit as CoverFit,
    ...optionalStr(o.description, "description"),
    ...optionalStr(o.author, "author"),
    // `site_url` in the file, `siteUrl` in the object: YAML keys here are snake_case, and this is
    // the first one that is two words.
    ...(o.site_url === undefined || o.site_url === null ? {} : { siteUrl: str(o.site_url, "site_url") }),
    ...optionalDate(o.published, "published"),
    ...optionalDate(o.updated, "updated"),
    ...(kg === undefined ? {} : { kineglyph: { ...(kg.theme === undefined ? {} : { theme: str(kg.theme, "kineglyph.theme") }), ...(typeof kg.width === "number" ? { width: kg.width } : {}), ...(kg.widths === undefined ? {} : { widths: figureWidths(kg.widths) }) } }),
    snippets: { roots },
    exclude,
    excludeGitignore,
    nav: parseNav(o.nav ?? [], "nav"),
  };
}
