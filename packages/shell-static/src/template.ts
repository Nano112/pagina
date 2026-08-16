import type { NavNode, RenderedArticle } from "@pagina/core";

/** Context a page render pass gets. The five required fields mirror `@pagina/vite`'s
 * `ShellContext` exactly; `kineglyphThemeUrl` is computed by `staticShell` internally (see
 * `src/index.ts`) and is not part of the public `Shell.render` contract. */
export interface ShellCtx {
  base: string;
  dev: boolean;
  clientUrl: string;
  cssUrl: string;
  kineglyphRuntimeUrl: string;
  kineglyphThemeUrl?: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);
const withBase = (base: string, href: string) => `${base.replace(/\/$/, "")}${href}`;

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
  return `<!doctype html>
<html lang="en" data-theme="light"${ctx.kineglyphThemeUrl === undefined ? "" : ` data-kg-theme="${esc(ctx.kineglyphThemeUrl)}"`}>
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} · ${esc(a.title)}</title>
<script>(function(){try{var t=localStorage.getItem("pagina-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<script type="importmap">{"imports":{"kineglyph":"${esc(ctx.kineglyphRuntimeUrl)}"}}</script>
<link rel="stylesheet" href="${esc(ctx.cssUrl)}">
</head>
<body>
<header class="pg-header"><a class="pg-header__title" href="${esc(withBase(ctx.base, "/"))}">${esc(a.title)}</a><button type="button" class="pg-theme-toggle" data-pagina-theme-toggle aria-label="Toggle colour scheme"><span class="pg-theme-toggle__thumb"></span></button></header>
<div class="pg-shell">
<nav class="pg-nav" aria-label="Site">${navHtml(article.manifest.nav, href, ctx.base)}</nav>
<main class="pg-main"><nav class="pg-crumbs" aria-label="Breadcrumb">${crumbs}</nav><article class="pg-content">${page.html}</article><nav class="pg-pager">${prev}${next}</nav></main>
${tocHtml}
</div>
<script type="module" src="${esc(ctx.clientUrl)}"></script>
</body></html>`;
}
