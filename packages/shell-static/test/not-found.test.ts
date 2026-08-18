import { describe, expect, it } from "vitest";
import { MAX_ROWS, renderNotFoundHtml } from "../src/not-found.js";
import { staticShell } from "../src/index.js";
import type { NavNode, PageMeta, RenderedArticle, RenderedPage } from "@pagina/core";

const page = (title: string): RenderedPage => ({ path: `${title}.md`, href: "/", title, html: "<p>x</p>", headings: [], figures: [], links: [], frontMatter: {} });
const meta = (title: string): PageMeta => ({ title, headings: [], breadcrumbs: [{ title }] });

function articleWith(nav: readonly NavNode[]): RenderedArticle {
  const hrefs: string[] = [];
  const walk = (nodes: readonly NavNode[]): void => {
    for (const n of nodes) {
      if (n.children !== undefined) walk(n.children);
      else if (n.href !== undefined) hrefs.push(n.href);
    }
  };
  walk(nav);
  return {
    diagnostics: [],
    manifest: {
      article: { slug: "t", title: "T Docs", form: "docs", status: "published", visibility: "public", tags: [], rootHref: hrefs[0] ?? "/", coverOn: "root" },
      nav,
      pages: Object.fromEntries(hrefs.map((h) => [h, meta(h)])) as Record<string, PageMeta>,
      figures: {}, assets: [],
    },
    pages: Object.fromEntries(hrefs.map((h) => [h, page(h)])) as Record<string, RenderedPage>,
  };
}

const nav: readonly NavNode[] = [
  { title: "What pagina is", href: "/" },
  { title: "The contracts", children: [{ title: "The article folder", href: "/article-folder/" }, { title: "Theming", href: "/theming/" }] },
];
const article = articleWith(nav);
const ctx = { base: "/", dev: false, clientUrl: "/_pagina/pagina.js", cssUrl: "/_pagina/pagina.css", kineglyphRuntimeUrl: "/_pagina/kineglyph.js" };
const based = { ...ctx, base: "/pagina/", clientUrl: "/pagina/_pagina/pagina.js", cssUrl: "/pagina/_pagina/pagina.css", kineglyphRuntimeUrl: "/pagina/_pagina/kineglyph.js" };

/** Every URL the document references — the set that has to be absolute, wherever the page is served from. */
function urlsIn(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]!);
}

describe("renderNotFoundHtml", () => {
  it("lists the article's real pages, in reading order, with the section labels", () => {
    const html = renderNotFoundHtml(article, ctx);
    expect(html).toContain(`<li class="pg-404__section">The contracts</li>`);
    expect(html).toContain(`href="/">What pagina is</a>`);
    expect(html).toContain(`href="/article-folder/">The article folder</a>`);
    expect(html).toContain(`href="/theming/">Theming</a>`);
    // The folio column is the pager's own order, and the sections are not numbered.
    expect([...html.matchAll(/pg-404__folio">(\d+)</g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
  });

  /**
   * The defect this file exists to not have. A 404 is served from an address nobody chose, and a
   * relative URL on it resolves against *that* address: the page works at `/404.html` and breaks at
   * `/a/b/c/`, which is the only place it is ever actually used.
   */
  it("references nothing relatively, so it works from an arbitrary depth", () => {
    for (const html of [renderNotFoundHtml(article, ctx), renderNotFoundHtml(article, based)]) {
      const urls = urlsIn(html);
      expect(urls.length).toBeGreaterThan(3);
      for (const url of urls) expect(url.startsWith("/")).toBe(true);
    }
  });

  it("puts base in front of every link and the stylesheet", () => {
    const html = renderNotFoundHtml(article, based);
    expect(html).toContain(`href="/pagina/_pagina/pagina.css"`);
    expect(html).toContain(`href="/pagina/article-folder/"`);
    expect(html).toContain(`href="/pagina/">`);
    expect(urlsIn(html).every((u) => u.startsWith("/pagina/"))).toBe(true);
  });

  it("asks not to be indexed", () => {
    expect(renderNotFoundHtml(article, ctx)).toContain(`<meta name="robots" content="noindex, follow">`);
  });

  /** With scripting off the row still says something true, and the index is the whole point anyway. */
  it("states the requested path as a placeholder the browser upgrades, never as markup", () => {
    const html = renderNotFoundHtml(article, ctx);
    expect(html).toContain(`data-pagina-404-path>an address that is not in this article<`);
    expect(html).toContain("el.textContent=p");
    expect(html).not.toContain("innerHTML");
  });

  it("escapes a hostile title everywhere it lands", () => {
    const nasty = articleWith([{ title: 'A "quoted" & <b>title</b>', href: '/g/q"uote/' }]);
    const html = renderNotFoundHtml(nasty, ctx);
    expect(html).not.toContain("<b>title</b>");
    expect(html).toContain("&lt;b&gt;title&lt;/b&gt;");
    expect(html).toContain(`href="/g/q&quot;uote/"`);
  });

  it("caps a very long nav and says how much it left out", () => {
    const many = articleWith(Array.from({ length: MAX_ROWS + 7 }, (_, i) => ({ title: `Page ${String(i)}`, href: `/p${String(i)}/` })));
    const html = renderNotFoundHtml(many, ctx);
    expect([...html.matchAll(/pg-404__folio">(\d+)</g)]).toHaveLength(MAX_ROWS);
    expect(html).toContain("…and 7 more");
  });

  it("drops the contents and offers the article instead when there is no nav", () => {
    const html = renderNotFoundHtml(articleWith([]), ctx);
    expect(html).not.toContain(`<ul class="pg-404__list">`);
    expect(html).toContain(`Go to T Docs`);
  });

  it("omits the header for a host that brings its own chrome", () => {
    expect(renderNotFoundHtml(article, { ...ctx, chrome: false })).not.toContain(`<header class="pg-header">`);
    expect(renderNotFoundHtml(article, ctx)).toContain(`<header class="pg-header">`);
  });

  it("links no stylesheet at all under `theme: none`, and still paints itself", () => {
    const html = renderNotFoundHtml(article, { ...ctx, theme: "none" });
    expect(html).not.toContain(`rel="stylesheet"`);
    expect(html).toContain("var(--pg-bg, #ffffff)");
  });
});

describe("staticShell", () => {
  it("emits 404.html beside the pages of every build", async () => {
    const files = await staticShell.render(article, { ...ctx, base: "/pagina/" });
    expect(Object.keys(files)).toContain("404.html");
    expect(String(files["404.html"])).toContain("pg-404__title");
  });
});
