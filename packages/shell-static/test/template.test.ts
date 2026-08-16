import { describe, expect, it } from "vitest";
import { renderPageHtml } from "../src/template.js";
import type { RenderedArticle } from "@pagina/core";

const article: RenderedArticle = {
  diagnostics: [],
  manifest: {
    article: { slug: "t", title: "T Docs", form: "docs", status: "published", visibility: "public", tags: [] },
    nav: [{ title: "Home", href: "/" }, { title: "G", children: [{ title: "Page", href: "/g/page/" }] }],
    pages: { "/": { title: "Home", headings: [], breadcrumbs: [{ title: "Home", href: "/" }], next: "/g/page/" }, "/g/page/": { title: "Page", headings: [{ id: "a", text: "A", level: 2 }], breadcrumbs: [{ title: "G" }, { title: "Page", href: "/g/page/" }], prev: "/" } },
    figures: {}, assets: [],
  },
  pages: { "/": { path: "index.md", href: "/", title: "Home", html: "<p>hi</p>", headings: [], figures: [], links: [] },
           "/g/page/": { path: "g/page.md", href: "/g/page/", title: "Page", html: "<h2 id=\"a\">A</h2>", headings: [{ id: "a", text: "A", level: 2 }], figures: [], links: [] } },
};
const ctx = { base: "/", dev: false, clientUrl: "/_pagina/pagina.js", cssUrl: "/_pagina/pagina.css", kineglyphRuntimeUrl: "/_pagina/kineglyph.js" };

const nastyTitle = 'A "quoted" & <b>title</b>';
const nastyArticle: RenderedArticle = {
  diagnostics: [],
  manifest: {
    article: { slug: "t", title: "T Docs", form: "docs", status: "published", visibility: "public", tags: [] },
    nav: [{ title: nastyTitle, href: '/g/q"uote/' }],
    pages: {
      "/": {
        title: nastyTitle,
        headings: [{ id: "h", text: nastyTitle, level: 2 }],
        breadcrumbs: [{ title: nastyTitle, href: '/g/q"uote/' }],
      },
    },
    figures: {}, assets: [],
  },
  pages: {
    "/": {
      path: "index.md", href: "/", title: nastyTitle, html: "<p>hi</p>",
      headings: [{ id: "h", text: nastyTitle, level: 2 }], figures: [], links: [],
    },
  },
};

describe("renderPageHtml", () => {
  it("emits import map, nav with current marker, toc, prev/next and content", () => {
    const html = renderPageHtml(article, "/g/page/", ctx);
    expect(html).toContain(`<script type="importmap">{"imports":{"kineglyph":"/_pagina/kineglyph.js"}}</script>`);
    expect(html).toContain(`<title>Page · T Docs</title>`);
    expect(html).toContain(`aria-current="page"`);
    expect(html).toContain(`href="/g/page/#a"`);          // toc
    expect(html).toContain(`rel="prev" href="/"`);
    expect(html).not.toContain(`rel="next"`);
    expect(html).toContain(`<h2 id="a">A</h2>`);
    expect(html).toContain(`data-pagina-theme-toggle`);
    expect(html).toContain(`<script type="module" src="/_pagina/pagina.js"></script>`);
  });

  it("escapes quotes/ampersands/tags inside attribute values", () => {
    const html = renderPageHtml(nastyArticle, "/", ctx);
    expect(html).not.toMatch(/href="[^"]*"[^"\s>]*"/);
    expect(html).toContain("A &quot;quoted&quot; &amp; &lt;b&gt;title&lt;/b&gt;");
    expect(html).toContain(`href="/g/q&quot;uote/"`);
  });
});
