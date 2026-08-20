import type MarkdownIt from "markdown-it";
import type { ArticleMeta, ContentFs, Diagnostic, Manifest, NavEntry, NavNode, PageMeta, RenderedArticle, RenderedPage } from "./types.js";
import { parseArticleConfig, THEME_INHERIT } from "./config.js";
import { articleExcluder } from "./exclude.js";
import { renderPage, pageSlug } from "./render-page.js";
import { hrefOf, resolveRelative } from "./links.js";
import { truncateWords } from "./seo.js";
import { BLOG_INDEX_PAGE, byNewest, postListHtml, type PostRef } from "./blog.js";
import { dateStamp } from "./dates.js";

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

/**
 * One level of the theme cascade, turned into the URL a page can actually link.
 *
 * Every level writes the same `--pg-*` tokens, so every level is the same kind of thing: a
 * stylesheet. That is what keeps this a resolution rule rather than a feature — the article's
 * `theme:` and a page's `theme:` are resolved by one function against the file each was written
 * in, exactly as their `cover:` is.
 *
 * `inherit` resolves to nothing, which is also what omitting the key does. It is accepted so that
 * "follow the level above" can be written down: a page in a folder of dark pages that wants the
 * article's ordinary theme has to be able to say so, and deleting a key does not say anything.
 *
 * A theme that does not exist is an **error**, for the same reason a missing cover is: a page that
 * silently links nothing looks exactly like a page whose theme did not apply, and the difference is
 * a build log nobody reads. The value is dropped as well as reported, so a non-strict build links
 * one fewer sheet rather than a dead one.
 */
async function resolveTheme(
  theme: string | undefined,
  from: string,
  fs: ContentFs,
  base: string,
  where: string,
  diagnostics: Diagnostic[],
  page?: string,
): Promise<string | undefined> {
  if (theme === undefined || theme === THEME_INHERIT) return undefined;
  if (ABSOLUTE.test(theme)) return theme;
  if (theme.startsWith("/")) return theme;
  const path = from === "" ? theme.replace(/^\.\//, "") : resolveRelative(from, theme);
  if (!(await fs.exists(path))) {
    diagnostics.push({
      severity: "error",
      code: "theme-missing",
      message: `${where}: theme "${theme}" resolves to ${path}, which does not exist`,
      ...(page === undefined ? {} : { page }),
    });
    return undefined;
  }
  return `${base.replace(/\/$/, "")}/${path}`;
}

export async function renderArticle(o: RenderArticleOptions): Promise<RenderedArticle> {
  const strict = o.strict ?? true;
  const config = parseArticleConfig(await o.fs.read("article.yaml"));
  const isBlog = config.form === "blog";
  const diagnostics: Diagnostic[] = [];
  // Hoisted: a blog asks this the same question the asset sweep does at the bottom of this
  // function, and a `.md` file the folder excludes must not become a post either.
  const excluded = articleExcluder(config.exclude, o.exclude ?? []);
  const flat = flatten(config.nav);
  const present: Flat[] = [];
  for (const f of flat) {
    if (await o.fs.exists(f.page)) present.push(f);
    else diagnostics.push({ severity: "error", code: "nav-missing-file", message: `nav references ${f.page}, which does not exist`, page: f.page });
  }
  /**
   * A blog's pages come from the **folder**, not from `nav`.
   *
   * That inversion is the whole of the form. On a docs site `nav` is what makes a markdown file a
   * page, and a file nobody listed is a file nobody meant to publish. On a blog the opposite is
   * true: writing a post *is* the act of publishing it, and having to add a line to `article.yaml`
   * afterwards is the step that gets forgotten. So every `.md` in the folder is a post, except the
   * index and except the pages `nav` names — which on a blog means the standalone ones (about,
   * colophon), the pages that are not posts and never appear in the archive.
   */
  const navNamed = new Set(flat.map((f) => f.page));
  const postPaths: string[] = [];
  let hasIndex = false;
  if (isBlog) {
    const found = (await o.fs.list(".")).filter((p) => /\.md$/i.test(p) && !excluded(p)).sort();
    hasIndex = found.includes(BLOG_INDEX_PAGE);
    for (const p of found) if (p !== BLOG_INDEX_PAGE && !navNamed.has(p)) postPaths.push(p);
    if (!hasIndex)
      diagnostics.push({
        severity: "error",
        code: "blog-no-index",
        message: `a blog needs an index.md: it is the page served at "/", and the list of posts is appended to whatever you write there. Create index.md with the blog's title and opening words — an empty file works too.`,
      });
  }
  // Source order for rendering; the index's list and the pager are re-sorted by date below.
  const ordered = [...(hasIndex ? [BLOG_INDEX_PAGE] : []), ...present.map((f) => f.page), ...postPaths];
  // Every page of the article, so a link from one post to another is rewritten as a page link
  // rather than left pointing at a `.md` file. On a docs site this is `nav`; on a blog `nav` names
  // a fraction of the pages, and using it here would break exactly the links posts make to posts.
  const navPages = new Set(ordered);
  const pages: Record<string, RenderedPage> = {};
  for (const path of ordered) {
    const r = await renderPage({ fs: o.fs, config, path, navPages, ...(o.md === undefined ? {} : { md: o.md }), ...(o.base === undefined ? {} : { base: o.base }) });
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
  const articleTheme = await resolveTheme(config.theme, "", o.fs, base, "article.yaml", diagnostics);
  const draft = config.status !== "published";

  // Breadcrumbs come from `nav`, which is where an article's shape is written down. A blog post is
  // in no nav, so its trail is the post itself — one crumb, which is the honest depth of a blog.
  const crumbsOf = new Map(present.map((f) => [f.page, f.crumbs] as const));

  /**
   * The pager, decided before the metas are assembled — and it points the opposite way on a blog.
   *
   * In docs, `prev`/`next` are positions in `nav`: the previous and the next thing to read, which
   * is a sequence a person chose. On a blog there is no such sequence, only a chronology, so the
   * arrows mean **newer** and **older** — and they run down the index, so `prev` is the entry above
   * this one (newer) and `next` is the entry below it (older). The shell relabels them; nothing
   * else has to know, because `rel="prev"`/`rel="next"` still describe the order the pages are
   * presented in, which is what those tokens mean.
   *
   * The index page and the standalone pages get no pager at all. An "older post" link on the
   * colophon is a link to a sequence the page is not part of.
   */
  const pager = new Map<string, { readonly prev?: string; readonly next?: string }>();
  const postOrder: string[] = [];
  if (isBlog) {
    const dated: { path: string; href: string; date: string }[] = [];
    for (const path of postPaths) {
      const href = hrefOf(path);
      const fm = pages[href]!.frontMatter;
      if (fm.draft === true) continue;
      if (fm.date === undefined) {
        // Not a warning. A post with no date is absent from the index, absent from the feed and
        // absent from the sitemap, so it is a post nobody can find — the exact failure the blog
        // form exists to prevent, and one that is invisible from the built site. Three ways out,
        // because the file is one of three things and only the author knows which.
        diagnostics.push({
          severity: "error",
          code: "blog-post-no-date",
          message: `${path} has no \`date\`, so nothing can place it: it would be left out of the index, the feed and the sitemap. Add \`date: 2026-08-20\` to its front matter — or \`draft: true\` while it is unfinished, or list it under \`nav\` in article.yaml if it is a standalone page rather than a post.`,
          page: path,
        });
        continue;
      }
      if (dateStamp(fm.date) === Number.NEGATIVE_INFINITY)
        diagnostics.push({
          severity: "warning",
          code: "blog-date-unreadable",
          message: `${path} has \`date: ${fm.date}\`, which is not a date pagina can order by, so this post sorts last and is left out of the feed. Write it as \`2026-08-20\`.`,
          page: path,
        });
      dated.push({ path, href, date: fm.date });
    }
    const sorted = byNewest(dated);
    postOrder.push(...sorted.map((d) => d.href));
    for (const [i, d] of sorted.entries())
      pager.set(d.path, {
        ...(i > 0 ? { prev: sorted[i - 1]!.href } : {}),
        ...(i < sorted.length - 1 ? { next: sorted[i + 1]!.href } : {}),
      });
  } else {
    for (const [i, f] of present.entries())
      pager.set(f.page, {
        ...(i > 0 ? { prev: hrefOf(present[i - 1]!.page) } : {}),
        ...(i < present.length - 1 ? { next: hrefOf(present[i + 1]!.page) } : {}),
      });
  }

  const metas: Record<string, PageMeta> = {};
  for (const path of ordered) {
    const href = hrefOf(path);
    const p = pages[href]!;
    const fm = p.frontMatter;
    const f = { page: path, crumbs: crumbsOf.get(path) ?? [{ title: p.title, href }] };
    // The description chain, run once here so that every consumer — pagina's shell, a Laravel
    // host reading manifest.json — reaches the same answer without re-deriving it.
    //
    // The page's own opening line outranks `article.yaml`'s description, which reads backwards
    // until you look at what the other order produces: every page that wrote no description of
    // its own gets the article's, so a ten-page article ships ten identical meta descriptions and
    // ten identical cards. One sentence about the whole project is true of every page and useful
    // on none of them, while the page's first paragraph is at least about the page. An author who
    // wants the article's line on a page can still write it there.
    const description = fm.description ?? p.excerpt ?? config.description;
    // The page's own cover and the page's own alt text travel together: a page that overrides the
    // image but not the description would otherwise be labelled with the article cover's alt.
    const own = await resolveCover(fm.cover, f.page, o.fs, base, f.page, diagnostics, f.page);
    // On a **blog** the article cover is the blog's banner, and a banner reprinted at the top of
    // every post is the magazine-front-page problem `cover_on` already solved for docs — except
    // that a blog wants `cover_on: all`, so suppressing the header is not the lever here. The lever
    // is inheritance: a post shows its own picture or none, and the banner stays on the index where
    // it belongs. `og:image` still falls back to it (see `seo.ts`), because a post shared with no
    // artwork at all is worse than one shared with the blog's.
    const cover = own ?? (isBlog && path !== BLOG_INDEX_PAGE ? undefined : articleCover);
    // Never empty and never the filename: an author's words if there are any, else the article
    // title, which is at least true about what the image is introducing.
    const coverAlt = (own === undefined ? undefined : fm.coverAlt) ?? config.coverAlt ?? config.title;
    // How the cover is fitted follows the same rule as every other overridable field, and *not*
    // the image: a page that supplies its own photograph but not its own `cover_fit` gets the
    // article's answer, because that is the article's house style rather than a fact about a file.
    const coverFit = fm.coverFit ?? config.coverFit;
    // Level 4. Resolved against the page, the way the page's `cover:` is. The article's sheet is
    // *not* folded in here: both are linked, article first, so a page that redefines one token
    // keeps the article's answer for the rest. That is what "inheriting when silent" means one
    // level down, and it is the reason this is a second field rather than a replacement.
    const theme = await resolveTheme(fm.theme, f.page, o.fs, base, f.page, diagnostics, f.page);
    const author = fm.author ?? config.author;
    // A post's `date` *is* its publication date, so it fills `published` — which is what
    // `article:published_time`, the JSON-LD and the article header all already read. What it must
    // not do is inherit the article's, which is why the two stay separate fields: see
    // `PageFrontMatter.date`.
    const published = fm.published ?? fm.date ?? config.published;
    const updated = fm.updated ?? config.updated;
    const tags = fm.tags ?? config.tags;
    // A draft is a page a crawler must not index, for the same reason a draft article's pages are:
    // it is readable so it can be reviewed, not so it can be found.
    const isDraftPost = fm.draft === true;
    const noindex = fm.noindex === true || draft || isDraftPost;
    metas[href] = {
      title: p.title, headings: p.headings, breadcrumbs: f.crumbs,
      ...pager.get(path),
      ...(description === undefined ? {} : { description: truncateWords(description) }),
      ...(cover === undefined ? {} : { cover, coverAlt, ...(coverFit === undefined ? {} : { coverFit }) }),
      ...(theme === undefined ? {} : { theme }),
      ...(author === undefined ? {} : { author }),
      ...(p.readingMinutes === undefined ? {} : { readingMinutes: p.readingMinutes }),
      ...(published === undefined ? {} : { published }),
      ...(updated === undefined ? {} : { updated }),
      ...(fm.date === undefined ? {} : { date: fm.date }),
      ...(isDraftPost ? { draft: true } : {}),
      ...(tags.length === 0 ? {} : { tags }),
      ...(noindex ? { noindex: true } : {}),
    };
  }
  /**
   * The blog's archive, written onto the index page.
   *
   * Appended to what the author wrote rather than replacing it, and appended *after* the metas are
   * final because the list is made of them — every title, date, description, cover and reading time
   * in it is the same value the post's own page will use, resolved once. A list assembled from a
   * second pass over the pages is a list that can disagree with them.
   *
   * It goes on the page's `html` and not into its `headings` or `readingMinutes`, which were taken
   * before this ran: a table of contents listing every post is not a table of this page's contents,
   * and a list of links is not prose to be timed.
   */
  if (isBlog && hasIndex) {
    const posts: PostRef[] = postOrder.map((href) => ({ href, path: href, meta: metas[href]! }));
    const index = pages["/"]!;
    pages["/"] = { ...index, html: index.html + postListHtml(posts, base) };
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
  const assets = (await o.fs.list(".")).filter((f) => !/\.md$/i.test(f) && f !== "article.yaml" && !excluded(f));
  // The landing page is the first page in nav order — the one a reader arrives at, and the one
  // `coverOn: "root"` names. Emitted so no consumer has to re-walk `nav` to find it. A blog's is
  // always `/`: its `nav` is a list of standalone pages, and the page a reader arrives at is the
  // index, which is not in it.
  const rootHref = isBlog || present.length === 0 ? "/" : hrefOf(present[0]!.page);
  // The whole article's reading time is the sum of the pages', not a recount of the concatenation:
  // a card that says "12 min" and a page list whose numbers add to 11 is a card nobody trusts.
  const totalMinutes = Object.values(metas).reduce((n, m) => n + (m.readingMinutes ?? 0), 0);
  const article: ArticleMeta = {
    slug: config.slug, title: config.title, form: config.form, status: config.status, visibility: config.visibility, tags: config.tags,
    rootHref, coverOn: config.coverOn,
    ...(totalMinutes === 0 ? {} : { readingMinutes: totalMinutes }),
    ...(config.category === undefined ? {} : { category: config.category }),
    ...(articleTheme === undefined ? {} : { theme: articleTheme }),
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
  const manifest: Manifest = {
    article, nav: toNav(config.nav),
    ...(isBlog ? { posts: postOrder } : {}),
    pages: metas, figures, assets,
  };
  if (strict && diagnostics.some((d) => d.severity === "error")) throw new PaginaBuildError(diagnostics);
  return { manifest, pages, diagnostics };
}
