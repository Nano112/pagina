import type MarkdownIt from "markdown-it";
import type { ArticleMeta, ContentFs, Diagnostic, Manifest, NavEntry, NavNode, PageMeta, RenderedArticle, RenderedPage } from "./types.js";
import { parseArticleConfig } from "./config.js";
import { articleExcluder } from "./exclude.js";
import { renderPage, pageSlug } from "./render-page.js";
import { hrefOf, resolveRelative } from "./links.js";
import { truncateWords } from "./seo.js";

export class PaginaBuildError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(`pagina: ${diagnostics.filter((d) => d.severity === "error").length} error(s)\n${diagnostics.map((d) => `- [${d.code}] ${d.page ?? ""}: ${d.message}`).join("\n")}`);
  }
}
export interface RenderArticleOptions {
  readonly fs: ContentFs; readonly strict?: boolean; readonly base?: string; readonly md?: MarkdownIt;
  /** Overrides `article.yaml`'s `site_url` — a folder that several hosts publish needs one origin
   *  per host, and the folder cannot know them. */
  readonly siteUrl?: string;
  /**
   * Extra exclusion patterns, appended to {@link DEFAULT_EXCLUDE} and `article.yaml`'s `exclude`.
   *
   * For the exclusions the folder cannot state itself: `@pagina/vite` passes the paths git says
   * are ignored, which is a fact about the checkout rather than about the article. Kept as an
   * option instead of read here so core stays filesystem-agnostic — the editor's in-memory store
   * and a bundle's reader have no git to ask.
   */
  readonly exclude?: readonly string[];
}

interface Flat { readonly page: string; readonly title: string; readonly crumbs: readonly { title: string; href?: string }[] }
function flatten(entries: readonly NavEntry[], crumbs: readonly { title: string }[] = []): Flat[] {
  return entries.flatMap((e) => "section" in e ? flatten(e.children, [...crumbs, { title: e.section }]) : [{ page: e.page, title: e.title, crumbs: [...crumbs, { title: e.title, href: hrefOf(e.page) }] }]);
}
function toNav(entries: readonly NavEntry[]): NavNode[] {
  return entries.map((e) => "section" in e ? { title: e.section, children: toNav(e.children) } : { title: e.title, href: hrefOf(e.page) });
}

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * A cover image, as written by an author, turned into the URL a page can actually load.
 *
 * `from` is the file the path was written in, so `article.yaml`'s cover resolves against the
 * folder and a page's front-matter cover resolves against that page — the same rule every
 * relative path in a page already follows, and the only one an author can predict.
 *
 * A cover that does not exist is an **error**, not a shrug: an empty `og:image` costs a link
 * preview and a broken one costs more, and both are invisible until someone shares the page. The
 * value is dropped as well as reported, so a non-strict build emits no tag rather than a dead URL.
 */
async function resolveCover(
  cover: string | undefined,
  from: string,
  fs: ContentFs,
  base: string,
  where: string,
  diagnostics: Diagnostic[],
  page?: string,
): Promise<string | undefined> {
  if (cover === undefined) return undefined;
  if (ABSOLUTE.test(cover)) return cover;                  // the author gave a URL; not ours to check
  if (cover.startsWith("/")) return cover;                 // already site-absolute
  const path = from === "" ? cover.replace(/^\.\//, "") : resolveRelative(from, cover);
  if (!(await fs.exists(path))) {
    diagnostics.push({
      severity: "error",
      code: "cover-missing",
      message: `${where}: cover "${cover}" resolves to ${path}, which does not exist`,
      ...(page === undefined ? {} : { page }),
    });
    return undefined;
  }
  return `${base.replace(/\/$/, "")}/${path}`;
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
    const r = await renderPage({ fs: o.fs, config, path: f.page, navPages, ...(o.md === undefined ? {} : { md: o.md }), ...(o.base === undefined ? {} : { base: o.base }) });
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
  // Article-level metadata first: it is the fallback every page's own metadata is layered over.
  const articleCover = await resolveCover(config.cover, "", o.fs, base, "article.yaml", diagnostics);
  const draft = config.status !== "published";

  const metas: Record<string, PageMeta> = {};
  for (const [i, f] of present.entries()) {
    const href = hrefOf(f.page);
    const p = pages[href]!;
    const fm = p.frontMatter;
    // The description chain, run once here so that every consumer — pagina's shell, a Laravel
    // host reading manifest.json — reaches the same answer without re-deriving it.
    const description = fm.description ?? config.description ?? p.excerpt;
    // The page's own cover and the page's own alt text travel together: a page that overrides the
    // image but not the description would otherwise be labelled with the article cover's alt.
    const own = await resolveCover(fm.cover, f.page, o.fs, base, f.page, diagnostics, f.page);
    const cover = own ?? articleCover;
    // Never empty and never the filename: an author's words if there are any, else the article
    // title, which is at least true about what the image is introducing.
    const coverAlt = (own === undefined ? undefined : fm.coverAlt) ?? config.coverAlt ?? config.title;
    // How the cover is fitted follows the same rule as every other overridable field, and *not*
    // the image: a page that supplies its own photograph but not its own `cover_fit` gets the
    // article's answer, because that is the article's house style rather than a fact about a file.
    const coverFit = fm.coverFit ?? config.coverFit;
    const author = fm.author ?? config.author;
    const published = fm.published ?? config.published;
    const updated = fm.updated ?? config.updated;
    const tags = fm.tags ?? config.tags;
    const noindex = fm.noindex === true || draft;
    metas[href] = {
      title: p.title, headings: p.headings, breadcrumbs: f.crumbs,
      ...(i > 0 ? { prev: hrefOf(present[i - 1]!.page) } : {}),
      ...(i < present.length - 1 ? { next: hrefOf(present[i + 1]!.page) } : {}),
      ...(description === undefined ? {} : { description: truncateWords(description) }),
      ...(cover === undefined ? {} : { cover, coverAlt, ...(coverFit === undefined ? {} : { coverFit }) }),
      ...(author === undefined ? {} : { author }),
      ...(p.readingMinutes === undefined ? {} : { readingMinutes: p.readingMinutes }),
      ...(published === undefined ? {} : { published }),
      ...(updated === undefined ? {} : { updated }),
      ...(tags.length === 0 ? {} : { tags }),
      ...(noindex ? { noindex: true } : {}),
    };
  }
  // Figure ids key the manifest and name the pre-rendered SVGs, so two pages claiming the same
  // id would silently overwrite each other's figures.
  const seen = new Map<string, string>();
  for (const p of Object.values(pages))
    for (const f of p.figures) {
      const owner = seen.get(f.id);
      if (owner === undefined) seen.set(f.id, p.path);
      else diagnostics.push({ severity: "error", code: "figure-id-collision", message: `figure id "${f.id}" is used by both ${owner} and ${p.path}`, page: p.path });
    }
  const figures: Manifest["figures"] = Object.fromEntries(Object.values(pages).flatMap((p) => p.figures.map((f) => [f.id, { page: p.href, kind: f.kind, ...(f.scene === undefined ? {} : { scene: f.scene }), staticBase: `${base}/_pagina/figures/${pageSlug(p.href)}/${f.id}` }])));
  // What gets copied into the output — which is to say, what gets published. The rule used to be
  // "everything that is not a page", which publishes whatever happens to be sitting in the folder.
  const excluded = articleExcluder(config.exclude, o.exclude ?? []);
  const assets = (await o.fs.list(".")).filter((f) => !/\.md$/i.test(f) && f !== "article.yaml" && !excluded(f));
  // The landing page is the first page in nav order — the one a reader arrives at, and the one
  // `coverOn: "root"` names. Emitted so no consumer has to re-walk `nav` to find it.
  const rootHref = present.length === 0 ? "/" : hrefOf(present[0]!.page);
  // The whole article's reading time is the sum of the pages', not a recount of the concatenation:
  // a card that says "12 min" and a page list whose numbers add to 11 is a card nobody trusts.
  const totalMinutes = Object.values(metas).reduce((n, m) => n + (m.readingMinutes ?? 0), 0);
  const article: ArticleMeta = {
    slug: config.slug, title: config.title, form: config.form, status: config.status, visibility: config.visibility, tags: config.tags,
    rootHref, coverOn: config.coverOn,
    ...(totalMinutes === 0 ? {} : { readingMinutes: totalMinutes }),
    ...(config.category === undefined ? {} : { category: config.category }),
    ...(config.theme === undefined ? {} : { theme: config.theme }),
    ...(config.coverFit === undefined ? {} : { coverFit: config.coverFit }),
    ...(articleCover === undefined ? {} : { cover: articleCover }),
    ...(config.coverAlt === undefined ? {} : { coverAlt: config.coverAlt }),
    ...(config.description === undefined ? {} : { description: config.description }),
    ...(config.author === undefined ? {} : { author: config.author }),
    ...((o.siteUrl ?? config.siteUrl) === undefined ? {} : { siteUrl: o.siteUrl ?? config.siteUrl }),
    ...(config.published === undefined ? {} : { published: config.published }),
    ...(config.updated === undefined ? {} : { updated: config.updated }),
    ...(config.kineglyph === undefined ? {} : { kineglyph: config.kineglyph }),
  };
  const manifest: Manifest = { article, nav: toNav(config.nav), pages: metas, figures, assets };
  if (strict && diagnostics.some((d) => d.severity === "error")) throw new PaginaBuildError(diagnostics);
  return { manifest, pages, diagnostics };
}
