import { feedUrl, pageSeo, readableDate, renderSeoHtml, type NavNode, type PageMeta, type RenderedArticle, type ThemeLevel } from "@pagina/core";

/** Context a page render pass gets. The five required fields mirror `@pagina/core`'s
 * `ShellContext` exactly; `kineglyphThemeUrl` is computed by `staticShell` internally (see
 * `src/index.ts`) and is not part of the public `Shell.render` contract. */
export interface ShellCtx {
  base: string;
  dev: boolean;
  clientUrl: string;
  cssUrl: string;
  /** The tokens-only sheet, linked instead of `cssUrl` when `theme` is `"tokens"`. Omitted, it
   *  is derived from `cssUrl` (see {@link tokensUrl}). */
  tokensCssUrl?: string;
  /** How much pagina CSS to link: `"full"` (default), `"tokens"`, or `"none"`. */
  theme?: ThemeLevel;
  /** Render pagina's own header row. Default `true`; `false` for a host with its own chrome. */
  chrome?: boolean;
  kineglyphRuntimeUrl: string;
  kineglyphThemeUrl?: string;
  /** Name → module URL for `kineglyph.themes`, which a `<figure>`'s `data-theme` picks from. */
  kineglyphThemeUrls?: Readonly<Record<string, string>>;
  /** `pagina dev --edit`: add an "Edit this page" link into the editor. Never set in a build. */
  edit?: boolean;
  /** Overrides {@link DEFAULT_MODEL_VIEWER_URL} for pages that embed a `<model-viewer>`. */
  modelViewerUrl?: string;
  /** Absolute site origin, for canonical/`og:url`/`og:image`. Absent, those tags are omitted. */
  siteUrl?: string;
  /**
   * Site URL of the search index, e.g. `/_pagina/search.json`.
   *
   * Present, the header gets a search trigger and the client binds `/` and ⌘K. Absent, none of
   * that is rendered and the reading page is byte-for-byte what it was — search is a feature a
   * build opts into by having written an index, not a box that appears and answers nothing.
   */
  searchUrl?: string;
  /** Absolute URL of the deployment this build mirrors; canonical and `og:url` point there. */
  mirrorOf?: string;
}

/**
 * Google's `<model-viewer>` element.
 *
 * It is pulled in per page and only when a page actually contains one: the element is several
 * hundred kilobytes of WebGL, and a docs site with one 3-D model on one page must not pay for it on
 * every other. Kept in step with `@pagina/editor`'s default so the editor and the published page
 * run the same version.
 */
export const DEFAULT_MODEL_VIEWER_URL = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.3.1/model-viewer.min.js";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
/** Not public API: shared with `not-found.ts`, which is a page this shell renders too. */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);
/** A string inside a raw-text `<script>` element: HTML escapes are NOT decoded there, so the
 *  value must be JSON-escaped (not HTML-escaped) and only `</script` needs neutralising. */
const escInScriptJson = (s: string) => JSON.stringify(s).slice(1, -1).replace(/<\/script/gi, "<\\/script");
/** Not public API — see {@link esc}. */
export const withBase = (base: string, href: string) => `${base.replace(/\/$/, "")}${href}`;

/**
 * The theme, decided before the first paint.
 *
 * In `<head>` and blocking on purpose: it runs before the body exists, so a reader who chose dark
 * never sees a white flash of the default. The key is the one the client bundle writes, so the
 * toggle on any page — including the 404, which carries its own small toggle — agrees with this.
 */
export const THEME_INIT_SCRIPT = `<script>(function(){try{var t=localStorage.getItem("pagina-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){}})();</script>`;

/**
 * The full sheet's name, hashed or not, with the capture that says which — see {@link tokensUrl}.
 * Not public API: shared with `theming/index.ts`, which reads the same pair off a rendered page.
 */
export const PAGINA_CSS = /pagina(\.[0-9a-f]{8})?\.css(?=$|[?#])/;

/**
 * Where the tokens-only sheet lives. A builder that emits one says so explicitly; otherwise it
 * sits next to the full sheet under the name `bundleClient` gives it, which is the layout every
 * pagina build produces.
 *
 * The optional hash is carried across rather than dropped. A built site names its stylesheets
 * `pagina.<hash>.css` and `pagina.tokens.<hash>.css` — the *same* hash, because the full sheet
 * inlines the tokens sheet and so already changes whenever it does — which is exactly what makes
 * this one-line derivation keep working once the names carry content in them.
 */
const tokensUrl = (ctx: ShellCtx): string =>
  ctx.tokensCssUrl ?? ctx.cssUrl.replace(PAGINA_CSS, (_m, hash: string | undefined) => `pagina.tokens${hash ?? ""}.css`);

/** The `<link>` (if any) for pagina's own CSS at this theme level. Not public API — see {@link esc}. */
export function stylesheetHtml(ctx: ShellCtx): string {
  const theme = ctx.theme ?? "full";
  if (theme === "none") return "";
  return `<link rel="stylesheet" href="${esc(theme === "tokens" ? tokensUrl(ctx) : ctx.cssUrl)}">`;
}

/**
 * Levels 3 and 4 of the theme cascade: the article's stylesheet, then the page's.
 *
 * Both are ordinary CSS files writing `--pg-*`, which is what makes them compose — the page's
 * declarations win token by token and the article's stand for everything the page did not mention,
 * with no merging and nothing for pagina to resolve. They are linked **after** pagina's own sheet
 * and are unlayered, so they beat the defaults; a host that loads its own CSS after these still
 * outranks both, which is level 2 keeping its place at the top when it wants it.
 *
 * A page that declared `theme: inherit` — or nothing at all — contributes no link, so silence at
 * one level is literally one fewer element in the head.
 */
function cascadeStylesheetsHtml(article: RenderedArticle, href: string): string {
  const sheets = [article.manifest.article.theme, article.manifest.pages[href]?.theme]
    .filter((s): s is string => s !== undefined && s !== "");
  return sheets.map((s) => `\n<link rel="stylesheet" href="${esc(s)}">`).join("");
}

/**
 * The cover, as a band across the whole page.
 *
 * A cover is the first thing on the page and behaves like one: it is emitted *outside* the shell
 * grid, above the sidebar and the content column, so it spans the window rather than the measure.
 * Boxed inside the reading column it read as an illustration that happened to be first; across the
 * page it reads as the top of the article, which is what it is.
 *
 * **It does not crop by default.** No intrinsic size is known at build time — pagina copies the
 * file, it does not decode it — so it cannot tell a photograph (which may be cropped to a band
 * without losing anything) from a wordmark (where the first letters *are* the picture). Guessing
 * wrong in the cropping direction decapitates the image, and that is the failure a reader sees, so
 * the default is `contain`: the whole image, letterboxed in the band. An author whose cover is a
 * photograph says `cover_fit: cover` and gets an edge-to-edge band. `object-position` is left to
 * the host as `--pg-cover-position`, because which part of a photograph matters is a fact about
 * that photograph and not something worth a second key.
 *
 * The band's height comes from the aspect-ratio box `.pg-cover__img` declares, which is also what
 * holds the layout still while the image loads. On the landing page the cover is the LCP element
 * and must not be deferred; on a sub-page under `cover_on: "all"` it is one hero among many and
 * can wait its turn.
 */
function coverHtml(meta: PageMeta, article: RenderedArticle["manifest"]["article"], isRoot: boolean): string {
  if (meta.cover === undefined) return "";
  const alt = meta.coverAlt ?? article.title;      // never "", never the filename — see render-article.ts
  const fit = meta.coverFit ?? "contain";
  return `<figure class="pg-cover pg-cover--${fit}"><img class="pg-cover__img" src="${esc(meta.cover)}" alt="${esc(alt)}" loading="${isRoot ? "eager" : "lazy"}" decoding="async"></figure>`;
}

/**
 * The article header: the title, and the line of provenance under it.
 *
 * **A cover belongs to the article, not to each page.** A reference page three levels into an API
 * doc re-displaying the hero is a magazine reprinting its front page on every spread, so the
 * header renders on the article's landing page and nowhere else unless the author says otherwise
 * with `cover_on` (`"root"` by default, `"all"`, or `"none"`). The cover itself is
 * {@link coverHtml}, emitted above the shell; what is left here is the part that belongs in the
 * reading column, so the meta row stays aligned to the prose even when the image is full-bleed.
 *
 * The title is **moved** here out of the content rather than printed a second time: a hero that
 * repeats the `h1` immediately below it is the defect this header would otherwise introduce.
 * Moving the element rather than re-emitting the text keeps the heading's `id`, so a link to
 * `#the-heading` still lands. A page whose markdown opens with something other than a heading
 * falls back to the title the manifest already resolved.
 *
 * Everything below the title is conditional and independently so: no cover, no author, no dates
 * and no prose each drop their own part and leave the rest intact — an article with only a title
 * renders a header that is only a title, not an empty box with separators in it.
 */
function articleHeaderHtml(meta: PageMeta, titleHtml: string, opts: { readonly readingTime?: boolean } = {}): string {
  const date = meta.published ?? meta.updated;
  const items = [
    date === undefined ? "" : `<time class="pg-article-meta__item" datetime="${esc(date)}">${esc(readableDate(date))}</time>`,
    meta.author === undefined ? "" : `<span class="pg-article-meta__item">${esc(meta.author)}</span>`,
    meta.readingMinutes === undefined || opts.readingTime === false ? "" : `<span class="pg-article-meta__item">${String(meta.readingMinutes)} min read</span>`,
  ].filter((s) => s !== "");
  const metaRow = items.length === 0
    ? ""
    : `<p class="pg-article-meta">${items.join(`<span class="pg-article-meta__sep" aria-hidden="true">·</span>`)}</p>`;
  return `<header class="pg-article-header">${titleHtml}${metaRow}</header>`;
}

/**
 * The header's search button.
 *
 * Rendered **`disabled`**, and enabled by the client bundle. That is the whole degradation story:
 * the dialog is script, so with scripting off — or with the bundle blocked, or still in flight —
 * the control is visibly inert and its `title` says why, instead of being a box that swallows a
 * reader's question. A control that looks live and does nothing is worse than no control.
 *
 * **Both shortcuts are printed**, because a shortcut nobody can see is a shortcut nobody uses: the
 * client has always bound ⌘K/Ctrl-K as well as `/`, and for as long as the button said only `Search
 * /` that binding existed for people who already guessed it. `/` stays first — it is the one key
 * that is true on every keyboard, and it is the one that works with no modifier — and the combo
 * follows it.
 *
 * The combo is rendered `Ctrl K` and rewritten to `⌘K` by the client on Apple platforms. It has to
 * be that way round: the shell renders **one** HTML file for every reader, cached and served to all
 * of them, so the platform is a fact only the browser has. Ctrl is the majority default, the
 * element carries `data-pg-search-combo` for the client to find, and the swap happens in the same
 * pass that enables the button — so a reader never sees the wrong key on a button that works.
 *
 * A host with its own chrome renders its own trigger: anything carrying `data-pg-search-open` is
 * wired by the client, and its `disabled` attribute (if any) removed. A `data-pg-search-combo`
 * inside one gets the same platform treatment. See `docs/search.md`.
 */
function searchTriggerHtml(ctx: ShellCtx): string {
  if (ctx.searchUrl === undefined) return "";
  return `<button type="button" class="pg-search-trigger" data-pg-search-open disabled title="Search needs JavaScript"><span class="pg-search-trigger__label">Search</span><kbd class="pg-search-trigger__key">/</kbd><kbd class="pg-search-trigger__key pg-search-trigger__key--combo" data-pg-search-combo>Ctrl K</kbd></button>`;
}

/** Mobile replacement for the site rail. Enabled by the client only when its dialog is wired. */
function navigationTriggerHtml(): string {
  return `<button type="button" class="pg-nav-trigger" data-pg-nav-open aria-haspopup="dialog" aria-controls="pg-nav-dialog" aria-expanded="false" disabled title="Page navigation needs JavaScript"><span aria-hidden="true">☰</span><span>Pages</span></button>`;
}

/** A leading `<h1>…</h1>`, if the rendered page opens with one. */
const LEADING_H1 = /^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/;
/**
 * Markup a page may begin with that is not *content*: a `<style>` element the renderer hoisted
 * there, or a comment. Neither is a thing a reader sees, so neither should decide whether the
 * page opens with a heading.
 */
const LEADING_NON_CONTENT = /^\s*(?:<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->)/;

/**
 * The page's opening `<h1>`, lifted out of its HTML — and what is left of the page.
 *
 * The heading is *moved* into the article header rather than reprinted, so exactly one of the two
 * surfaces prints it and the element keeps its `id`. The subtlety is what "opening" means:
 * `inlineFigureSvgs` prepends a `<style>` element to a page whose figures were drawn at several
 * widths, so on precisely the pages that carry responsive figures — Kineglyph's own docs, which is
 * where this was found — the page no longer *literally* began with its `<h1>`, the lift silently
 * failed, and the header fell back to reprinting the manifest title above a heading that was still
 * in the content. The title rendered twice.
 *
 * So the leading non-content is stepped over to find the heading, and then put back in front of
 * the content it came with: nothing is dropped, and a page that genuinely opens with prose keeps
 * every heading it wrote.
 */
export function liftLeadingH1(html: string): { readonly h1?: string; readonly rest: string } {
  let prefix = "";
  let body = html;
  for (;;) {
    const skip = LEADING_NON_CONTENT.exec(body);
    if (skip === null) break;
    prefix += skip[0];
    body = body.slice(skip[0].length);
  }
  const h1 = LEADING_H1.exec(body);
  if (h1 === null) return { rest: html };
  return { h1: h1[0], rest: prefix + body.slice(h1[0].length) };
}

function navHtml(nodes: readonly NavNode[], current: string, base: string, depth = 0): string {
  return `<ul class="pg-nav__list pg-nav__list--${depth}">${nodes
    .map((n) =>
      n.children
        ? `<li class="pg-nav__section"><span class="pg-nav__label">${esc(n.title)}</span>${navHtml(n.children, current, base, depth + 1)}</li>`
        : `<li><a class="pg-nav__link" href="${esc(withBase(base, n.href!))}"${n.href === current ? ` aria-current="page"` : ""}>${esc(n.title)}</a></li>`,
    )
    .join("")}</ul>`;
}

/** Renders one page of an article into a complete HTML document. */
export function renderPageHtml(article: RenderedArticle, href: string, ctx: ShellCtx): string {
  const page = article.pages[href]!;
  const meta = article.manifest.pages[href]!;
  const a = article.manifest.article;
  const toc = meta.headings.filter((h) => h.level === 2 || h.level === 3);
  const tocHtml =
    toc.length === 0
      ? ""
      : `<nav class="pg-toc" aria-label="On this page"><p class="pg-toc__label">On this page</p><ul>${toc
          .map((h) => `<li class="pg-toc__item pg-toc__item--${h.level}"><a href="${esc(`${withBase(ctx.base, href)}#${h.id}`)}">${esc(h.text)}</a></li>`)
          .join("")}</ul></nav>`;
  // The arrows point the other way on a blog, which is the point of the form rather than a detail
  // of it. In docs they are positions in a reading order somebody chose; on a blog there is no such
  // order, only a chronology, so the same two links mean **newer** and **older**. `renderArticle`
  // has already pointed `prev` up the index (newer) and `next` down it (older), so only the words
  // change here — and the words are what a reader is actually navigating by.
  const isBlog = article.manifest.article.form === "blog";
  const prev =
    meta.prev === undefined
      ? ""
      : `<a class="pg-pager__link pg-pager__link--prev" rel="prev" href="${esc(withBase(ctx.base, meta.prev))}"><span>${isBlog ? "Newer" : "Previous"}</span>${esc(article.manifest.pages[meta.prev]!.title)}</a>`;
  const next =
    meta.next === undefined
      ? ""
      : `<a class="pg-pager__link pg-pager__link--next" rel="next" href="${esc(withBase(ctx.base, meta.next))}"><span>${isBlog ? "Older" : "Next"}</span>${esc(article.manifest.pages[meta.next]!.title)}</a>`;
  const crumbs = meta.breadcrumbs
    .map((c) => (c.href ? `<a href="${esc(withBase(ctx.base, c.href))}">${esc(c.title)}</a>` : `<span>${esc(c.title)}</span>`))
    .join(`<span class="pg-crumbs__sep">/</span>`);
  // Dev-only chrome: `/__edit/` is served by the dev server and is base-independent, because it
  // is not part of the site the base describes.
  const editLink = ctx.edit === true
    ? `<a class="pg-header__edit" href="${esc(`/__edit${href}`)}">Edit this page</a>`
    : "";
  // Presence of the tag in *this page's* HTML is the whole condition: the element defines itself on
  // load, so a page without one gains nothing from the script and a page with one needs no flag.
  const modelViewer = page.html.includes("<model-viewer")
    ? `<script type="module" src="${esc(ctx.modelViewerUrl ?? DEFAULT_MODEL_VIEWER_URL)}"></script>`
    : "";
  // A host that brings its own header takes the brand row and the theme toggle with it; the
  // sidebar, TOC and pager stay, because they are the article's own navigation.
  // The brand on the left and everything that acts on the right, in a group of its own. Four
  // children under `justify-content: space-between` spread themselves across the row, which put
  // "Edit this page" hard against the site title on a narrow header and left the toggle marooned;
  // one group with a gap is the arrangement a header actually has.
  // A blog's `nav` is a list of standalone pages, and most blogs have none — so the rail is not a
  // thing that is empty, it is a thing that is absent, and the grid closes over it. Rendering an
  // empty 240px column with a border down one side is the tell of a docs layout pretending.
  const hasNav = article.manifest.nav.length > 0;
  const header = ctx.chrome === false
    ? ""
    : `<header class="pg-header"><a class="pg-header__title" href="${esc(withBase(ctx.base, "/"))}">${esc(a.title)}</a><div class="pg-header__actions">${hasNav ? navigationTriggerHtml() : ""}${editLink}${searchTriggerHtml(ctx)}<button type="button" class="pg-theme-toggle" data-pagina-theme-toggle aria-label="Toggle colour scheme"><span class="pg-theme-toggle__thumb"></span></button></div></header>`;
  // The article header, above the content and under the breadcrumbs, on the pages `cover_on`
  // names. `?? "root"` is for a manifest assembled by hand rather than by `renderArticle` — the
  // default has to be the same one `article.yaml` documents, wherever the manifest came from.
  const isRoot = href === a.rootHref;
  const coverOn = a.coverOn ?? "root";
  const wantsHeader = coverOn === "all" || (coverOn === "root" && isRoot);
  const lifted = wantsHeader ? liftLeadingH1(page.html) : { rest: page.html };
  const contentHtml = lifted.rest;
  // "1 min read" on a blog's front page is the reading time of a two-sentence introduction, sitting
  // directly above a list of posts that each carry their own. It is the one number on that page
  // that measures nothing a reader cares about.
  const articleHeader = wantsHeader
    ? articleHeaderHtml(meta, lifted.h1 ?? `<h1>${esc(meta.title)}</h1>`, isBlog && isRoot ? { readingTime: false } : {})
    : "";
  const cover = wantsHeader ? coverHtml(meta, a, isRoot) : "";
  // Every tag pagina emits for this page — title, description, robots, OpenGraph, Twitter,
  // canonical and the JSON-LD `Article` — already escaped for the context each one lands in.
  const seo = renderSeoHtml(pageSeo(article.manifest, href, {
    base: ctx.base,
    ...(ctx.siteUrl === undefined ? {} : { siteUrl: ctx.siteUrl }),
    ...(ctx.mirrorOf === undefined ? {} : { mirrorOf: ctx.mirrorOf }),
  }));
  // A blog announces its feed on every page. This is the whole of how anyone subscribes: a reader
  // is pointed at the site, not at `feed.xml`, and every feed reader in use looks for exactly this
  // element. `feedUrl` answers `undefined` on the builds that write no feed — a draft, a mirror, a
  // folder with no `site_url` — so the page never advertises a file that is not there.
  const feed = feedUrl(article.manifest, {
    base: ctx.base,
    ...(ctx.siteUrl === undefined ? {} : { siteUrl: ctx.siteUrl }),
    ...(ctx.mirrorOf === undefined ? {} : { mirrorOf: ctx.mirrorOf }),
  });
  const feedLink = feed === undefined
    ? ""
    : `\n<link rel="alternate" type="application/atom+xml" href="${esc(feed)}" title="${esc(a.title)}">`;
  // And once more where a person can see it. `<link rel="alternate">` is addressed to software; a
  // reader who wants to follow the blog has to be given something to click, and the front page is
  // where they are when they decide.
  const subscribe = feed === undefined || !isBlog || !isRoot
    ? ""
    : `<p class="pg-subscribe"><a href="${esc(feed)}">Subscribe by feed</a></p>`;
  const siteNavigation = navHtml(article.manifest.nav, href, ctx.base);
  const mobileNavigation = ctx.chrome === false || !hasNav
    ? ""
    : `<div class="pg-nav-modal" data-pg-nav-modal hidden><section class="pg-nav-modal__panel" id="pg-nav-dialog" role="dialog" aria-modal="true" aria-labelledby="pg-nav-dialog-title"><header class="pg-nav-modal__header"><h2 id="pg-nav-dialog-title">Pages</h2><button type="button" class="pg-nav-modal__close" data-pg-nav-close aria-label="Close page navigation">Close</button></header><nav class="pg-nav pg-nav--modal" aria-label="Pages">${siteNavigation}</nav></section></div>`;
  return `<!doctype html>
<html lang="en" data-theme="light"${ctx.kineglyphThemeUrl === undefined ? "" : ` data-kg-theme="${esc(ctx.kineglyphThemeUrl)}"`}${ctx.kineglyphThemeUrls === undefined ? "" : ` data-kg-themes="${esc(JSON.stringify(ctx.kineglyphThemeUrls))}"`}${ctx.searchUrl === undefined ? "" : ` data-pg-search="${esc(ctx.searchUrl)}" data-pg-base="${esc(ctx.base)}"`}>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${seo}
${THEME_INIT_SCRIPT}
<script type="importmap">{"imports":{"kineglyph":"${escInScriptJson(ctx.kineglyphRuntimeUrl)}"}}</script>
${stylesheetHtml(ctx)}${(ctx.theme ?? "full") === "none" ? "" : cascadeStylesheetsHtml(article, href)}${feedLink}
</head>
<body>
${header}${mobileNavigation}${cover}
<div class="pg-shell${hasNav ? "" : " pg-shell--no-nav"}">
${hasNav ? `<nav class="pg-nav" aria-label="Site">${siteNavigation}</nav>` : ""}
<main class="pg-main"><nav class="pg-crumbs" aria-label="Breadcrumb">${crumbs}</nav>${articleHeader}<article class="pg-content">${contentHtml}</article>${subscribe}<nav class="pg-pager">${prev}${next}</nav></main>
${tocHtml}
</div>
<script type="module" src="${esc(ctx.clientUrl)}"></script>${modelViewer}
</body></html>`;
}
