import type { NavNode, RenderedArticle } from "@pagina/core";
import { esc, stylesheetHtml, withBase, THEME_INIT_SCRIPT, type ShellCtx } from "./template.js";

/**
 * The page that isn't a page.
 *
 * An article, in pagina, is a folder plus a nav, and the nav is checked: a `pack` whose nav names a
 * page that is not there is a build error, not a broken link on a published site. Which makes a 404
 * the one address the build would have refused — and it also makes the *right* thing to put on one
 * obvious, because at the moment this file is written the manifest is right there. A 404 that says
 * only "not found" throws away the one fact this system actually holds: which pages exist.
 *
 * So this is a table of contents with the reader's address typeset into it as the entry that has no
 * folio. Everything below the dotted leaders is real: the article's nav, in reading order, numbered
 * the way the pager walks it.
 *
 * Three things about a 404 that are easy to get wrong, and are the reason for most of the care here:
 *
 *  - **It is served from an address nobody chose.** GitHub Pages hands `/404.html` to a request for
 *    `/pagina/any/depth/at/all/`, and the browser resolves the page's URLs against *that*, not
 *    against where the file lives. Every href and every asset URL below is therefore site-absolute
 *    and base-prefixed; there is not one relative URL on the page, by construction.
 *  - **It has to work with JavaScript off.** The address the reader asked for is only knowable in
 *    the browser, so the "you asked for" row ships a truthful placeholder in the HTML and is
 *    *upgraded* by a five-line script. With scripting off the page is still a correct index.
 *  - **The address is attacker-controlled text.** It is written with `textContent` — never parsed as
 *    markup — and trimmed of control and bidi characters, which are the two ways a path can lie
 *    about what it says.
 *
 * The styles are inline rather than in `pagina.css` for the same reason: this page is reached when
 * something is already wrong, and it should not depend on a second file, nor on a cached bundle
 * being in step with it. They are layered, and every colour is a `--pg-*` token with a literal
 * fallback, so the page follows its host and still looks deliberate under `theme: "none"`.
 */

/** One leaf of the nav, numbered in reading order. Sections are labels, and are not numbered. */
type Row = { readonly kind: "section"; readonly title: string } | { readonly kind: "page"; readonly title: string; readonly href: string; readonly folio: number };

/**
 * The whole nav, flattened into rows.
 *
 * Capped, because "list the pages" stops being a kindness somewhere around the fiftieth: a reader
 * who has to scroll a 404 has been given a wall, not a way back. The overflow is reported rather
 * than hidden, and the article's landing page is one row away in either case.
 */
export const MAX_ROWS = 48;

function flatten(nodes: readonly NavNode[], rows: Row[], counter: { n: number }): void {
  for (const node of nodes) {
    if (node.children !== undefined) {
      rows.push({ kind: "section", title: node.title });
      flatten(node.children, rows, counter);
    } else if (node.href !== undefined) {
      counter.n += 1;
      rows.push({ kind: "page", title: node.title, href: node.href, folio: counter.n });
    }
  }
}

/** A dotted leader and a folio, the two columns every row shares. */
const leader = `<span class="pg-404__leader" aria-hidden="true"></span>`;

function rowsHtml(rows: readonly Row[], base: string): string {
  return rows
    .map((row) =>
      row.kind === "section"
        ? `<li class="pg-404__section">${esc(row.title)}</li>`
        : `<li class="pg-404__row"><a class="pg-404__name" href="${esc(withBase(base, row.href))}">${esc(row.title)}</a>${leader}<span class="pg-404__folio">${String(row.folio)}</span></li>`,
    )
    .join("");
}

/**
 * Upgrades the placeholder row with the address the reader actually asked for.
 *
 * `textContent`, never `innerHTML`: the path is whatever a stranger typed, and a 404 that writes it
 * into the DOM as markup is a stored XSS on every page of the site. The character classes stripped
 * are the ones that make a string display as something other than itself — C0/C1 controls, the line
 * separators, and the bidi overrides that can print `/safe/` for `/efas/`. A path longer than the
 * cap is a paragraph, not an address, so it is cut.
 */
const PATH_SCRIPT = `<script>(function(){try{
var el=document.querySelector("[data-pagina-404-path]");if(!el)return;
var p=location.pathname;try{p=decodeURI(p)}catch(e){}
p=p.replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]/g,"");
if(p.length>96)p=p.slice(0,95)+"\\u2026";
if(p==="")return;el.textContent=p;el.classList.add("is-resolved");
}catch(e){}})();</script>`;

/**
 * The theme toggle, without the client bundle.
 *
 * The 404 has no figures, no tabs and no code to copy, so it links the stylesheet and nothing else:
 * a page reached by accident should not pull a runtime, and — the deciding reason — `_pagina/*.js`
 * is served unversioned, so a 404 that depended on it could be rendered by a bundle older than
 * itself. Same storage key as the client, so the choice a reader makes here survives the click back
 * into the article.
 */
const TOGGLE_SCRIPT = `<script>(function(){var b=document.querySelector("[data-pagina-theme-toggle]");if(b===null)return;b.addEventListener("click",function(){var r=document.documentElement;var t=r.dataset.theme==="dark"?"light":"dark";r.dataset.theme=t;try{localStorage.setItem("pagina-theme",t)}catch(e){}});})();</script>`;

/** Everything the page paints with. Tokens with fallbacks, layered so a host's own CSS still wins. */
const STYLE = `<style>
@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome, pagina.editor;
@layer pagina.chrome {
  .pg-404-body { margin: 0; background: var(--pg-bg, #ffffff); color: var(--pg-fg, #1a1d23); font-family: var(--pg-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif); }
  .pg-404 { max-width: 42rem; margin: 0 auto; padding: clamp(2.5rem, 9vw, 5.5rem) clamp(1.15rem, 5vw, 2rem) 5rem; }
  .pg-404__eyebrow { margin: 0 0 0.9rem; font-family: var(--pg-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--pg-muted, #6b7280); }
  .pg-404__title { margin: 0 0 0.85rem; font-family: var(--pg-font-display, inherit); font-size: clamp(1.7rem, 6.5vw, 2.4rem); font-weight: 620; line-height: 1.12; letter-spacing: -0.02em; }
  .pg-404__lede { margin: 0; max-width: 54ch; font-size: 1.0125rem; line-height: 1.65; color: var(--pg-muted, #6b7280); }
  .pg-404__asked { margin: 2.75rem 0 0.4rem; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--pg-muted, #6b7280); }
  .pg-404__h2 { margin: 2.5rem 0 0.4rem; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--pg-muted, #6b7280); }
  .pg-404__list { margin: 0; padding: 0; list-style: none; }
  .pg-404__row { display: flex; align-items: baseline; gap: 0.55rem; padding: 0.32rem 0; }
  .pg-404__leader { flex: 1 1 1.5rem; min-width: 1.25rem; border-bottom: 1px dotted var(--pg-line-strong, #c8cdd6); transform: translateY(-0.28em); }
  .pg-404__name { color: inherit; text-decoration: none; }
  .pg-404__name:hover { color: var(--pg-accent, #3b5bdb); text-decoration: underline; text-underline-offset: 0.18em; }
  .pg-404__folio { flex: none; font-family: var(--pg-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 0.8125rem; font-variant-numeric: tabular-nums; color: var(--pg-muted, #6b7280); }
  .pg-404__section { margin: 1.35rem 0 0.15rem; font-size: 0.8125rem; color: var(--pg-muted, #6b7280); }
  .pg-404__section:first-child { margin-top: 0; }
  /* Bled out by exactly its own padding, so the folio column of the entry that has no folio sits on
     the same axis as the numbered ones. That alignment is the entire point of the row. */
  .pg-404__row--missing { background: var(--pg-bg-raised, #f6f7f9); border-radius: var(--pg-radius, 6px); padding: 0.6rem 0.75rem; margin: 0 -0.75rem; }
  .pg-404__path { font-family: var(--pg-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 0.8125rem; overflow-wrap: anywhere; min-width: 0; }
  .pg-404__row--missing .pg-404__folio { color: var(--pg-danger, #d64545); font-size: 0.9375rem; }
  /* On a handset an address is longer than the column, so the entry becomes two lines rather than
     wrapping one character under a leader that has nothing left to lead to. */
  @media (max-width: 32rem) {
    .pg-404__row--missing { flex-wrap: wrap; row-gap: 0.15rem; }
    .pg-404__row--missing .pg-404__path { flex: 1 1 100%; }
  }
  /* The only thing on this page that moves is the toggle's thumb, and that rule is pagina.css's. */
  @media (prefers-reduced-motion: reduce) {
    .pg-404-body .pg-theme-toggle__thumb { transition: none; }
  }
  .pg-404__more { margin: 0.9rem 0 0; font-size: 0.8125rem; color: var(--pg-muted, #6b7280); }
  .pg-404 a:focus-visible, .pg-404-body .pg-header a:focus-visible, .pg-404-body .pg-theme-toggle:focus-visible { outline: 2px solid var(--pg-accent, #3b5bdb); outline-offset: 3px; border-radius: 2px; }
  .pg-404__sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
</style>`;

/**
 * `404.html`: one file, valid from any URL, listing the pages that do exist.
 *
 * Emitted by {@link staticShell} for every build, so a pagina site gets a real 404 without anyone
 * configuring one — GitHub Pages serves `/404.html` for an unmatched path on its own, and a host
 * that does not can be pointed at the same file.
 */
export function renderNotFoundHtml(article: RenderedArticle, ctx: ShellCtx): string {
  const a = article.manifest.article;
  const rows: Row[] = [];
  flatten(article.manifest.nav, rows, { n: 0 });
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.filter((r) => r.kind === "page").length - shown.filter((r) => r.kind === "page").length;
  const home = withBase(ctx.base, a.rootHref);
  // The header is the article's, not this page's: the same brand row every page carries, so the
  // way back is where the reader already knows it is. A host with its own chrome gets none, as
  // everywhere else in this shell.
  const header = ctx.chrome === false
    ? ""
    : `<header class="pg-header"><a class="pg-header__title" href="${esc(withBase(ctx.base, "/"))}">${esc(a.title)}</a><button type="button" class="pg-theme-toggle" data-pagina-theme-toggle aria-label="Toggle colour scheme"><span class="pg-theme-toggle__thumb"></span></button></header>`;
  // No nav, no pages: a folder that renders nothing has nothing to offer here, and an empty
  // contents list with a heading over it would be worse than the sentence alone.
  const contents = shown.length === 0
    ? `<p class="pg-404__more"><a class="pg-404__name" href="${esc(home)}">Go to ${esc(a.title)}</a></p>`
    : `<h2 class="pg-404__h2">Contents</h2><ul class="pg-404__list">${rowsHtml(shown, ctx.base)}</ul>${
        hidden > 0
          ? `<p class="pg-404__more">…and ${String(hidden)} more, from <a class="pg-404__name" href="${esc(home)}">the first page</a>.</p>`
          : ""
      }`;
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · ${esc(a.title)}</title>
<meta name="robots" content="noindex, follow">
${THEME_INIT_SCRIPT}
${stylesheetHtml(ctx)}
${STYLE}
</head>
<body class="pg-404-body">
${header}
<main class="pg-404">
<p class="pg-404__eyebrow">404 · not in the manifest</p>
<h1 class="pg-404__title">This address has no page.</h1>
<p class="pg-404__lede">An article's pages are the ones its nav names, and pagina refuses to build a link to one that is missing. So this is the address the build would have turned down — and below is the list it accepted.</p>
<p class="pg-404__asked" id="pg-404-asked">You asked for</p>
<div class="pg-404__row pg-404__row--missing" role="group" aria-labelledby="pg-404-asked">
<span class="pg-404__path" data-pagina-404-path>an address that is not in this article</span>${leader}<span class="pg-404__folio">—</span><span class="pg-404__sr">no page</span>
</div>
${contents}
</main>
${PATH_SCRIPT}${TOGGLE_SCRIPT}
</body></html>`;
}
