import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_VIEWER_URL, renderPageHtml } from "../src/template.js";
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

  it("offers an Edit this page link only under `edit`, and never in a build", () => {
    expect(renderPageHtml(article, "/g/page/", ctx)).not.toContain("Edit this page");
    const editing = renderPageHtml(article, "/g/page/", { ...ctx, dev: true, edit: true });
    expect(editing).toContain(`<a class="pg-header__edit" href="/__edit/g/page/">Edit this page</a>`);
  });

  it("JSON-escapes the import-map URL instead of HTML-escaping it", () => {
    // `<script>` is raw text: HTML entities are not decoded there, so `&quot;` would land in
    // the JSON verbatim and break the import map. Only `</script` needs neutralising.
    const html = renderPageHtml(article, "/", { ...ctx, kineglyphRuntimeUrl: `/a"b\\c</script>d.js` });
    expect(html).toContain(`{"imports":{"kineglyph":"/a\\"b\\\\c<\\/script>d.js"}}`);
    expect(html).not.toContain("&quot;");
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(map)).toEqual({ imports: { kineglyph: `/a"b\\c</script>d.js` } });
  });

  it("escapes quotes/ampersands/tags inside attribute values", () => {
    const html = renderPageHtml(nastyArticle, "/", ctx);
    expect(html).not.toMatch(/href="[^"]*"[^"\s>]*"/);
    expect(html).toContain("A &quot;quoted&quot; &amp; &lt;b&gt;title&lt;/b&gt;");
    expect(html).toContain(`href="/g/q&quot;uote/"`);
  });
});

describe("theme levels and chrome", () => {
  const link = /<link rel="stylesheet" href="([^"]*)">/g;
  const links = (html: string) => [...html.matchAll(link)].map((m) => m[1]);

  it("links the full sheet by default", () => {
    expect(links(renderPageHtml(article, "/", ctx))).toEqual(["/_pagina/pagina.css"]);
  });

  it('links the tokens sheet, and not the full one, at theme "tokens"', () => {
    const html = renderPageHtml(article, "/", { ...ctx, theme: "tokens", tokensCssUrl: "/_pagina/pagina.tokens.css" });
    expect(links(html)).toEqual(["/_pagina/pagina.tokens.css"]);
    expect(html).not.toContain("/_pagina/pagina.css");
  });

  it("derives the tokens sheet from the full one when the builder did not say", () => {
    // Every pagina build emits the pair side by side, so the fallback is the layout, not a guess.
    expect(links(renderPageHtml(article, "/", { ...ctx, theme: "tokens" }))).toEqual(["/_pagina/pagina.tokens.css"]);
    expect(links(renderPageHtml(article, "/", { ...ctx, theme: "tokens", base: "/docs/", cssUrl: "/docs/_pagina/pagina.css" })))
      .toEqual(["/docs/_pagina/pagina.tokens.css"]);
  });

  it('links no stylesheet at all at theme "none"', () => {
    const html = renderPageHtml(article, "/", { ...ctx, theme: "none" });
    expect(links(html)).toEqual([]);
    // Structure is still the contract: the class names and the markup are all there.
    expect(html).toContain(`class="pg-content"`);
    expect(html).toContain(`class="pg-shell"`);
  });

  it("keeps every theme level on the same markup", () => {
    const strip = (html: string) => html.replace(link, "");
    expect(strip(renderPageHtml(article, "/g/page/", { ...ctx, theme: "tokens" })))
      .toBe(strip(renderPageHtml(article, "/g/page/", ctx)));
    expect(strip(renderPageHtml(article, "/g/page/", { ...ctx, theme: "none" })))
      .toBe(strip(renderPageHtml(article, "/g/page/", ctx)));
  });

  it("omits pagina's header — and only its header — under chrome: false", () => {
    const html = renderPageHtml(article, "/g/page/", { ...ctx, chrome: false });
    expect(html).not.toContain("pg-header");
    expect(html).not.toContain("data-pagina-theme-toggle");
    // The sidebar, TOC and pager are the article's own navigation and stay.
    expect(html).toContain(`class="pg-nav"`);
    expect(html).toContain(`class="pg-toc"`);
    expect(html).toContain(`class="pg-pager"`);
  });
});

describe("the <model-viewer> module", () => {
  /** The same article with a 3-D model on one of its two pages. */
  const withModel: RenderedArticle = {
    ...article,
    pages: {
      ...article.pages,
      "/g/page/": {
        ...article.pages["/g/page/"]!,
        html: `<model-viewer src="/media/robot.glb" alt="A robot"></model-viewer>`,
      },
    },
  };

  it("is included only on a page that actually contains one", () => {
    // Several hundred kilobytes of WebGL: a docs site with one model on one page must not pay for
    // it on every other page, so presence of the tag is the whole condition.
    expect(renderPageHtml(withModel, "/g/page/", ctx)).toContain(
      `<script type="module" src="${DEFAULT_MODEL_VIEWER_URL}"></script>`,
    );
    expect(renderPageHtml(withModel, "/", ctx)).not.toContain("model-viewer");
    expect(renderPageHtml(article, "/g/page/", ctx)).not.toContain("model-viewer");
  });

  it("can be pointed at a self-hosted copy", () => {
    const html = renderPageHtml(withModel, "/g/page/", { ...ctx, modelViewerUrl: "/vendor/model-viewer.js" });
    expect(html).toContain(`<script type="module" src="/vendor/model-viewer.js"></script>`);
    expect(html).not.toContain(DEFAULT_MODEL_VIEWER_URL);
  });
});
