import { parse } from "yaml";
import type { ArticleConfig, NavEntry } from "./types.js";

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
    ...optionalStr(o.description, "description"),
    ...optionalStr(o.author, "author"),
    // `site_url` in the file, `siteUrl` in the object: YAML keys here are snake_case, and this is
    // the first one that is two words.
    ...(o.site_url === undefined || o.site_url === null ? {} : { siteUrl: str(o.site_url, "site_url") }),
    ...optionalDate(o.published, "published"),
    ...optionalDate(o.updated, "updated"),
    ...(kg === undefined ? {} : { kineglyph: { ...(kg.theme === undefined ? {} : { theme: str(kg.theme, "kineglyph.theme") }), ...(typeof kg.width === "number" ? { width: kg.width } : {}) } }),
    snippets: { roots },
    nav: parseNav(o.nav ?? [], "nav"),
  };
}
