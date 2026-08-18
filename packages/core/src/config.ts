import { parse } from "yaml";
import type { ArticleConfig, CoverOn, NavEntry } from "./types.js";

/** Every value `cover_on` may take, in the order the doc lists them. */
export const COVER_ON: readonly CoverOn[] = ["root", "all", "none"];

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
 * Where the article's Kineglyph theme module is served from, or `undefined` when it declares none.
 *
 * One function rather than one expression per consumer, because the consumers have to agree: the
 * page shell puts this URL on `<html data-kg-theme>`, and the editor's preview loads the same
 * module so that a figure being edited is painted in the colours it will be published in. They
 * disagreed once — the preview simply had no theme — and a figure that changes colour between the
 * editor and the page is a bug a reader sees before its author does.
 */
export const kineglyphThemeHref = (article: { readonly kineglyph?: { readonly theme?: string } | undefined }, base: string): string | undefined => {
  const theme = article.kineglyph?.theme;
  if (theme === undefined) return undefined;
  // A theme that already names where it lives — an absolute URL, a scheme, a root-relative path —
  // is not a file inside the article, and prefixing the site base would break it.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(theme)) return theme;
  return `${base.replace(/\/$/, "")}/${theme}`;
};

/** Kineglyph's own token-name convention: `surfaceRaised` → `surface-raised`. */
const cssName = (token: string): string => token.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9-]+/g, "-");

/**
 * An article theme's colours as the CSS custom properties a figure is actually painted from.
 *
 * A Kineglyph figure paints every fill as `var(--kg-color-<role>, <literal>)`: the literal comes
 * from the theme the figure was *drawn* with, and the variable — if the page defines one — wins.
 * That is Kineglyph's contract, and it is how a host retints a figure it did not draw. pagina takes
 * it up in `pagina.css`, where every `--kg-color-*` is pointed at the matching `--pg-*` token.
 *
 * Which means an article that declares its own theme module gets it applied to the *drawing* and
 * then overruled at *paint*: the served SVG says teal and the reader sees pagina's blue. The
 * declaration has to reach the page as variables too, or it does not really reach the page. This
 * turns a theme's `colors` into exactly those variables; the shell emits them after `pagina.css`
 * so that a declared theme outranks the default bridge, and an article that declares no theme is
 * untouched and still follows its host.
 */
export const kineglyphColorVars = (colors: Readonly<Record<string, string>> | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  // A theme module is the article's own code, and a runtime is something a host may substitute:
  // neither is required to hand back a palette, and "no variables" is the answer when it does not.
  if (colors === null || typeof colors !== "object") return out;
  for (const [token, value] of Object.entries(colors)) if (typeof value === "string") out[`--kg-color-${cssName(token)}`] = value;
  return out;
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
