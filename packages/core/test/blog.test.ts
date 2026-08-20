/**
 * @vitest-environment jsdom
 *
 * The blog form — the tests only it can fail.
 *
 * Everything a blog shares with a docs article (markdown, figures, covers, reading time, search,
 * cards, bundles) is already covered by the suites that cover it for docs, and all of those still
 * pass unchanged, which is half the argument for a form rather than a fork. What is left is the
 * set of claims that are new: an order taken from dates, a draft that is built and not announced,
 * arrows that point the other way, `nav` meaning something different, and a feed that parses.
 *
 * The feed is **parsed**, not matched against a string. A feed that "contains `<entry>`" can still
 * be a document no reader will accept, and looking at XML and deciding it seems fine is exactly how
 * an unparseable feed ships. That is what the jsdom environment above is for: a real XML parser,
 * reached through `DOMParser`, which needs no dependency this repository does not already have.
 */
import { describe, expect, it } from "vitest";
import { renderArticle, PaginaBuildError } from "../src/render-article.js";
import { parseArticleConfig } from "../src/config.js";
import { feedXml, feedUrl } from "../src/feed.js";
import { sitemapXml } from "../src/seo.js";
import type { ContentFs } from "../src/types.js";

function memFs(files: Readonly<Record<string, string>>): ContentFs {
  return {
    read: async (p) => {
      const text = files[p];
      if (text === undefined) throw new Error(`no such file: ${p}`);
      return text;
    },
    readBinary: async (p) => new TextEncoder().encode(files[p] ?? ""),
    exists: async (p) => Object.hasOwn(files, p),
    list: async () => Object.keys(files),
  };
}

const YAML = [
  "slug: notes",
  "title: Field Notes",
  "form: blog",
  "status: published",
  "site_url: https://notes.example",
  "author: A Writer",
  "description: Notes from the field.",
  "nav:",
  "  - title: About",
  "    page: about.md",
  "",
].join("\n");

/** Three posts with different dates, one draft, one standalone page, in no useful file order. */
const BLOG: Record<string, string> = {
  "article.yaml": YAML,
  "index.md": "# Field Notes\n\nThings worth writing down.\n",
  "about.md": "# About\n\nWho writes this and why.\n",
  "middle.md": "---\ndate: 2026-07-02\ndescription: The middle one.\n---\n# The middle one\n\nSome prose.\n",
  "newest.md": "---\ndate: 2026-08-18\n---\n# The newest one\n\nSome prose.\n",
  "oldest.md": "---\ndate: 2026-05-11\ntags: [logs]\n---\n# The oldest one\n\nSome prose.\n",
  "hidden.md": "---\ndate: 2026-08-19\ndraft: true\n---\n# Not finished\n\nSome prose.\n",
};

const blog = (over: Record<string, string | undefined> = {}): ContentFs => {
  const files: Record<string, string> = { ...BLOG };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete files[k];
    else files[k] = v;
  }
  return memFs(files);
};

const SEO = { siteUrl: "https://notes.example", base: "/" };

describe("form: blog", () => {
  it("is accepted alongside docs, and nothing else is", () => {
    expect(parseArticleConfig("slug: a\ntitle: A\nform: blog\n").form).toBe("blog");
    expect(parseArticleConfig("slug: a\ntitle: A\n").form).toBe("docs");
    expect(() => parseArticleConfig("slug: a\ntitle: A\nform: zine\n")).toThrow(/must be docs\|blog/);
  });

  it("orders the index by date, newest first, whatever order the files are in", async () => {
    const r = await renderArticle({ fs: blog(), strict: false });
    expect(r.manifest.posts).toEqual(["/newest/", "/middle/", "/oldest/"]);
    // …and the list on the page is in that order too, rather than in a second one derived here.
    const html = r.pages["/"]!.html;
    expect(html.indexOf("/newest/")).toBeLessThan(html.indexOf("/middle/"));
    expect(html.indexOf("/middle/")).toBeLessThan(html.indexOf("/oldest/"));
    expect(html).toContain("18 August 2026");
  });

  it("orders two posts written on the same day by path, so a rebuild does not reshuffle them", async () => {
    const same = { date: "date: 2026-08-18" };
    const fs = blog({
      "middle.md": `---\n${same.date}\n---\n# M\n\nProse.\n`,
      "oldest.md": `---\n${same.date}\n---\n# O\n\nProse.\n`,
    });
    const first = await renderArticle({ fs, strict: false });
    const second = await renderArticle({ fs, strict: false });
    expect(first.manifest.posts).toEqual(["/middle/", "/newest/", "/oldest/"]);
    expect(second.manifest.posts).toEqual(first.manifest.posts);
  });

  it("refuses a post with no date, and says what the three ways out are", async () => {
    const fs = blog({ "undated.md": "# No date\n\nProse.\n" });
    const r = await renderArticle({ fs, strict: false });
    const d = r.diagnostics.find((x) => x.code === "blog-post-no-date");
    expect(d).toMatchObject({ severity: "error", page: "undated.md" });
    expect(d!.message).toContain("date: 2026-08-20");
    expect(d!.message).toContain("draft: true");
    expect(d!.message).toContain("nav");
    // It is out of the index — but it is still a page, because a build that swallowed it would
    // leave the author with nothing to look at while they worked out what was wrong.
    expect(r.manifest.posts).not.toContain("/undated/");
    expect(r.pages["/undated/"]).toBeDefined();
    await expect(renderArticle({ fs, strict: true })).rejects.toBeInstanceOf(PaginaBuildError);
  });

  it("sorts an unreadable date last and warns rather than failing the build", async () => {
    const r = await renderArticle({ fs: blog({ "newest.md": "---\ndate: last tuesday\n---\n# N\n\nProse.\n" }), strict: false });
    expect(r.manifest.posts).toEqual(["/middle/", "/oldest/", "/newest/"]);
    expect(r.diagnostics.filter((d) => d.code === "blog-date-unreadable")).toHaveLength(1);
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  it("keeps a draft out of the index, the feed and the sitemap, and still builds it", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    expect(r.manifest.posts).not.toContain("/hidden/");
    expect(r.pages["/hidden/"]).toBeDefined();               // built, and readable at its URL
    expect(r.manifest.pages["/hidden/"]).toMatchObject({ draft: true, noindex: true });
    expect(r.pages["/"]!.html).not.toContain("/hidden/");
    expect(feedXml(r.manifest, SEO)).not.toContain("/hidden/");
    expect(sitemapXml(r.manifest, SEO)).not.toContain("/hidden/");
    // The posts that are not drafts are in all three.
    expect(feedXml(r.manifest, SEO)).toContain("/newest/");
    expect(sitemapXml(r.manifest, SEO)).toContain("/newest/");
  });

  it("points the pager at the newer and the older post, which is the opposite of docs", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    // The newest has nowhere newer to go; the oldest has nowhere older.
    expect(r.manifest.pages["/newest/"]!.prev).toBeUndefined();
    expect(r.manifest.pages["/newest/"]!.next).toBe("/middle/");
    expect(r.manifest.pages["/middle/"]).toMatchObject({ prev: "/newest/", next: "/oldest/" });
    expect(r.manifest.pages["/oldest/"]!.next).toBeUndefined();
    // Neither the index nor a standalone page is in that chain at all.
    expect(r.manifest.pages["/"]!.next).toBeUndefined();
    expect(r.manifest.pages["/about/"]!.prev).toBeUndefined();
    expect(r.manifest.pages["/about/"]!.next).toBeUndefined();
  });

  it("treats nav as standalone pages rather than as reading order", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    expect(r.manifest.nav).toEqual([{ title: "About", href: "/about/" }]);
    expect(r.manifest.posts).not.toContain("/about/");
    expect(r.pages["/"]!.html).not.toContain(`href="/about/"`);
    // The landing page is the index, not the first thing in nav.
    expect(r.manifest.article.rootHref).toBe("/");
  });

  it("needs an index.md, and says what to put in it", async () => {
    const r = await renderArticle({ fs: blog({ "index.md": undefined }), strict: false });
    const d = r.diagnostics.find((x) => x.code === "blog-no-index");
    expect(d).toMatchObject({ severity: "error" });
    expect(d!.message).toContain("index.md");
  });

  it("appends the archive to what the author wrote, rather than replacing it", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    const html = r.pages["/"]!.html;
    expect(html).toContain("Things worth writing down.");
    expect(html.indexOf("Things worth writing down.")).toBeLessThan(html.indexOf("pg-posts"));
    // The list is not prose and not structure: it does not enter the page's TOC or its reading time.
    expect(r.manifest.pages["/"]!.headings.map((h) => h.text)).toEqual(["Field Notes"]);
  });

  it("says so plainly when a blog has no posts yet", async () => {
    const r = await renderArticle({
      fs: memFs({ "article.yaml": YAML.replace(/nav:\n.*\n.*\n/, ""), "index.md": "# Field Notes\n\nDay one.\n" }),
      strict: true,
    });
    expect(r.pages["/"]!.html).toContain("No posts yet.");
    expect(r.manifest.posts).toEqual([]);
  });

  it("keeps the blog's own cover off its posts, and on its index", async () => {
    const fs = blog({
      "article.yaml": `${YAML}cover: banner.svg\n`,
      "banner.svg": "<svg/>",
      "middle.md": "---\ndate: 2026-07-02\ncover: own.svg\n---\n# M\n\nProse.\n",
      "own.svg": "<svg/>",
    });
    const r = await renderArticle({ fs, strict: true });
    expect(r.manifest.pages["/"]!.cover).toBe("/banner.svg");     // the index is the blog's front
    expect(r.manifest.pages["/middle/"]!.cover).toBe("/own.svg"); // a post with its own picture
    expect(r.manifest.pages["/newest/"]!.cover).toBeUndefined();  // and one without has none
    // A docs article still inherits, which is the behaviour this must not have changed.
    const docs = await renderArticle({
      fs: memFs({
        "article.yaml": "slug: d\ntitle: D\ncover: banner.svg\nnav:\n  - title: Home\n    page: index.md\n",
        "index.md": "# D\n", "banner.svg": "<svg/>",
      }),
      strict: true,
    });
    expect(docs.manifest.pages["/"]!.cover).toBe("/banner.svg");
  });

  it("fills published from date, so every tag that reads a publication date keeps working", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    expect(r.manifest.pages["/newest/"]).toMatchObject({ date: "2026-08-18", published: "2026-08-18" });
    // And `published` is not inherited *into* `date`: an undated page is undated, not article-dated.
    expect(r.manifest.pages["/about/"]!.date).toBeUndefined();
  });
});

describe("feed.xml", () => {
  /** Parses the feed as XML and fails loudly if it is not. */
  function parseFeed(xml: string): Document {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const error = doc.getElementsByTagName("parsererror")[0];
    if (error !== undefined) throw new Error(`feed is not well-formed XML: ${error.textContent ?? ""}`);
    return doc;
  }

  it("is a well-formed Atom document with an entry per post, newest first", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    const doc = parseFeed(feedXml(r.manifest, SEO)!);

    expect(doc.documentElement.namespaceURI).toBe("http://www.w3.org/2005/Atom");
    expect(doc.documentElement.tagName).toBe("feed");
    // Atom demands all three on the feed, and title + id + updated on every entry. A document
    // missing any of them is one a reader may refuse outright.
    for (const name of ["title", "id", "updated"])
      expect(doc.querySelector(`feed > ${name}`)?.textContent).toBeTruthy();

    const entries = [...doc.getElementsByTagName("entry")];
    expect(entries.map((e) => e.getElementsByTagName("title")[0]?.textContent))
      .toEqual(["The newest one", "The middle one", "The oldest one"]);
    for (const entry of entries) {
      for (const name of ["title", "id", "updated"])
        expect(entry.getElementsByTagName(name)[0]?.textContent).toBeTruthy();
      // RFC 3339, which is what Atom's date construct is defined as.
      expect(entry.getElementsByTagName("updated")[0]!.textContent)
        .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
    }
  });

  it("makes every URL absolute, because a feed is read somewhere else", async () => {
    const r = await renderArticle({ fs: blog(), strict: true, base: "/notes/" });
    const doc = parseFeed(feedXml(r.manifest, { siteUrl: "https://notes.example", base: "/notes/" })!);
    const urls = [...doc.getElementsByTagName("link")].map((l) => l.getAttribute("href"));
    expect(urls).toContain("https://notes.example/notes/feed.xml");
    expect(urls).toContain("https://notes.example/notes/newest/");
    for (const url of urls) expect(url).toMatch(/^https:\/\//);
    for (const id of [...doc.getElementsByTagName("id")]) expect(id.textContent).toMatch(/^https:\/\//);
  });

  it("dates itself by its newest post rather than by the moment of the build", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    const doc = parseFeed(feedXml(r.manifest, SEO)!);
    expect(doc.querySelector("feed > updated")!.textContent).toBe("2026-08-18T00:00:00Z");
  });

  it("carries the author, the summary and the tags a post declared", async () => {
    const r = await renderArticle({ fs: blog(), strict: true });
    const doc = parseFeed(feedXml(r.manifest, SEO)!);
    const oldest = [...doc.getElementsByTagName("entry")]
      .find((e) => e.getElementsByTagName("title")[0]?.textContent === "The oldest one")!;
    expect(oldest.getElementsByTagName("category")[0]?.getAttribute("term")).toBe("logs");
    expect(oldest.getElementsByTagName("name")[0]?.textContent).toBe("A Writer");
    const middle = [...doc.getElementsByTagName("entry")]
      .find((e) => e.getElementsByTagName("title")[0]?.textContent === "The middle one")!;
    expect(middle.getElementsByTagName("summary")[0]?.textContent).toBe("The middle one.");
  });

  it("escapes what an author wrote rather than letting it end the document", async () => {
    const r = await renderArticle({
      fs: blog({ "newest.md": `---\ndate: 2026-08-18\ndescription: Tags & <angles> and "quotes"\n---\n# Salt & pepper\n\nProse.\n` }),
      strict: true,
    });
    const doc = parseFeed(feedXml(r.manifest, SEO)!);
    const entry = [...doc.getElementsByTagName("entry")][0]!;
    expect(entry.getElementsByTagName("title")[0]?.textContent).toBe("Salt & pepper");
    expect(entry.getElementsByTagName("summary")[0]?.textContent).toBe(`Tags & <angles> and "quotes"`);
  });

  it("is not written without a site_url, for the reason the canonical is not", async () => {
    const r = await renderArticle({ fs: blog({ "article.yaml": YAML.replace("site_url: https://notes.example\n", "") }), strict: true });
    expect(feedXml(r.manifest)).toBeUndefined();
    expect(feedUrl(r.manifest)).toBeUndefined();
  });

  it("is not written for a draft article, for a mirror, or for a docs site", async () => {
    const draft = await renderArticle({ fs: blog({ "article.yaml": YAML.replace("status: published", "status: draft") }), strict: true });
    expect(feedXml(draft.manifest, SEO)).toBeUndefined();
    const published = await renderArticle({ fs: blog(), strict: true });
    expect(feedXml(published.manifest, { ...SEO, mirrorOf: "https://elsewhere.example/notes/" })).toBeUndefined();
    const docs = await renderArticle({
      fs: memFs({
        "article.yaml": "slug: d\ntitle: D\nstatus: published\nsite_url: https://d.example\nnav:\n  - title: Home\n    page: index.md\n",
        "index.md": "# D\n",
      }),
      strict: true,
    });
    expect(feedXml(docs.manifest, { siteUrl: "https://d.example" })).toBeUndefined();
  });

  it("is still valid for a blog with no posts yet", async () => {
    const r = await renderArticle({
      fs: memFs({ "article.yaml": YAML.replace(/nav:\n.*\n.*\n/, ""), "index.md": "# Field Notes\n\nDay one.\n" }),
      strict: true,
    });
    const doc = parseFeed(feedXml(r.manifest, SEO)!);
    expect(doc.getElementsByTagName("entry")).toHaveLength(0);
    expect(doc.querySelector("feed > updated")?.textContent).toBeTruthy();
  });
});
