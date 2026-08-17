import type MarkdownIt from "markdown-it";
import type { ArticleConfig, ContentFs, Diagnostic, RenderedPage } from "./types.js";
import { createMarkdown, renderMarkdown } from "./markdown.js";
import { expandSnippets } from "./plugins/snippets.js";
import { extractFigures } from "./figures.js";
import { hrefOf, resolveRelative, rewriteLinks } from "./links.js";
import { parseFrontMatter } from "./front-matter.js";
import { firstParagraph } from "./seo.js";
import { readingMinutes } from "./reading-time.js";

export interface RenderPageOptions {
  readonly fs: ContentFs; readonly config: ArticleConfig; readonly path: string;
  readonly navPages: ReadonlySet<string>; readonly md?: MarkdownIt; readonly base?: string; readonly themes?: readonly string[];
}
export function pageSlug(href: string): string { return href === "/" ? "index" : href.replace(/^\/|\/$/g, "").replace(/\//g, "-"); }

export async function renderPage(o: RenderPageOptions): Promise<{ page: RenderedPage; diagnostics: Diagnostic[] }> {
  const base = o.base ?? "/";
  const themes = o.themes ?? ["light", "dark"];
  const md = o.md ?? createMarkdown();
  // Front matter is read, never rewritten: the block is stripped from the body before parsing and
  // the values are carried on `page.frontMatter`, where `renderArticle` applies them over the
  // article's own metadata.
  const front = parseFrontMatter(await o.fs.read(o.path), o.path);
  const snip = await expandSnippets(front.body, { fs: o.fs, roots: o.config.snippets.roots, pagePath: o.path });
  const rendered = renderMarkdown(md, snip.text);
  const href = hrefOf(o.path);
  const slug = pageSlug(href);
  const figs = extractFigures(rendered.html, { pageSlug: slug, themes, staticBaseUrl: (id) => `${base.replace(/\/$/, "")}/_pagina/figures/${slug}/${id}` });
  const linked = rewriteLinks(figs.html, { pagePath: o.path, navPages: o.navPages, assetPrefix: base, base });
  // data-scene attributes were rewritten too; refresh figure refs so scene URLs are site-absolute
  const figures = figs.figures.map((f) => f.kind === "module" && f.scene !== undefined && !f.scene.startsWith("/") && !/^[a-z]+:/i.test(f.scene)
    ? { ...f, scene: `${base.replace(/\/$/, "")}/${resolveRelative(o.path, f.scene)}` } : f);
  const excerpt = firstParagraph(rendered.html);
  // Counted on `rendered.html` — before figures became `<picture>` elements and before links were
  // rewritten — because none of that changes a word of prose, and the earlier the count runs the
  // fewer generated attributes there are for a tag-stripper to trip over.
  const minutes = readingMinutes(rendered.html);
  return {
    page: {
      path: o.path, href, title: front.meta.title ?? (rendered.title || o.path), html: linked.html,
      headings: rendered.headings, figures, links: linked.links, frontMatter: front.meta,
      ...(excerpt === undefined ? {} : { excerpt }),
      ...(minutes === undefined ? {} : { readingMinutes: minutes }),
    },
    diagnostics: [...front.diagnostics, ...snip.diagnostics, ...figs.diagnostics.map((d) => ({ ...d, page: o.path })), ...linked.diagnostics],
  };
}
