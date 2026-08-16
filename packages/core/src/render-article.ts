import type MarkdownIt from "markdown-it";
import type { ContentFs, Diagnostic, Manifest, NavEntry, NavNode, PageMeta, RenderedArticle, RenderedPage } from "./types.js";
import { parseArticleConfig } from "./config.js";
import { renderPage, pageSlug } from "./render-page.js";
import { hrefOf } from "./links.js";

export class PaginaBuildError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(`pagina: ${diagnostics.filter((d) => d.severity === "error").length} error(s)\n${diagnostics.map((d) => `- [${d.code}] ${d.page ?? ""}: ${d.message}`).join("\n")}`);
  }
}
export interface RenderArticleOptions { readonly fs: ContentFs; readonly strict?: boolean; readonly base?: string; readonly md?: MarkdownIt; readonly themes?: readonly string[] }

interface Flat { readonly page: string; readonly title: string; readonly crumbs: readonly { title: string; href?: string }[] }
function flatten(entries: readonly NavEntry[], crumbs: readonly { title: string }[] = []): Flat[] {
  return entries.flatMap((e) => "section" in e ? flatten(e.children, [...crumbs, { title: e.section }]) : [{ page: e.page, title: e.title, crumbs: [...crumbs, { title: e.title, href: hrefOf(e.page) }] }]);
}
function toNav(entries: readonly NavEntry[]): NavNode[] {
  return entries.map((e) => "section" in e ? { title: e.section, children: toNav(e.children) } : { title: e.title, href: hrefOf(e.page) });
}

export async function renderArticle(o: RenderArticleOptions): Promise<RenderedArticle> {
  const strict = o.strict ?? true;
  const config = parseArticleConfig(await o.fs.read("article.yaml"));
  const diagnostics: Diagnostic[] = [];
  const flat = flatten(config.nav);
  const present: Flat[] = [];
  for (const f of flat) {
    if (await o.fs.exists(f.page)) present.push(f);
    else diagnostics.push({ severity: "error", code: "nav-missing-file", message: `nav references ${f.page}, which does not exist`, page: f.page });
  }
  const navPages = new Set(present.map((f) => f.page));
  const pages: Record<string, RenderedPage> = {};
  for (const f of present) {
    const r = await renderPage({ fs: o.fs, config, path: f.page, navPages, ...(o.md === undefined ? {} : { md: o.md }), ...(o.base === undefined ? {} : { base: o.base }), ...(o.themes === undefined ? {} : { themes: o.themes }) });
    pages[r.page.href] = r.page;
    diagnostics.push(...r.diagnostics);
  }
  // anchors
  const base = (o.base ?? "/").replace(/\/$/, "");
  for (const p of Object.values(pages))
    for (const l of p.links) {
      if (l.resolved === undefined) continue;
      if (l.resolved.startsWith("#")) {
        const frag = l.resolved.slice(1);
        if (!p.headings.some((h) => h.id === frag))
          diagnostics.push({ severity: "error", code: "anchor-missing", message: `${l.raw}: no heading #${frag} in ${p.path}`, page: p.path });
        continue;
      }
      if (!l.resolved.includes("#")) continue;
      const [target, frag] = l.resolved.split("#") as [string, string];
      const rel = target.startsWith(base) ? target.slice(base.length) || "/" : target;
      const tp = pages[rel];
      if (tp !== undefined && !tp.headings.some((h) => h.id === frag))
        diagnostics.push({ severity: "error", code: "anchor-missing", message: `${l.raw}: no heading #${frag} in ${tp.path}`, page: p.path });
    }
  const metas: Record<string, PageMeta> = {};
  present.forEach((f, i) => {
    const href = hrefOf(f.page);
    const p = pages[href]!;
    metas[href] = { title: p.title, headings: p.headings, breadcrumbs: f.crumbs, ...(i > 0 ? { prev: hrefOf(present[i - 1]!.page) } : {}), ...(i < present.length - 1 ? { next: hrefOf(present[i + 1]!.page) } : {}) };
  });
  const figures: Manifest["figures"] = Object.fromEntries(Object.values(pages).flatMap((p) => p.figures.map((f) => [f.id, { page: p.href, kind: f.kind, ...(f.scene === undefined ? {} : { scene: f.scene }), staticBase: `${base}/_pagina/figures/${pageSlug(p.href)}/${f.id}` }])));
  const assets = (await o.fs.list(".")).filter((f) => !/\.md$/i.test(f) && f !== "article.yaml");
  const article: Omit<typeof config, "nav" | "snippets"> = {
    slug: config.slug, title: config.title, form: config.form, status: config.status, visibility: config.visibility, tags: config.tags,
    ...(config.category === undefined ? {} : { category: config.category }),
    ...(config.theme === undefined ? {} : { theme: config.theme }),
    ...(config.kineglyph === undefined ? {} : { kineglyph: config.kineglyph }),
  };
  const manifest: Manifest = { article, nav: toNav(config.nav), pages: metas, figures, assets };
  if (strict && diagnostics.some((d) => d.severity === "error")) throw new PaginaBuildError(diagnostics);
  return { manifest, pages, diagnostics };
}
