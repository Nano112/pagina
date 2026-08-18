import { kineglyphColorVars, pageSeo, renderSeoHtml, type KineglyphThemeColors, type NavNode, type PageMeta, type RenderedArticle, type ThemeLevel } from "@pagina/core";

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
  /** The article's theme, loaded — its colours become `--kg-color-*`; see {@link kineglyphThemeCss}. */
  kineglyphTheme?: KineglyphThemeColors;
  /** `pagina dev --edit`: add an "Edit this page" link into the editor. Never set in a build. */
  edit?: boolean;
  /** Overrides {@link DEFAULT_MODEL_VIEWER_URL} for pages that embed a `<model-viewer>`. */
  modelViewerUrl?: string;
  /** Absolute site origin, for canonical/`og:url`/`og:image`. Absent, those tags are omitted. */
  siteUrl?: string;
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
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);
/** A string inside a raw-text `<script>` element: HTML escapes are NOT decoded there, so the
 *  value must be JSON-escaped (not HTML-escaped) and only `</script` needs neutralising. */
const escInScriptJson = (s: string) => JSON.stringify(s).slice(1, -1).replace(/<\/script/gi, "<\\/script");
const withBase = (base: string, href: string) => `${base.replace(/\/$/, "")}${href}`;

/**
 * Where the tokens-only sheet lives. A builder that emits one says so explicitly; otherwise it
 * sits next to the full sheet under the name `bundleClient` gives it, which is the layout every
 * pagina build produces.
 */
const tokensUrl = (ctx: ShellCtx): string =>
  ctx.tokensCssUrl ?? ctx.cssUrl.replace(/pagina\.css(?=$|[?#])/, "pagina.tokens.css");

/** The `<link>` (if any) for pagina's own CSS at this theme level. */
function stylesheetHtml(ctx: ShellCtx): string {
  const theme = ctx.theme ?? "full";
  if (theme === "none") return "";
  return `<link rel="stylesheet" href="${esc(theme === "tokens" ? tokensUrl(ctx) : ctx.cssUrl)}">`;
}

/** `--kg-color-a:#…;--kg-color-b:#…` for one palette. */
const varBlock = (palette: { readonly colors?: Readonly<Record<string, string>> } | undefined): string =>
  Object.entries(kineglyphColorVars(palette?.colors))
    // A colour is a CSS value in a `<style>`: `<` and `"` cannot appear in one, and anything that
    // would need escaping is not a colour, so it is dropped rather than smuggled through.
    .filter(([, value]) => !/[<>"';{}]/.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");

/**
 * The article's own theme, as the variables its figures are painted from.
 *
 * Emitted **after** the stylesheet, and unlayered, so it outranks `pagina.css`'s `--kg-color-*` →
 * `--pg-*` bridge. That bridge is what lets a host retint figures it did not draw, and it stays the
 * default; but an article that ships a theme module has already said what its figures look like,
 * and drawing them in one palette while painting them in another is the bug this closes.
 *
 * Both palettes are written, keyed on the same `data-theme` the page toggle sets, so switching
 * theme moves the pre-rendered frame and the live stage together and without JavaScript.
 */
function kineglyphThemeCss(ctx: ShellCtx): string {
  if (ctx.kineglyphTheme === undefined || (ctx.theme ?? "full") === "none") return "";
  const light = varBlock(ctx.kineglyphTheme.light);
  const dark = varBlock(ctx.kineglyphTheme.dark);
  if (light === "" && dark === "") return "";
  return `\n<style>:root{${light}}:root[data-theme="dark"]{${dark}}</style>`;
}

/**
 * A date as a reader reads it, spelled out rather than left as an ISO stamp.
 *
 * Written by hand rather than through `Intl`: the shell renders on whatever Node a build runs on
 * and reads in whatever browser opens the page, and an ICU build difference would make the same
 * article's HTML differ between two machines. A value that is not a date pagina understands is
 * passed through unchanged — it is still the author's, and `datetime` keeps the machine-readable
 * half either way.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function readableDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (month === undefined) return iso;
  return `${String(Number(m[3]))} ${month} ${m[1]!}`;
}

/**
 * The article header: the cover, the title, and the line of provenance under it.
 *
 * **A cover belongs to the article, not to each page.** A reference page three levels into an API
 * doc re-displaying the hero is a magazine reprinting its front page on every spread, so the
 * header renders on the article's landing page and nowhere else unless the author says otherwise
 * with `cover_on` (`"root"` by default, `"all"`, or `"none"`).
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
function articleHeaderHtml(
  meta: PageMeta, article: RenderedArticle["manifest"]["article"], titleHtml: string, isRoot: boolean,
): string {
  const alt = meta.coverAlt ?? article.title;      // never "", never the filename — see render-article.ts
  const cover = meta.cover === undefined
    ? ""
    // No intrinsic size is known at build time (pagina copies the file, it does not decode it), so
    // the reflow is held off by the aspect-ratio box `.pg-cover__img` declares instead. On the
    // landing page the cover is the LCP element and must not be deferred; on a sub-page under
    // `cover_on: "all"` it is one hero among many and can wait its turn.
    : `<figure class="pg-cover"><img class="pg-cover__img" src="${esc(meta.cover)}" alt="${esc(alt)}" loading="${isRoot ? "eager" : "lazy"}" decoding="async"></figure>`;
  const date = meta.published ?? meta.updated;
  const items = [
    date === undefined ? "" : `<time class="pg-article-meta__item" datetime="${esc(date)}">${esc(readableDate(date))}</time>`,
    meta.author === undefined ? "" : `<span class="pg-article-meta__item">${esc(meta.author)}</span>`,
    meta.readingMinutes === undefined ? "" : `<span class="pg-article-meta__item">${String(meta.readingMinutes)} min read</span>`,
  ].filter((s) => s !== "");
  const metaRow = items.length === 0
    ? ""
    : `<p class="pg-article-meta">${items.join(`<span class="pg-article-meta__sep" aria-hidden="true">·</span>`)}</p>`;
  return `<header class="pg-article-header">${cover}${titleHtml}${metaRow}</header>`;
}

/** A leading `<h1>…</h1>`, if the rendered page opens with one. */
const LEADING_H1 = /^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/;

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
  const prev =
    meta.prev === undefined
      ? ""
      : `<a class="pg-pager__link pg-pager__link--prev" rel="prev" href="${esc(withBase(ctx.base, meta.prev))}"><span>Previous</span>${esc(article.manifest.pages[meta.prev]!.title)}</a>`;
  const next =
    meta.next === undefined
      ? ""
      : `<a class="pg-pager__link pg-pager__link--next" rel="next" href="${esc(withBase(ctx.base, meta.next))}"><span>Next</span>${esc(article.manifest.pages[meta.next]!.title)}</a>`;
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
  const header = ctx.chrome === false
    ? ""
    : `<header class="pg-header"><a class="pg-header__title" href="${esc(withBase(ctx.base, "/"))}">${esc(a.title)}</a>${editLink}<button type="button" class="pg-theme-toggle" data-pagina-theme-toggle aria-label="Toggle colour scheme"><span class="pg-theme-toggle__thumb"></span></button></header>`;
  // The article header, above the content and under the breadcrumbs, on the pages `cover_on`
  // names. `?? "root"` is for a manifest assembled by hand rather than by `renderArticle` — the
  // default has to be the same one `article.yaml` documents, wherever the manifest came from.
  const isRoot = href === a.rootHref;
  const coverOn = a.coverOn ?? "root";
  const wantsHeader = coverOn === "all" || (coverOn === "root" && isRoot);
  const leading = wantsHeader ? LEADING_H1.exec(page.html) : null;
  const contentHtml = leading === null ? page.html : page.html.slice(leading[0].length);
  const articleHeader = wantsHeader
    ? articleHeaderHtml(meta, a, leading?.[0] ?? `<h1>${esc(meta.title)}</h1>`, isRoot)
    : "";
  // Every tag pagina emits for this page — title, description, robots, OpenGraph, Twitter,
  // canonical and the JSON-LD `Article` — already escaped for the context each one lands in.
  const seo = renderSeoHtml(pageSeo(article.manifest, href, { base: ctx.base, ...(ctx.siteUrl === undefined ? {} : { siteUrl: ctx.siteUrl }) }));
  return `<!doctype html>
<html lang="en" data-theme="light"${ctx.kineglyphThemeUrl === undefined ? "" : ` data-kg-theme="${esc(ctx.kineglyphThemeUrl)}"`}>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${seo}
<script>(function(){try{var t=localStorage.getItem("pagina-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<script type="importmap">{"imports":{"kineglyph":"${escInScriptJson(ctx.kineglyphRuntimeUrl)}"}}</script>
${stylesheetHtml(ctx)}${kineglyphThemeCss(ctx)}
</head>
<body>
${header}
<div class="pg-shell">
<nav class="pg-nav" aria-label="Site">${navHtml(article.manifest.nav, href, ctx.base)}</nav>
<main class="pg-main"><nav class="pg-crumbs" aria-label="Breadcrumb">${crumbs}</nav>${articleHeader}<article class="pg-content">${contentHtml}</article><nav class="pg-pager">${prev}${next}</nav></main>
${tocHtml}
</div>
<script type="module" src="${esc(ctx.clientUrl)}"></script>${modelViewer}
</body></html>`;
}
