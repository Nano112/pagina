import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { renderArticle } from "../src/render-article.js";
import {
  SEARCH_INDEX_VERSION, buildSearchIndex, parseSearchIndex, searchIndex, serializeSearchIndex,
  svgProse, text, tokenize,
} from "../src/search.js";
import type { ContentFs, RenderedArticle } from "../src/types.js";

function nodeFs(root: string): ContentFs {
  const abs = (p: string) => resolve(root, p);
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [relative(root, f).split("\\").join("/")]; });
  return {
    read: async (p) => readFileSync(abs(p), "utf8"),
    readBinary: async (p) => new Uint8Array(readFileSync(abs(p))),
    exists: async (p) => existsSync(abs(p)),
    list: async (d) => walk(abs(d)),
  };
}
const fixture = new URL("./fixture/", import.meta.url).pathname;

/** A minimal article, so a scoring claim can be about two sentences rather than about a fixture. */
function article(pages: Record<string, { title: string; html: string; description?: string }>): RenderedArticle {
  const hrefs = Object.keys(pages);
  return {
    manifest: {
      article: {
        slug: "t", title: "Test article", form: "docs", status: "published", visibility: "public",
        tags: [], coverOn: "root", snippets: { roots: ["."] }, rootHref: hrefs[0]!,
      },
      nav: hrefs.map((h) => ({ title: pages[h]!.title, href: h })),
      pages: Object.fromEntries(hrefs.map((h) => [h, {
        title: pages[h]!.title, headings: [], breadcrumbs: [],
        ...(pages[h]!.description === undefined ? {} : { description: pages[h]!.description }),
      }])),
      figures: {},
      assets: [],
    },
    pages: Object.fromEntries(hrefs.map((h) => [h, {
      path: `${h}.md`, href: h, title: pages[h]!.title, html: pages[h]!.html,
      headings: [], figures: [], links: [], frontMatter: {},
    }])),
    diagnostics: [],
  } as unknown as RenderedArticle;
}

describe("text extraction", () => {
  it("makes a block boundary a word boundary", () => {
    expect(text("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("decodes the entities a markdown renderer emits", () => {
    expect(text("<p>a &amp; b &mdash; &#8230; &#x2192;</p>")).toBe("a & b — … →");
  });

  it("drops script and style, which are markup's business and not the reader's", () => {
    expect(text(`<p>real</p><script>var stolen=1</script><style>.x{color:red}</style>`)).toBe("real");
  });

  it("reads a figure's title and desc, and nothing else inside the svg", () => {
    const svg = `<svg><title>How a build flows</title><desc>Folder in, site out.</desc><text>x1</text><path d="M0 0"/></svg>`;
    expect(svgProse(svg)).toBe("How a build flows Folder in, site out.");
    // The axis labels and the path data are not prose, and the whole subtree is dropped from body.
    expect(text(`<p>before</p>${svg}<p>after</p>`)).toBe("before after");
  });
});

describe("tokenize", () => {
  it("splits on anything that is not a letter or a digit", () => {
    expect(tokenize("site_url, pre-render.js")).toEqual(["site", "url", "pre", "render", "js"]);
  });

  it("yields a camelCase identifier's parts as well as the whole run", () => {
    expect(tokenize("buildSearchIndex")).toEqual(["buildsearchindex", "build", "search", "index"]);
  });

  it("keeps digits attached to the word they were written in", () => {
    expect(tokenize("h2 sha256")).toEqual(["h2", "sha256"]);
  });
});

describe("buildSearchIndex", () => {
  const a = article({
    "/": {
      title: "What pagina is", description: "A static-docs renderer for folders of markdown.",
      html: `<h1 id="what-pagina-is">What pagina is</h1><p>A folder is the whole article.</p>
<h2 id="theming">Theming</h2><p>Everything is a custom property, named <code>--pg-accent</code>.</p>
<h3 id="tokens">Tokens</h3><p>The tokens sheet is the contract a host overrides.</p>`,
    },
    "/deploying/": {
      title: "Deploying",
      html: `<h1 id="deploying">Deploying</h1><p>GitHub Pages serves the output directory.</p>
<h2 id="a-base-path">A base path</h2><p>Pass <code>--base /docs/</code> so every URL is prefixed.</p>
<svg><title>The deploy pipeline</title><desc>Folder to bundle to host.</desc></svg>`,
    },
  });
  const index = buildSearchIndex(a);

  it("makes a document per section, not per page", () => {
    expect(index.docs.map((d) => [d.h, d.a, d.t])).toEqual([
      ["/", undefined, "What pagina is"],
      ["/", "theming", "Theming"],
      ["/", "tokens", "Tokens"],
      ["/deploying/", undefined, "Deploying"],
      ["/deploying/", "a-base-path", "A base path"],
    ]);
  });

  it("puts the page's resolved description on its lead document only", () => {
    expect(index.docs[0]!.d).toBe("A static-docs renderer for folders of markdown.");
    expect(index.docs[1]!.d).toBeUndefined();
  });

  it("indexes a figure's description, which is the part of a diagram a text indexer cannot read", () => {
    const hit = searchIndex(index, "pipeline")[0];
    expect(hit?.href).toBe("/deploying/");
    expect(index.docs[4]!.f).toBe("The deploy pipeline Folder to bundle to host.");
  });

  it("serialises to something a reader can parse, and refuses a version it does not know", () => {
    const round = parseSearchIndex(serializeSearchIndex(index));
    expect(round.docs).toEqual(index.docs);
    expect(round.v).toBe(SEARCH_INDEX_VERSION);
    expect(() => parseSearchIndex(`{"v":99,"docs":[],"terms":[],"post":[]}`)).toThrow(/version 99/);
    expect(() => parseSearchIndex(`{"v":1,"docs":[],"terms":["a"],"post":[]}`)).toThrow(/disagree/);
  });

  it("leaves out the pages it was told to exclude", () => {
    const partial = buildSearchIndex(a, { exclude: ["/deploying/"] });
    expect(new Set(partial.docs.map((d) => d.h))).toEqual(new Set(["/"]));
    expect(searchIndex(partial, "github")).toEqual([]);
  });

  it("delta-encodes postings, so the file is mostly one- and two-digit numbers", () => {
    const at = index.terms.indexOf("the");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(index.post[at]!.every((d) => d >= 0)).toBe(true);
    // Deltas, decoded, must be strictly ascending document ids.
    let id = 0;
    const ids = index.post[at]!.map((d) => (id += d));
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("searchIndex", () => {
  const a = article({
    "/": {
      title: "Theming",
      html: `<h1 id="theming">Theming</h1><p>An overview.</p>
<h2 id="tokens">Tokens</h2><p>Every colour pagina paints is a custom property.</p>`,
    },
    "/other/": {
      title: "Deploying",
      html: `<h1 id="deploying">Deploying</h1><p>Theming is mentioned here once, in passing.</p>`,
    },
  });
  const index = buildSearchIndex(a);

  it("puts a title match above a body mention of the same word", () => {
    const hits = searchIndex(index, "theming");
    expect(hits[0]!.href).toBe("/");
    expect(hits[0]!.title).toBe("Theming");
  });

  it("treats the last token as a prefix, because the reader is still typing it", () => {
    expect(searchIndex(index, "them").map((h) => h.title)).toContain("Theming");
    // A finished token is the word it spells, not everything starting with it.
    expect(searchIndex(index, "them ")).toEqual([]);
  });

  it("requires every token to match — two words narrow, they do not widen", () => {
    expect(searchIndex(index, "tokens colour").map((h) => h.title)).toEqual(["Tokens"]);
    expect(searchIndex(index, "tokens nonesuch")).toEqual([]);
  });

  it("returns nothing for a query with no word in it", () => {
    expect(searchIndex(index, "   ")).toEqual([]);
    expect(searchIndex(index, "!!!")).toEqual([]);
  });

  it("marks the match inside the snippet rather than handing back HTML", () => {
    const hit = searchIndex(index, "custom")[0]!;
    expect(hit.snippet.filter((p) => p.mark).map((p) => p.text)).toEqual(["custom"]);
    expect(hit.snippet.map((p) => p.text).join("")).toContain("Every colour pagina paints");
  });

  it("highlights the whole word a prefix began, never half of one", () => {
    const hit = searchIndex(index, "prop")[0]!;
    expect(hit.snippet.filter((p) => p.mark).map((p) => p.text)).toEqual(["property"]);
  });

  it("carries the anchor, so a result lands on the section and not the top of the page", () => {
    expect(searchIndex(index, "tokens")[0]!.anchor).toBe("tokens");
  });

  it("honours the limit", () => {
    expect(searchIndex(index, "the", { limit: 1 }).length).toBeLessThanOrEqual(1);
  });
});

describe("over the fixture article", () => {
  it("indexes every page and answers a question about one of them", async () => {
    const rendered = await renderArticle({ fs: nodeFs(fixture), strict: true });
    const index = buildSearchIndex(rendered);
    expect(new Set(index.docs.map((d) => d.h))).toEqual(new Set(Object.keys(rendered.pages)));
    // Every document names a page that exists and an anchor that is a heading on it.
    for (const doc of index.docs) {
      expect(rendered.manifest.pages[doc.h]).toBeDefined();
      if (doc.a !== undefined) {
        expect(rendered.pages[doc.h]!.headings.map((h) => h.id)).toContain(doc.a);
      }
    }
    const hits = searchIndex(index, "tabs");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.href).toBe("/guide/tabs/");
  });
});
