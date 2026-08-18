/**
 * `llms.txt` and `llms.json` — the two files that tell a program what is on the site.
 *
 * These are projections of the manifest, so the tests are about the *projection*: that the URLs are
 * addressable wherever the site is deployed, that the two files agree with each other, and that the
 * rules the rest of the build already applies to a page — `noindex`, a draft article — are applied
 * here too rather than reinvented.
 */
import { describe, expect, it } from "vitest";
import { LLMS_JSON_VERSION, llmsJson, llmsTxt } from "../src/llms.js";
import type { Manifest, PageMeta } from "../src/types.js";

const page = (over: Partial<PageMeta> = {}): PageMeta => ({
  title: "Getting started",
  headings: [
    { id: "install", text: "Install", level: 2 },
    { id: "npm", text: "With npm", level: 3 },
    { id: "deep", text: "Too deep to be a place", level: 4 },
  ],
  breadcrumbs: [],
  description: "How to install it.",
  ...over,
});

const manifest = (over: Partial<Manifest["article"]> = {}, pages?: Manifest["pages"]): Manifest => ({
  article: {
    slug: "docs", title: "The Docs", form: "docs", status: "published", visibility: "public",
    tags: [], coverOn: "root", rootHref: "/", description: "Everything about the thing.",
    ...over,
  },
  nav: [],
  pages: pages ?? { "/": page(), "/guide/": page({ title: "Guide", headings: [] }) },
  figures: {},
  assets: [],
});

describe("llmsJson", () => {
  it("addresses every page and section absolutely when the site URL is known", () => {
    const json = llmsJson(manifest({ siteUrl: "https://example.com" }));
    expect(json.version).toBe(LLMS_JSON_VERSION);
    expect(json.pages.map((p) => p.url)).toEqual(["https://example.com/", "https://example.com/guide/"]);
    expect(json.pages[0]!.sections.map((s) => s.url)).toEqual([
      "https://example.com/#install", "https://example.com/#npm",
    ]);
    expect(json.manifest).toBe("https://example.com/_pagina/manifest.json");
    expect(json.search).toBe("https://example.com/_pagina/search.json");
  });

  it("carries `base` into every URL it writes", () => {
    const json = llmsJson(manifest({ siteUrl: "https://example.com" }), { base: "/docs/" });
    expect(json.base).toBe("/docs/");
    expect(json.pages[0]!.url).toBe("https://example.com/docs/");
    expect(json.pages[0]!.sections[0]!.url).toBe("https://example.com/docs/#install");
    expect(json.manifest).toBe("https://example.com/docs/_pagina/manifest.json");
  });

  it("falls back to site-absolute paths, never relative ones, when no origin is configured", () => {
    // A file whose whole purpose is to be fetched out of context must not contain a URL that
    // resolves against whatever the fetcher happened to be doing.
    const json = llmsJson(manifest(), { base: "/docs/" });
    expect(json.siteUrl).toBeUndefined();
    for (const url of [json.manifest, json.search!, ...json.pages.map((p) => p.url)]) {
      expect(url.startsWith("/docs/"), url).toBe(true);
    }
  });

  it("lists the levels that are places in the document, and no others", () => {
    // h2/h3 have anchors in the TOC and in the search index; an h4 is a paragraph with a bold line.
    const json = llmsJson(manifest());
    expect(json.pages[0]!.sections.map((s) => s.level)).toEqual([2, 3]);
  });

  it("honours `noindex` and a draft article, the way the sitemap does", () => {
    const hidden = llmsJson(manifest({}, { "/": page(), "/secret/": page({ noindex: true }) }));
    expect(hidden.pages.map((p) => p.href)).toEqual(["/"]);
    expect(llmsJson(manifest({ status: "draft" })).pages).toEqual([]);
  });

  it("leaves the search index out when the build wrote none", () => {
    expect(llmsJson(manifest(), { search: false }).search).toBeUndefined();
  });
});

describe("llmsTxt", () => {
  it("is the convention's shape: a title, a description, and a linked list", () => {
    const txt = llmsTxt(manifest({ siteUrl: "https://example.com" }));
    expect(txt.startsWith("# The Docs\n")).toBe(true);
    expect(txt).toContain("> Everything about the thing.");
    expect(txt).toContain("## Docs");
    expect(txt).toContain("- [Getting started](https://example.com/): How to install it.");
    expect(txt.endsWith("\n")).toBe(true);
  });

  it("points at the machine-readable half, at the same addresses the JSON does", () => {
    const opts = { base: "/docs/", siteUrl: "https://example.com" };
    const txt = llmsTxt(manifest(), opts);
    const json = llmsJson(manifest(), opts);
    expect(txt).toContain(`(https://example.com/docs/_pagina/llms.json)`);
    expect(txt).toContain(`(${json.manifest})`);
    expect(txt).toContain(`(${json.search!})`);
  });

  it("does not print the article's description after every link", () => {
    // Every page without a description of its own resolves to the article's, truncated on a word
    // boundary. Printed as a note it would say the same sentence nine times and nothing about any
    // of the nine pages; `llms.json` keeps it, because there it is a field with a name.
    const inherited = "Everything about the thing, at greater length than the cap allows for…";
    const txt = llmsTxt(manifest({ description: "Everything about the thing, at greater length than the cap allows for, and then some." }, {
      "/": page({ title: "Root", description: inherited }),
      "/own/": page({ title: "Own", description: "This page, specifically." }),
    }));
    expect(txt).toContain("- [Root](/)\n");
    expect(txt).toContain("- [Own](/own/): This page, specifically.");
  });

  it("says nothing it does not know", () => {
    const undescribed = manifest();
    const article = { ...undescribed.article };
    delete (article as { description?: string }).description;
    const txt = llmsTxt({ ...undescribed, article, pages: { "/": page({ description: "d" }) } });
    expect(txt).not.toContain(">");
    expect(txt).not.toContain("undefined");
  });
});
