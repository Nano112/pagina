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
});
