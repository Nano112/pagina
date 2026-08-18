import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { renderArticle, PaginaBuildError } from "../src/render-article.js";
import { resolveRelative } from "../src/links.js";
import type { ContentFs } from "../src/types.js";

function nodeFs(root: string): ContentFs {   // test-only helper; the real one lives in @pagina/vite
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

describe("resolveRelative", () => {
  it("keeps a trailing slash, which is what says 'page' rather than 'file'", () => {
    // Written in a raw `<a href>` — the form a hand-written HTML block uses, and the form that
    // used to arrive downstream as a demand for a *file* named `features/basics`. `pack` then
    // refused the bundle over a file that was never supposed to exist, while `build` emitted a
    // slash-less href that only worked because hosts redirect.
    expect(resolveRelative("illustrations.md", "../features/basics/")).toBe("features/basics/");
    expect(resolveRelative("guide/a.md", "./b/")).toBe("guide/b/");
  });

  it("still resolves a file path without inventing one", () => {
    expect(resolveRelative("illustrations.md", "../media/x.svg")).toBe("media/x.svg");
    expect(resolveRelative("guide/a.md", "../index.md")).toBe("index.md");
    expect(resolveRelative("a.md", "./")).toBe("");
  });
});

describe("renderArticle", () => {
  it("renders the fixture: nav, prev/next, links, figures, assets", async () => {
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true });
    expect(Object.keys(r.pages)).toEqual(["/", "/guide/tabs/", "/guide/figures/"]);
    expect(r.manifest.nav).toEqual([
      { title: "Home", href: "/" },
      { title: "Guide", children: [{ title: "Tabs and snippets", href: "/guide/tabs/" }, { title: "Figures", href: "/guide/figures/" }] },
    ]);
    expect(r.manifest.pages["/guide/tabs/"]).toMatchObject({ prev: "/", next: "/guide/figures/", breadcrumbs: [{ title: "Guide" }, { title: "Tabs and snippets", href: "/guide/tabs/" }] });
    expect(r.pages["/"]!.html).toContain(`href="/guide/figures/#second"`);
    expect(r.pages["/guide/tabs/"]!.html).toContain(`print(&quot;hello&quot;)`); // fenced code is HTML-escaped by the Task-5 markdown pipeline
    expect(r.pages["/guide/tabs/"]!.html).toContain(`fn main()`);
    expect(r.pages["/guide/tabs/"]!.html).toContain(`href="/"`);
    const figs = r.pages["/guide/figures/"]!.figures;
    expect(figs.map((f) => f.kind)).toEqual(["module", "inline", "static", "module", "module"]);
    expect(figs[0]!.scene).toBe("/scenes/demo.mjs");
    expect(r.manifest.figures["inline-demo"]).toMatchObject({ page: "/guide/figures/", kind: "inline" });
    expect(r.manifest.assets).toContain("scenes/demo.mjs");
    expect(r.manifest.assets).toContain("media/static.svg");
    expect(r.manifest.assets).not.toContain("index.md");
    expect(r.diagnostics).toEqual([]);
  });

  it("builds staticBase with exactly one slash after base, for a root and a non-root base", async () => {
    const root = await renderArticle({ fs: nodeFs(fixture), strict: true });
    expect(root.manifest.figures["inline-demo"]!.staticBase).toBe("/_pagina/figures/guide-figures/inline-demo");
    const sub = await renderArticle({ fs: nodeFs(fixture), strict: true, base: "/Nucleation/" });
    expect(sub.manifest.figures["inline-demo"]!.staticBase).toBe("/Nucleation/_pagina/figures/guide-figures/inline-demo");
    // The page itself no longer names that path: the figure is inlined into the HTML after it is
    // rendered, and `staticBase` is where the standalone SVG files land beside it.
    expect(sub.pages["/guide/figures/"]!.html).toContain(`<div class="kg-frame" data-kg-static data-kg-frame="kg-guide-figures-1"></div>`);
  });

  it("fails strictly on a nav entry without a file, a dead link, and a bad anchor", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => p === "article.yaml"
        ? (await base.read(p)).replace("guide/figures.md", "guide/missing.md")
        : p === "index.md" ? `# X\n\n[dead](nowhere.md) [anchor](guide/tabs.md#nope)` : base.read(p),
      exists: async (p) => (p === "guide/missing.md" ? false : base.exists(p)),
    };
    await expect(renderArticle({ fs, strict: true })).rejects.toBeInstanceOf(PaginaBuildError);
    const r = await renderArticle({ fs, strict: false });
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual(["anchor-missing", "link-unresolved", "nav-missing-file"]);
  });

  it("errors when two pages claim the same figure id", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "index.md"
        ? `# X\n\n<figure class="kg" id="inline-demo" data-scene="../scenes/demo.mjs"></figure>`
        : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: false });
    const dupes = r.diagnostics.filter((d) => d.code === "figure-id-collision");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ severity: "error", message: expect.stringContaining("inline-demo") });
    await expect(renderArticle({ fs, strict: true })).rejects.toBeInstanceOf(PaginaBuildError);
  });

  it("carries the article's metadata, cover resolved to a site URL", async () => {
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true });
    expect(r.manifest.article).toMatchObject({
      cover: "/media/cover.svg",
      description: "A fixture article, used by pagina's own tests.",
      author: "Fixture Author",
      siteUrl: "https://fixture.example",
    });
    // The cover is an ordinary asset: nothing special copies it, the asset pass already does.
    expect(r.manifest.assets).toContain("media/cover.svg");
    const sub = await renderArticle({ fs: nodeFs(fixture), strict: true, base: "/docs/" });
    expect(sub.manifest.article.cover).toBe("/docs/media/cover.svg");
  });

  it("gives every page the article's metadata, resolved", async () => {
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true });
    for (const meta of Object.values(r.manifest.pages)) {
      expect(meta.cover).toBe("/media/cover.svg");
      expect(meta.description).toBe("A fixture article, used by pagina's own tests.");
      expect(meta.author).toBe("Fixture Author");
      expect(meta.noindex).toBeUndefined();         // the fixture is published
    }
  });

  it("lets a page's front matter override the article, field by field", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "index.md"
        ? `---\ntitle: Overridden\ndescription: The page's own.\ncover: media/static.svg\nauthor: Someone Else\nnoindex: true\ntags: [own]\n---\n# X\n`
        : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: true });
    expect(r.manifest.pages["/"]).toMatchObject({
      title: "Overridden",
      description: "The page's own.",
      cover: "/media/static.svg",
      author: "Someone Else",
      noindex: true,
      tags: ["own"],
    });
    // …and a page that overrode nothing still has the article's values.
    expect(r.manifest.pages["/guide/tabs/"]).toMatchObject({ cover: "/media/cover.svg", author: "Fixture Author" });
  });

  it("resolves a page's cover against that page, not against the folder", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "guide/tabs.md" ? `---\ncover: ../media/static.svg\n---\n# T\n` : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: false });
    expect(r.manifest.pages["/guide/tabs/"]!.cover).toBe("/media/static.svg");
  });

  it("passes an absolute cover URL through untouched", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "article.yaml"
        ? (await base.read(p)).replace("cover: media/cover.svg", "cover: https://cdn.example/hero.png")
        : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: true });
    expect(r.manifest.article.cover).toBe("https://cdn.example/hero.png");
  });

  it("falls back to the first paragraph when neither page nor article has a description", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => p === "article.yaml"
        ? (await base.read(p)).replace("description: A fixture article, used by pagina's own tests.\n", "")
        : p === "index.md" ? `# X\n\nThe opening paragraph, which is the last resort.\n` : base.read(p),
    };
    const r = await renderArticle({ fs, strict: true });
    expect(r.manifest.pages["/"]!.description).toBe("The opening paragraph, which is the last resort.");
  });

  it("truncates a long description on a word boundary before it reaches the manifest", async () => {
    const base = nodeFs(fixture);
    const long = `${"alpha ".repeat(60)}omega`;
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "article.yaml"
        ? (await base.read(p)).replace("A fixture article, used by pagina's own tests.", long.trim())
        : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: true });
    const d = r.manifest.pages["/"]!.description!;
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toMatch(/al…$/);
  });

  it("errors on a cover that does not exist, and emits no URL for it", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "article.yaml"
        ? (await base.read(p)).replace("media/cover.svg", "media/gone.png")
        : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: false });
    const missing = r.diagnostics.filter((d) => d.code === "cover-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ severity: "error", message: expect.stringContaining("media/gone.png") });
    // Silence, not a broken URL: an `og:image` pointing at a 404 is worse than none.
    expect(r.manifest.article.cover).toBeUndefined();
    expect(r.manifest.pages["/"]!.cover).toBeUndefined();
    await expect(renderArticle({ fs, strict: true })).rejects.toBeInstanceOf(PaginaBuildError);
  });

  it("errors on a page cover that does not exist, naming the page", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "guide/tabs.md" ? `---\ncover: nope.png\n---\n# T\n` : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: false });
    expect(r.diagnostics.filter((d) => d.code === "cover-missing")[0]).toMatchObject({ page: "guide/tabs.md" });
    // The article's cover still stands in for the page, so the page is not left bare.
    expect(r.manifest.pages["/guide/tabs/"]!.cover).toBe("/media/cover.svg");
  });

  it("marks every page of a draft article noindex", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "article.yaml" ? (await base.read(p)).replace("status: published", "status: draft") : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: true });
    expect(Object.values(r.manifest.pages).every((m) => m.noindex === true)).toBe(true);
  });

  it("lets the builder override the folder's site_url", async () => {
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true, siteUrl: "https://host.example" });
    expect(r.manifest.article.siteUrl).toBe("https://host.example");
  });

  /**
   * The two fields every consumer reads, in the shapes the Laravel package is coded against:
   * `manifest.pages[href].readingMinutes` (a number, whole, ≥ 1, absent without prose) and
   * `manifest.article.readingMinutes` (their sum).
   */
  it("puts a whole-minute reading time on every page that has prose", async () => {
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true });
    for (const [href, meta] of Object.entries(r.manifest.pages)) {
      expect(typeof meta.readingMinutes, href).toBe("number");
      expect(Number.isInteger(meta.readingMinutes), href).toBe(true);
      expect(meta.readingMinutes, href).toBeGreaterThanOrEqual(1);
    }
  });

  it("makes the article's reading time the sum of its pages'", async () => {
    // A card that says "12 min" over a page list whose numbers add to 11 is a card nobody trusts.
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true });
    const sum = Object.values(r.manifest.pages).reduce((n, m) => n + (m.readingMinutes ?? 0), 0);
    expect(r.manifest.article.readingMinutes).toBe(sum);
  });

  it("omits the reading time entirely for a page with no prose", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base, read: async (p) => (p === "index.md" ? "```ts\nconst a = 1;\n```\n" : base.read(p)) };
    const r = await renderArticle({ fs, strict: false });
    // Absent, not zero: "0 min read" is not a claim anyone wants to make.
    expect(r.manifest.pages["/"]!.readingMinutes).toBeUndefined();
    expect("readingMinutes" in r.manifest.pages["/"]!).toBe(false);
  });

  it("names the landing page and carries cover_on, so no consumer re-derives either", async () => {
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true });
    expect(r.manifest.article.rootHref).toBe("/");           // the first page in nav order
    expect(r.manifest.article.coverOn).toBe("root");
  });

  it("resolves cover alt text to the author's words, else the article title", async () => {
    const r = await renderArticle({ fs: nodeFs(fixture), strict: true });
    // The fixture gives no `cover_alt`, so every page falls back to the article title — never "",
    // and never "cover.svg".
    expect(r.manifest.pages["/"]!.coverAlt).toBe("Fixture Docs");

    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "article.yaml"
        ? `${await base.read(p)}\ncover_alt: The fixture's own cover\n`
        : base.read(p)),
    };
    expect((await renderArticle({ fs, strict: true })).manifest.pages["/"]!.coverAlt).toBe("The fixture's own cover");
  });

  it("lets a page that overrides the cover override its alt text too", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "index.md"
        ? `---\ncover: media/static.svg\ncover_alt: A page's own picture\n---\n\n# X\n\nSome prose.\n`
        : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: true });
    expect(r.manifest.pages["/"]!.cover).toBe("/media/static.svg");
    expect(r.manifest.pages["/"]!.coverAlt).toBe("A page's own picture");
    // A page that did not override the image keeps the article's alt, not this page's.
    expect(r.manifest.pages["/guide/tabs/"]!.coverAlt).toBe("Fixture Docs");
  });

  it("flags a same-page anchor to a missing heading, and not one to a real heading", async () => {
    const base = nodeFs(fixture);
    const fs: ContentFs = { ...base,
      read: async (p) => (p === "index.md" ? `# X\n\n[bad](#nope) [ok](#x)` : base.read(p)),
    };
    const r = await renderArticle({ fs, strict: false });
    const anchorDiags = r.diagnostics.filter((d) => d.code === "anchor-missing");
    expect(anchorDiags).toHaveLength(1);
    expect(anchorDiags[0]).toMatchObject({ page: "index.md", message: expect.stringContaining("#nope") });
  });
});
