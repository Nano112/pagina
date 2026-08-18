import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_VIEWER_URL, renderPageHtml } from "../src/template.js";
import type { RenderedArticle } from "@pagina/core";

const article: RenderedArticle = {
  diagnostics: [],
  manifest: {
    article: { slug: "t", title: "T Docs", form: "docs", status: "published", visibility: "public", tags: [], rootHref: "/", coverOn: "root" },
    nav: [{ title: "Home", href: "/" }, { title: "G", children: [{ title: "Page", href: "/g/page/" }] }],
    pages: { "/": { title: "Home", headings: [], breadcrumbs: [{ title: "Home", href: "/" }], next: "/g/page/" }, "/g/page/": { title: "Page", headings: [{ id: "a", text: "A", level: 2 }], breadcrumbs: [{ title: "G" }, { title: "Page", href: "/g/page/" }], prev: "/" } },
    figures: {}, assets: [],
  },
  pages: { "/": { path: "index.md", href: "/", title: "Home", html: "<p>hi</p>", headings: [], figures: [], links: [], frontMatter: {} },
           "/g/page/": { path: "g/page.md", href: "/g/page/", title: "Page", html: "<h2 id=\"a\">A</h2>", headings: [{ id: "a", text: "A", level: 2 }], figures: [], links: [], frontMatter: {} } },
};
const ctx = { base: "/", dev: false, clientUrl: "/_pagina/pagina.js", cssUrl: "/_pagina/pagina.css", kineglyphRuntimeUrl: "/_pagina/kineglyph.js" };

const nastyTitle = 'A "quoted" & <b>title</b>';
const nastyArticle: RenderedArticle = {
  diagnostics: [],
  manifest: {
    article: { slug: "t", title: "T Docs", form: "docs", status: "published", visibility: "public", tags: [], rootHref: "/", coverOn: "root" },
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
      headings: [{ id: "h", text: nastyTitle, level: 2 }], figures: [], links: [], frontMatter: {},
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

describe("SEO metadata and the cover", () => {
  /** The same article, with the metadata a real folder carries. */
  const withMeta: RenderedArticle = {
    ...article,
    manifest: {
      ...article.manifest,
      article: { ...article.manifest.article, siteUrl: "https://docs.example", author: "Ada", description: "The site." },
      pages: {
        ...article.manifest.pages,
        "/g/page/": {
          ...article.manifest.pages["/g/page/"]!,
          description: "A page.", cover: "/media/hero.png", author: "Ada",
          published: "2026-01-01", updated: "2026-02-02", tags: ["one"],
        },
      },
    },
  };

  it("puts pagina's metadata in the head of the page it belongs to", () => {
    const html = renderPageHtml(withMeta, "/g/page/", ctx);
    expect(html).toContain(`<title>Page · T Docs</title>`);
    expect(html).toContain(`<meta name="description" content="A page.">`);
    expect(html).toContain(`<meta property="og:type" content="article">`);
    expect(html).toContain(`<meta property="og:url" content="https://docs.example/g/page/">`);
    expect(html).toContain(`<meta property="og:image" content="https://docs.example/media/hero.png">`);
    expect(html).toContain(`<meta property="article:published_time" content="2026-01-01">`);
    expect(html).toContain(`<meta property="article:tag" content="one">`);
    expect(html).toContain(`<meta name="twitter:card" content="summary_large_image">`);
    expect(html).toContain(`<link rel="canonical" href="https://docs.example/g/page/">`);
    expect(html).toContain(`application/ld+json`);
  });

  /**
   * The article header, and the rule that a cover belongs to the *article*.
   *
   * `withMeta`'s cover sits on `/g/page/` — a sub-page — and its `rootHref` is `/`. So the
   * interesting assertions are the negative ones: the sub-page that *has* a cover still must not
   * draw a hero, because a reference page three levels into a docs article is not the front of it.
   */
  const rooted = (a: RenderedArticle, rootHref: string, coverOn: "root" | "all" | "none" = "root"): RenderedArticle => ({
    ...a,
    manifest: { ...a.manifest, article: { ...a.manifest.article, rootHref, coverOn } },
  });
  /** The same manifest, with the cover and the dates moved onto the landing page. */
  const onRoot: RenderedArticle = {
    ...withMeta,
    manifest: {
      ...withMeta.manifest,
      pages: {
        ...withMeta.manifest.pages,
        "/": {
          ...withMeta.manifest.pages["/"]!,
          cover: "/media/hero.png", coverAlt: "A hero", author: "Ada",
          published: "2026-01-01", readingMinutes: 7,
        },
      },
    },
  };

  it("renders the article header on the landing page and on no other", () => {
    const root = renderPageHtml(onRoot, "/", ctx);
    expect(root).toContain(`<header class="pg-article-header">`);
    expect(root).toContain(`<figure class="pg-cover"><img class="pg-cover__img" src="/media/hero.png"`);
    expect(root.indexOf("pg-article-header")).toBeLessThan(root.indexOf(`class="pg-content"`));

    // The sub-page has a cover of its own in the manifest and still must not draw the hero.
    const sub = renderPageHtml(onRoot, "/g/page/", ctx);
    expect(sub).not.toContain("pg-article-header");
    expect(sub).not.toContain("pg-cover");
  });

  it('follows cover_on: "all" and "none"', () => {
    expect(renderPageHtml(rooted(onRoot, "/", "all"), "/g/page/", ctx)).toContain("pg-article-header");
    expect(renderPageHtml(rooted(onRoot, "/", "none"), "/", ctx)).not.toContain("pg-article-header");
    // …and "none" leaves the page exactly as it was before the header existed.
    expect(renderPageHtml(rooted(onRoot, "/", "none"), "/", ctx)).not.toContain("pg-cover");
  });

  it("gives the cover alt text that is never empty and never the filename", () => {
    expect(renderPageHtml(onRoot, "/", ctx)).toContain(`alt="A hero"`);
    // No author-supplied alt: the article title, which is at least true about what it introduces.
    const withoutAlt = Object.fromEntries(
      Object.entries(onRoot.manifest.pages["/"]!).filter(([k]) => k !== "coverAlt"),
    ) as (typeof onRoot.manifest.pages)[string];
    const noAlt: RenderedArticle = {
      ...onRoot,
      manifest: { ...onRoot.manifest, pages: { ...onRoot.manifest.pages, "/": withoutAlt } },
    };
    const html = renderPageHtml(noAlt, "/", ctx);
    expect(html).toContain(`alt="T Docs"`);
    expect(html).not.toContain(`alt=""`);
    expect(html).not.toContain("hero.png\" alt=\"hero");
  });

  it("holds the layout still while the cover loads, and defers only what is not the LCP", () => {
    // No intrinsic size is knowable at build time, so `.pg-cover__img`'s aspect-ratio box is the
    // reflow guard; the landing page's cover is the LCP element and must not be lazy.
    expect(renderPageHtml(onRoot, "/", ctx)).toContain(`loading="eager"`);
    expect(renderPageHtml(rooted(onRoot, "/", "all"), "/g/page/", ctx)).toContain(`loading="lazy"`);
  });

  it("moves the page's own h1 into the header rather than printing a second one", () => {
    const withH1: RenderedArticle = {
      ...onRoot,
      pages: { ...onRoot.pages, "/": { ...onRoot.pages["/"]!, html: `<h1 id="home">Home</h1><p>hi</p>` } },
    };
    const html = renderPageHtml(withH1, "/", ctx);
    expect(html.match(/<h1/g)).toHaveLength(1);
    // Moved, not reprinted: the heading keeps its id, so a link to `#home` still lands.
    expect(html).toContain(`<header class="pg-article-header">`);
    expect(html).toContain(`<h1 id="home">Home</h1>`);
    expect(html).toContain(`<article class="pg-content"><p>hi</p></article>`);
  });

  it("falls back to the manifest title when the page does not open with a heading", () => {
    // `onRoot`'s `/` is `<p>hi</p>`.
    expect(renderPageHtml(onRoot, "/", ctx)).toContain(`<h1>Home</h1>`);
  });

  it("renders the meta row as date · author · reading time, dropping what is absent", () => {
    const html = renderPageHtml(onRoot, "/", ctx);
    expect(html).toContain(`<time class="pg-article-meta__item" datetime="2026-01-01">1 January 2026</time>`);
    expect(html).toContain(`<span class="pg-article-meta__item">Ada</span>`);
    expect(html).toContain(`<span class="pg-article-meta__item">7 min read</span>`);
    expect(html.match(/pg-article-meta__sep/g)).toHaveLength(2);
  });

  it("degrades to a header that is only a title when there is nothing else", () => {
    // No cover, no author, no dates, no prose: a title, and not an empty box with separators.
    const bare = renderPageHtml(article, "/", ctx);
    expect(bare).toContain(`<header class="pg-article-header"><h1>Home</h1></header>`);
    expect(bare).not.toContain("pg-article-meta");
    expect(bare).not.toContain("pg-cover");
  });

  it("keeps one separator between two items, not one per item", () => {
    const onlyAuthor: RenderedArticle = {
      ...article,
      manifest: {
        ...article.manifest,
        pages: { ...article.manifest.pages, "/": { ...article.manifest.pages["/"]!, author: "Ada", readingMinutes: 3 } },
      },
    };
    const html = renderPageHtml(onlyAuthor, "/", ctx);
    expect(html).toContain(`<p class="pg-article-meta"><span class="pg-article-meta__item">Ada</span><span class="pg-article-meta__sep" aria-hidden="true">·</span><span class="pg-article-meta__item">3 min read</span></p>`);
  });

  it("takes the site URL from the manifest when the builder did not pass one", () => {
    // A folder that declares `site_url` is complete on its own; a builder flag overrides it.
    expect(renderPageHtml(withMeta, "/", ctx)).toContain(`href="https://docs.example/"`);
    expect(renderPageHtml(withMeta, "/", { ...ctx, siteUrl: "https://other.example" }))
      .toContain(`href="https://other.example/"`);
  });

  it("omits the origin-dependent tags entirely when there is no site URL", () => {
    const html = renderPageHtml(article, "/g/page/", ctx);
    expect(html).not.toContain("canonical");
    expect(html).not.toContain("og:url");
    expect(html).not.toContain("undefined");
  });

  it("escapes an attack in the metadata without letting it reach the document", () => {
    const attack = `</script><script>alert(1)</script>" onload="alert(2)`;
    const nasty: RenderedArticle = {
      ...withMeta,
      manifest: {
        ...withMeta.manifest,
        pages: { ...withMeta.manifest.pages, "/g/page/": { ...withMeta.manifest.pages["/g/page/"]!, description: attack } },
      },
    };
    const html = renderPageHtml(nasty, "/g/page/", ctx);
    // The page has exactly its own scripts: the theme bootstrap, the import map, the JSON-LD
    // block and the client module. Nothing the description carried became a fifth.
    expect(html.match(/<script/gi)).toHaveLength(4);
    expect(html).not.toContain("<script>alert(1)");
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

describe("search", () => {
  const withSearch = { ...ctx, searchUrl: "/_pagina/search.json" };

  it("renders nothing at all when the build wrote no index", () => {
    const html = renderPageHtml(article, "/", ctx);
    expect(html).not.toContain("pg-search");
    expect(html).not.toContain("data-pg-search");
  });

  it("tells the client where the index is, and what base its hrefs are missing", () => {
    const html = renderPageHtml(article, "/", { ...withSearch, base: "/docs/" });
    expect(html).toContain(`data-pg-search="/_pagina/search.json"`);
    expect(html).toContain(`data-pg-base="/docs/"`);
  });

  it("renders the trigger disabled, so a page without script says so rather than lying", () => {
    // The client removes both attributes. Rendered enabled, a reader with scripting off gets a
    // button that looks live and does nothing — which is worse than no button.
    const html = renderPageHtml(article, "/", withSearch);
    expect(html).toContain(`data-pg-search-open disabled title="Search needs JavaScript"`);
    expect(html).toContain(`<kbd>/</kbd>`);
  });

  it("goes with the header when a host brings its own chrome", () => {
    // A host that suppressed pagina's header wants its own search control in its own bar; the
    // keys still work, and anything it marks `data-pg-search-open` is wired.
    const html = renderPageHtml(article, "/", { ...withSearch, chrome: false });
    expect(html).not.toContain("pg-search-trigger");
    expect(html).toContain(`data-pg-search="/_pagina/search.json"`);
  });
});
