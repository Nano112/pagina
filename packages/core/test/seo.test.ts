/**
 * The metadata pagina emits, and the two ways it can be got wrong.
 *
 * **Escaping** is the first. Every value in a `<meta>` or a JSON-LD block is written by an author,
 * and an author is a person who can be phished into pasting a description. This project shipped a
 * script-injection defect on exactly this path once, so the tests here do not check "is escaped" —
 * they check that a deliberate break-out *fails*: the tags below carry `</script><script>`,
 * `"><img onerror>`, `<!--` and ``, and the assertions are that the document ends up with
 * with exactly the elements it was supposed to have and no others.
 *
 * **Absolute URLs** are the second. `canonical`, `og:url`, `og:image` and `sitemap.xml` are inert
 * or actively wrong when relative, so the rule is that they are *omitted* without a site URL and
 * the build warns — never emitted relative, and never as the string "undefined". Both branches are
 * asserted, on every tag, because the failure mode of the wrong choice is invisible.
 */
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX, absoluteUrl, escapeAttr, firstParagraph, jsonLdScript, pageSeo, renderSeoHtml,
  robotsTxt, sitemapXml, truncateWords,
} from "../src/seo.js";
import type { Manifest, PageMeta } from "../src/types.js";

const manifest = (article: Partial<Manifest["article"]> = {}, pages: Record<string, Partial<PageMeta>> = {}): Manifest => ({
  article: {
    slug: "a", title: "The Site", form: "docs", status: "published", visibility: "public", tags: [],
    ...article,
  },
  nav: [],
  pages: Object.fromEntries(
    Object.entries({ "/": {}, ...pages }).map(([href, meta]) => [
      href,
      { title: "A Page", headings: [], breadcrumbs: [], ...meta } as PageMeta,
    ]),
  ),
  figures: {},
  assets: [],
});

const contentOf = (html: string, key: string): string | undefined =>
  new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html)?.[1];

const jsonLdOf = (html: string): unknown => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  return m === null ? undefined : JSON.parse(m[1]!);
};

// -------------------------------------------------------------------------------- escaping

describe("escaping", () => {
  it("escapes every character that can leave an attribute", () => {
    expect(escapeAttr(`a"b'c<d>e&f`)).toBe("a&quot;b&#39;c&lt;d&gt;e&amp;f");
  });

  it("cannot be broken out of an attribute by a crafted title", () => {
    const attack = `x" onload="alert(1)`;
    const seo = pageSeo(manifest({}, { "/": { title: attack } }), "/");
    const html = renderSeoHtml(seo);
    // The quote that would have closed the attribute is `&quot;`, so `onload` never becomes one.
    expect(html).not.toMatch(/content="[^"]*"\s*onload/);
    expect(contentOf(html, "og:title")).toBe("x&quot; onload=&quot;alert(1)");
    expect(html.match(/<[a-zA-Z/][^>]*>/g)).toHaveLength(seo.meta.length + 4);   // no extra element
  });

  it("cannot be broken out of the JSON-LD block by `</script>`", () => {
    const attack = `</script><script>alert(1)</script>`;
    const html = renderSeoHtml(pageSeo(manifest({ description: attack }), "/"));
    // One script element in the whole output, and it is the JSON-LD one. `alert(1)` appears as
    // *text* inside escaped values, which is inert; what must not exist is a second `<script`
    // or a `</script>` that closes the block early.
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(html).not.toContain("<script>alert(1)");
    expect(jsonLdOf(html)).toMatchObject({ description: attack });   // …but the value survives intact
  });

  it("neutralises `<!--`, which changes how raw text is scanned", () => {
    const html = jsonLdScript({ d: `<!--<script>x</script>` });
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("<script>x");
    expect(JSON.parse(/>([\s\S]*)</.exec(html)![1]!)).toEqual({ d: `<!--<script>x</script>` });
  });

  it("escapes the JSON-level characters rather than HTML-escaping them", () => {
    // HTML escapes are not decoded inside a `script`, so `&lt;` there would be a literal `&lt;`
    // in the parsed JSON — the value would be corrupted rather than merely safe.
    const html = jsonLdScript({ d: "a<b>c&d" });
    expect(html).not.toContain("&lt;");
    expect(html).not.toContain("&amp;");
    expect(html).toContain("\\u003c");
    expect(JSON.parse(/>([\s\S]*)</.exec(html)![1]!)).toEqual({ d: "a<b>c&d" });
  });

  it("escapes U+2028/U+2029, which are legal JSON but illegal JavaScript", () => {
    const raw = `a\u2028b\u2029c`;
    const html = jsonLdScript({ d: raw });
    expect(html).not.toContain("\u2028");
    expect(html).not.toContain("\u2029");
    expect(html).toContain("\\u2028");
    expect(JSON.parse(/>([\s\S]*)</.exec(html)![1]!)).toEqual({ d: raw });
  });

  it("survives an attack in every field at once", () => {
    const attack = `</script><script>alert(1)</script>" onload="alert(2)`;
    const m = manifest(
      { title: attack, description: attack, author: attack, tags: [attack], siteUrl: "https://x.test" },
      { "/": { title: attack, description: attack, author: attack, tags: [attack], cover: "/c.png" } },
    );
    const seo = pageSeo(m, "/");
    const html = renderSeoHtml(seo);
    // The structural invariant: the document contains **exactly** the elements it meant to, and
    // the attack contributed none. Every `<` the payload carries came out as `&lt;` or `\u003c`,
    // so a raw-tag count is the whole proof — a substring check cannot tell an inert `onload=`
    // inside an escaped value from a live attribute, and this can.
    const rawTags = html.match(/<[a-zA-Z/][^>]*>/g) ?? [];
    expect(rawTags).toHaveLength(seo.meta.length + 5);   // <title></title>, <link>, <script></script>
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(jsonLdOf(html)).toMatchObject({ headline: attack, description: attack });
  });
});

// ------------------------------------------------------------------- the description chain

describe("the description", () => {
  it("truncates on a word boundary, ellipsis included in the budget", () => {
    const long = `${"alpha ".repeat(40)}omega`;
    const out = truncateWords(long);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/alp…$/);                  // never mid-word
    expect(out.slice(0, -1).trimEnd().split(" ").every((w) => w === "alpha")).toBe(true);
  });

  it("leaves a short description exactly as it was", () => {
    expect(truncateWords("Short and sweet.")).toBe("Short and sweet.");
  });

  it("collapses whitespace rather than emitting a newline into an attribute", () => {
    expect(truncateWords(" a \n b\tc ")).toBe("a b c");
  });

  it("cuts a single over-long word where it must, since there is no boundary", () => {
    const out = truncateWords("x".repeat(300));
    expect(out.length).toBe(DESCRIPTION_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not strip a trailing full stop that is inside the budget", () => {
    expect(truncateWords("Ends here.")).toBe("Ends here.");
  });
});

describe("the first paragraph", () => {
  it("is the opening prose, tags stripped and entities decoded", () => {
    expect(firstParagraph(`<h1>T</h1>\n<p>Hello <em>there</em> &amp; welcome.</p>`)).toBe("Hello there & welcome.");
  });

  it("skips an admonition, which is not the article's own opening line", () => {
    const html = `<aside class="pg-admonition"><p class="pg-admonition__title">Note</p>\n<p>Careful.</p></aside>\n<p>The real opening.</p>`;
    expect(firstParagraph(html)).toBe("The real opening.");
  });

  it("skips a tab group, nested divs and all", () => {
    const html = `<div class="pg-tabs" data-pg-tabs><div class="pg-tabs__list"></div><section><p>In a tab.</p></section></div>\n<p>After the tabs.</p>`;
    expect(firstParagraph(html)).toBe("After the tabs.");
  });

  it("skips an empty paragraph rather than reporting one", () => {
    expect(firstParagraph(`<p>  </p><p>Real.</p>`)).toBe("Real.");
  });

  it("is undefined for a page with no prose at all", () => {
    expect(firstParagraph(`<h1>T</h1><ul><li>a</li></ul>`)).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------ the tags

describe("pageSeo", () => {
  const full = manifest(
    {
      title: "The Site", description: "Article-level.", author: "Ada", tags: ["one", "two"],
      siteUrl: "https://docs.example", published: "2026-01-01T00:00:00.000Z", updated: "2026-02-02T00:00:00.000Z",
    },
    { "/g/": { title: "A Page", description: "Page-level.", cover: "/media/c.png" } },
  );

  it("emits every tag the design asks for", () => {
    const seo = pageSeo(full, "/g/");
    const by = (key: string): string | undefined => seo.meta.find((t) => (t.name ?? t.property) === key)?.content;
    expect(seo.title).toBe("A Page · The Site");
    expect(by("description")).toBe("Page-level.");
    expect(by("og:type")).toBe("article");
    expect(by("og:site_name")).toBe("The Site");
    expect(by("og:title")).toBe("A Page");
    expect(by("og:description")).toBe("Page-level.");
    expect(by("og:url")).toBe("https://docs.example/g/");
    expect(by("og:image")).toBe("https://docs.example/media/c.png");
    expect(by("article:published_time")).toBe("2026-01-01T00:00:00.000Z");
    expect(by("article:modified_time")).toBe("2026-02-02T00:00:00.000Z");
    expect(by("article:author")).toBe("Ada");
    expect(seo.meta.filter((t) => t.property === "article:tag").map((t) => t.content)).toEqual(["one", "two"]);
    expect(by("twitter:card")).toBe("summary_large_image");
    expect(by("twitter:title")).toBe("A Page");
    expect(by("twitter:description")).toBe("Page-level.");
    expect(by("twitter:image")).toBe("https://docs.example/media/c.png");
    expect(seo.canonical).toBe("https://docs.example/g/");
  });

  it("emits a JSON-LD Article with the fields a crawler reads", () => {
    expect(pageSeo(full, "/g/").jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "A Page",
      description: "Page-level.",
      image: ["https://docs.example/media/c.png"],
      datePublished: "2026-01-01T00:00:00.000Z",
      dateModified: "2026-02-02T00:00:00.000Z",
      author: { "@type": "Person", name: "Ada" },
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://docs.example/g/" },
    });
  });

  it("falls back to a summary card when there is no cover", () => {
    const seo = pageSeo(manifest({ siteUrl: "https://x.test" }), "/");
    expect(seo.meta.find((t) => t.name === "twitter:card")?.content).toBe("summary");
    expect(seo.meta.some((t) => t.property === "og:image")).toBe(false);
  });

  it("does not repeat the article title when a page carries it", () => {
    expect(pageSeo(manifest({}, { "/": { title: "The Site" } }), "/").title).toBe("The Site");
  });

  it("prefixes hrefs with base when the site is served under one", () => {
    const seo = pageSeo(manifest({ siteUrl: "https://x.test" }, { "/g/": {} }), "/g/", { base: "/docs/" });
    expect(seo.canonical).toBe("https://x.test/docs/g/");
  });

  it("ignores any path in the site URL, because base already carries it", () => {
    const seo = pageSeo(manifest({ siteUrl: "https://x.test/docs" }, { "/g/": {} }), "/g/", { base: "/docs/" });
    expect(seo.canonical).toBe("https://x.test/docs/g/");
  });
});

describe("without a site URL", () => {
  const m = manifest({ description: "D" }, { "/": { cover: "/media/c.png" } });

  it("omits every tag that needs an origin — and never emits `undefined`", () => {
    const seo = pageSeo(m, "/");
    const html = renderSeoHtml(seo);
    expect(seo.canonical).toBeUndefined();
    expect(html).not.toContain("rel=\"canonical\"");
    expect(html).not.toContain("og:url");
    expect(html).not.toContain("og:image");
    expect(html).not.toContain("twitter:image");
    expect(html).not.toContain("undefined");
    expect(seo.jsonLd["mainEntityOfPage"]).toBeUndefined();
    expect(seo.jsonLd["image"]).toBeUndefined();
  });

  it("still emits everything that is meaningful without one", () => {
    const html = renderSeoHtml(pageSeo(m, "/"));
    expect(html).toContain("<title>A Page · The Site</title>");
    expect(contentOf(html, "description")).toBe("D");
    expect(contentOf(html, "og:title")).toBe("A Page");
    expect(contentOf(html, "twitter:card")).toBe("summary");
  });

  it("says so, rather than failing silently", () => {
    expect(pageSeo(m, "/").diagnostics.map((d) => d.code)).toEqual(["seo-no-site-url"]);
    expect(pageSeo(manifest({ siteUrl: "https://x.test" }), "/").diagnostics).toEqual([]);
  });

  it("keeps a cover the author gave as an absolute URL, since it needs no origin", () => {
    const seo = pageSeo(manifest({}, { "/": { cover: "https://cdn.test/c.png" } }), "/");
    expect(seo.meta.find((t) => t.property === "og:image")?.content).toBe("https://cdn.test/c.png");
    expect(seo.meta.find((t) => t.name === "twitter:card")?.content).toBe("summary_large_image");
  });
});

describe("absoluteUrl", () => {
  it("joins a site-absolute path onto an origin", () => {
    expect(absoluteUrl("/a/b/", "https://x.test")).toBe("https://x.test/a/b/");
  });
  it("passes an already-absolute URL straight through", () => {
    expect(absoluteUrl("https://cdn.test/x.png", undefined)).toBe("https://cdn.test/x.png");
  });
  it("is undefined without an origin, and for a site URL that is not one", () => {
    expect(absoluteUrl("/a/", undefined)).toBeUndefined();
    expect(absoluteUrl("/a/", "not a url")).toBeUndefined();
  });
});

// -------------------------------------------------------------------- noindex, sitemap, robots

describe("noindex", () => {
  it("is on for every page of a draft article", () => {
    const seo = pageSeo(manifest({ status: "draft", siteUrl: "https://x.test" }), "/");
    expect(seo.noindex).toBe(true);
    expect(seo.meta.find((t) => t.name === "robots")?.content).toBe("noindex, nofollow");
  });

  it("is on for a page that asked for it, in a published article", () => {
    const m = manifest({ siteUrl: "https://x.test" }, { "/secret/": { noindex: true } });
    expect(pageSeo(m, "/secret/").noindex).toBe(true);
    expect(pageSeo(m, "/").noindex).toBe(false);
    expect(renderSeoHtml(pageSeo(m, "/"))).not.toContain('name="robots"');
  });
});

describe("sitemap.xml", () => {
  const m = manifest(
    { siteUrl: "https://x.test", updated: "2026-01-01" },
    { "/g/": { updated: "2026-03-03" }, "/secret/": { noindex: true } },
  );

  it("lists every indexable page, absolutely, with its own lastmod", () => {
    const xml = sitemapXml(m)!;
    expect(xml).toContain("<loc>https://x.test/</loc>");
    expect(xml).toContain("<loc>https://x.test/g/</loc>");
    expect(xml).toContain("<lastmod>2026-03-03</lastmod>");
    expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
  });

  it("leaves out a noindex page, because a sitemap is a request to index", () => {
    expect(sitemapXml(m)).not.toContain("/secret/");
  });

  it("is not written at all for a draft, or without a site URL", () => {
    expect(sitemapXml(manifest({ siteUrl: "https://x.test", status: "draft" }))).toBeUndefined();
    expect(sitemapXml(manifest({}))).toBeUndefined();
  });

  it("escapes a URL that contains an ampersand", () => {
    const weird = manifest({ siteUrl: "https://x.test" }, { "/a&b/": {} });
    expect(sitemapXml(weird)).toContain("&amp;");
    expect(sitemapXml(weird)).not.toMatch(/&(?!amp;|#)/);
  });
});

describe("robots.txt", () => {
  it("allows everything and points at the sitemap for a published article", () => {
    const txt = robotsTxt(manifest({ siteUrl: "https://x.test" }));
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://x.test/sitemap.xml");
  });

  it("disallows everything for a draft — before a crawler has read any page", () => {
    expect(robotsTxt(manifest({ status: "draft", siteUrl: "https://x.test" }))).toBe("User-agent: *\nDisallow: /\n");
  });

  it("omits the Sitemap line rather than writing a relative one", () => {
    const txt = robotsTxt(manifest({}));
    expect(txt).not.toContain("Sitemap");
    expect(txt).not.toContain("undefined");
  });

  it("addresses the sitemap through base", () => {
    expect(robotsTxt(manifest({ siteUrl: "https://x.test" }), { base: "/docs/" })).toContain("https://x.test/docs/sitemap.xml");
  });
});

describe("renderSeoHtml", () => {
  it("uses `property` for OpenGraph and `name` for everything else", () => {
    const html = renderSeoHtml(pageSeo(manifest({ description: "D" }), "/"));
    expect(html).toContain(`<meta property="og:type" content="article">`);
    expect(html).toContain(`<meta name="description" content="D">`);
  });

  it("emits exactly one title and one JSON-LD block", () => {
    const html = renderSeoHtml(pageSeo(manifest({ siteUrl: "https://x.test" }), "/"));
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(html).toContain(`<link rel="canonical" href="https://x.test/">`);
  });

  it("throws for a page the manifest does not have, rather than emitting a blank head", () => {
    expect(() => pageSeo(manifest({}), "/nope/")).toThrow(/no page/);
  });
});
