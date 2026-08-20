/**
 * What the shell does differently for `form: blog` — which is three things and no more.
 *
 * The arrows are relabelled, the feed is announced, and the rail is absent when there is nothing to
 * put in it. Everything else on the page is the docs template unchanged, which is what makes this a
 * form rather than a second shell.
 */
import { describe, expect, it } from "vitest";
import { renderPageHtml } from "../src/template.js";
import type { RenderedArticle } from "@pagina/core";

const page = (path: string, href: string, title: string): RenderedArticle["pages"][string] =>
  ({ path, href, title, html: "<p>prose</p>", headings: [], figures: [], links: [], frontMatter: {} });

const blog: RenderedArticle = {
  diagnostics: [],
  manifest: {
    article: {
      slug: "notes", title: "Field Notes", form: "blog", status: "published", visibility: "public",
      tags: [], rootHref: "/", coverOn: "all", siteUrl: "https://notes.example",
    },
    nav: [],
    posts: ["/newest/", "/oldest/"],
    pages: {
      "/": { title: "Field Notes", headings: [], breadcrumbs: [{ title: "Field Notes", href: "/" }] },
      "/newest/": { title: "The newest one", headings: [], breadcrumbs: [{ title: "The newest one", href: "/newest/" }], next: "/oldest/", date: "2026-08-18", published: "2026-08-18" },
      "/oldest/": { title: "The oldest one", headings: [], breadcrumbs: [{ title: "The oldest one", href: "/oldest/" }], prev: "/newest/", date: "2026-05-11", published: "2026-05-11" },
    },
    figures: {}, assets: [],
  },
  pages: { "/": page("index.md", "/", "Field Notes"), "/newest/": page("newest.md", "/newest/", "The newest one"), "/oldest/": page("oldest.md", "/oldest/", "The oldest one") },
};
const ctx = { base: "/", dev: false, clientUrl: "/_pagina/pagina.js", cssUrl: "/_pagina/pagina.css", kineglyphRuntimeUrl: "/_pagina/kineglyph.js" };

const withNav = (a: RenderedArticle): RenderedArticle =>
  ({ ...a, manifest: { ...a.manifest, nav: [{ title: "About", href: "/about/" }] } });

describe("the shell, for a blog", () => {
  it("calls the pager Newer and Older, not Previous and Next", () => {
    const newest = renderPageHtml(blog, "/newest/", ctx);
    expect(newest).toContain(`rel="next" href="/oldest/"><span>Older</span>`);
    expect(newest).not.toContain("Previous");
    const oldest = renderPageHtml(blog, "/oldest/", ctx);
    expect(oldest).toContain(`rel="prev" href="/newest/"><span>Newer</span>`);
    expect(oldest).not.toContain(`rel="next"`);
  });

  it("still calls them Previous and Next for docs", () => {
    const docs: RenderedArticle = { ...blog, manifest: { ...blog.manifest, article: { ...blog.manifest.article, form: "docs" } } };
    expect(renderPageHtml(docs, "/newest/", ctx)).toContain(`<span>Next</span>`);
    expect(renderPageHtml(docs, "/newest/", ctx)).not.toContain(`<span>Older</span>`);
  });

  it("announces the feed on every page, which is how anybody subscribes", () => {
    for (const href of ["/", "/newest/"])
      expect(renderPageHtml(blog, href, ctx))
        .toContain(`<link rel="alternate" type="application/atom+xml" href="/feed.xml" title="Field Notes">`);
  });

  it("does not announce a feed no build wrote", () => {
    // The key is *removed* rather than set to `undefined`: this repository typechecks with
    // `exactOptionalPropertyTypes`, where those are two different manifests.
    const noSiteUrl = { ...blog.manifest.article };
    delete (noSiteUrl as { siteUrl?: string }).siteUrl;
    const noOrigin: RenderedArticle = { ...blog, manifest: { ...blog.manifest, article: noSiteUrl } };
    expect(renderPageHtml(noOrigin, "/", ctx)).not.toContain("atom+xml");
    const draft: RenderedArticle = { ...blog, manifest: { ...blog.manifest, article: { ...blog.manifest.article, status: "draft" } } };
    expect(renderPageHtml(draft, "/", ctx)).not.toContain("atom+xml");
    expect(renderPageHtml(blog, "/", { ...ctx, mirrorOf: "https://elsewhere.example/notes/" })).not.toContain("atom+xml");
    const docs: RenderedArticle = { ...blog, manifest: { ...blog.manifest, article: { ...blog.manifest.article, form: "docs" } } };
    expect(renderPageHtml(docs, "/", ctx)).not.toContain("atom+xml");
  });

  it("drops the rail rather than rendering an empty one, and keeps it when nav has entries", () => {
    const bare = renderPageHtml(blog, "/", ctx);
    expect(bare).toContain(`class="pg-shell pg-shell--no-nav"`);
    expect(bare).not.toContain(`<nav class="pg-nav" aria-label="Site">`);
    expect(bare).not.toContain("pg-nav-trigger");      // nothing for the mobile trigger to open
    expect(bare).not.toContain("pg-nav-modal");

    const standalone = renderPageHtml(withNav(blog), "/", ctx);
    expect(standalone).toContain(`<div class="pg-shell">`);
    expect(standalone).toContain(`<nav class="pg-nav" aria-label="Site">`);
    expect(standalone).toContain(`href="/about/"`);
    expect(standalone).toContain("pg-nav-trigger");
  });

  it("gives every post the header a blog post needs: its title and its date", () => {
    const html = renderPageHtml(blog, "/newest/", ctx);
    expect(html).toContain(`<header class="pg-article-header">`);
    expect(html).toContain(`<time class="pg-article-meta__item" datetime="2026-08-18">18 August 2026</time>`);
  });
});
