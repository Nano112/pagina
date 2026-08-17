import { pageSeo, renderSeoHtml, type NavNode, type RenderedArticle, type ThemeLevel } from "@pagina/core";

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
  // The cover, where it earns its place: above the article, under the breadcrumbs, on any page
  // that resolved one (its own, or the article's). A host that supplies its own hero ignores it.
  const cover = meta.cover === undefined
    ? ""
    : `<figure class="pg-cover"><img class="pg-cover__img" src="${esc(meta.cover)}" alt="" loading="eager" decoding="async"></figure>`;
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
${stylesheetHtml(ctx)}
</head>
<body>
${header}
<div class="pg-shell">
<nav class="pg-nav" aria-label="Site">${navHtml(article.manifest.nav, href, ctx.base)}</nav>
<main class="pg-main"><nav class="pg-crumbs" aria-label="Breadcrumb">${crumbs}</nav>${cover}<article class="pg-content">${page.html}</article><nav class="pg-pager">${prev}${next}</nav></main>
${tocHtml}
</div>
<script type="module" src="${esc(ctx.clientUrl)}"></script>${modelViewer}
</body></html>`;
}
