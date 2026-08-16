import type MarkdownIt from "markdown-it";
import type { ArticleConfig, ContentFs, Diagnostic, RenderedPage } from "./types.js";
import { createMarkdown, renderMarkdown } from "./markdown.js";
import { expandSnippets } from "./plugins/snippets.js";
import { extractFigures } from "./figures.js";
import { hrefOf, resolveRelative, rewriteLinks } from "./links.js";

export interface RenderPageOptions {
  readonly fs: ContentFs; readonly config: ArticleConfig; readonly path: string;
  readonly navPages: ReadonlySet<string>; readonly md?: MarkdownIt; readonly base?: string; readonly themes?: readonly string[];
}
export function pageSlug(href: string): string { return href === "/" ? "index" : href.replace(/^\/|\/$/g, "").replace(/\//g, "-"); }

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

export async function renderPage(o: RenderPageOptions): Promise<{ page: RenderedPage; diagnostics: Diagnostic[] }> {
  const base = o.base ?? "/";
  const themes = o.themes ?? ["light", "dark"];
  const md = o.md ?? createMarkdown();
  const source = (await o.fs.read(o.path)).replace(FRONT_MATTER, "");
  const snip = await expandSnippets(source, { fs: o.fs, roots: o.config.snippets.roots, pagePath: o.path });
  const rendered = renderMarkdown(md, snip.text);
  const href = hrefOf(o.path);
  const slug = pageSlug(href);
  const figs = extractFigures(rendered.html, { pageSlug: slug, themes, staticBaseUrl: (id) => `${base.replace(/\/$/, "")}/_pagina/figures/${slug}/${id}` });
  const linked = rewriteLinks(figs.html, { pagePath: o.path, navPages: o.navPages, assetPrefix: base, base });
  // data-scene attributes were rewritten too; refresh figure refs so scene URLs are site-absolute
  const figures = figs.figures.map((f) => f.kind === "module" && f.scene !== undefined && !f.scene.startsWith("/") && !/^[a-z]+:/i.test(f.scene)
    ? { ...f, scene: `${base.replace(/\/$/, "")}/${resolveRelative(o.path, f.scene)}` } : f);
  return {
    page: { path: o.path, href, title: rendered.title || o.path, html: linked.html, headings: rendered.headings, figures, links: linked.links },
    diagnostics: [...snip.diagnostics, ...linked.diagnostics],
  };
}
