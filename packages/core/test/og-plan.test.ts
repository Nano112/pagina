/**
 * The half of card generation that both rasterisers share.
 *
 * `planCards` and `composeCardPalette` are called by `pagina build` through `node:fs` and by the
 * editor through its store, and the thing that has to hold is that neither of those facts is
 * visible in the answer: the same article produces the same specs, the same palette and above all
 * the same hashed file names on both paths. When they disagree, nothing breaks loudly — each side
 * simply spends forever redrawing what the other just drew — so it is worth a test that does not
 * depend on either rasteriser existing.
 */
import { describe, expect, it } from "vitest";
import { composeCardPalette, DEFAULT_DARK, DEFAULT_LIGHT } from "../src/og-palette.js";
import { joinArticlePath, planCards } from "../src/og-plan.js";
import type { ArticleConfig, RenderedArticle } from "../src/types.js";

const article = (overrides: Partial<RenderedArticle["manifest"]> = {}): RenderedArticle => ({
  manifest: {
    article: { title: "Fixture Docs", slug: "fixture", category: "Guide" },
    pages: {
      "/": { title: "Home", description: "The first page.", headings: [], readingMinutes: 3 },
      "/guide/": { title: "Guide", headings: [], readingMinutes: 1 },
    },
    assets: [],
    ...overrides,
  },
  pages: {
    "index.md": { href: "/", path: "index.md", html: "", frontMatter: {}, figures: [] },
    "guide.md": { href: "/guide/", path: "guide.md", html: "", frontMatter: {}, figures: [] },
  },
  diagnostics: [],
} as unknown as RenderedArticle);

const config: ArticleConfig = { slug: "fixture", title: "Fixture Docs" } as ArticleConfig;

/** A folder that is a plain object: the shape both a disk and a store reduce to. */
const folder = (files: Record<string, string>) => async (path: string): Promise<string | undefined> => files[path];

describe("joinArticlePath", () => {
  it("joins and resolves without node:path, which a browser does not have", () => {
    expect(joinArticlePath(".", "theme.css")).toBe("theme.css");
    expect(joinArticlePath("guide", "scenes/x.mjs")).toBe("guide/scenes/x.mjs");
    // A page's `theme:` is resolved against the page's directory, which is `<page>/..`.
    expect(joinArticlePath("guide/deep/page.md/..", "../theme.css")).toBe("guide/theme.css");
    expect(joinArticlePath("", "")).toBe("");
  });
});

describe("composeCardPalette", () => {
  it("climbs the three rungs in order, whoever is doing the reading", async () => {
    const read = folder({
      "article.css": ":root { --pg-accent: #a00000 }",
      "page.css": ":root { --pg-accent: #00a000; --pg-bg: #fafafa }",
    });
    const { palette } = await composeCardPalette("light", {
      tokensCss: ":root { --pg-accent: #0000a0; --pg-fg: #111111 }",
      articleTheme: "article.css",
      pageTheme: "page.css",
    }, read);
    // The page wins the accent, the shell's tokens still supply what nobody overrode, and the
    // untouched roles are pagina's own.
    expect(palette.accent).toBe("#00a000");
    expect(palette.bg).toBe("#fafafa");
    expect(palette.fg).toBe("#111111");
    expect(palette.line).toBe(DEFAULT_LIGHT.line);
  });

  it("starts from the dark defaults for a dark card", async () => {
    const { palette } = await composeCardPalette("dark", {}, folder({}));
    expect(palette).toEqual(DEFAULT_DARK);
  });

  it("says so, and keeps going, when a stylesheet is missing or remote", async () => {
    const { palette, diagnostics } = await composeCardPalette("light", {
      articleTheme: "https://cdn.example/theme.css",
      pageTheme: "gone.css",
    }, folder({}));
    expect(palette).toEqual(DEFAULT_LIGHT);
    expect(diagnostics.map((d) => d.code).sort()).toEqual(["og-theme-missing", "og-theme-remote"]);
  });
});

describe("planCards", () => {
  const plan = (o: Partial<Parameters<typeof planCards>[0]> = {}) =>
    planCards({
      article: article(),
      config,
      fontDigest: "f00d",
      fontFamily: "Instrument Sans",
      readText: folder({}),
      ...o,
    });

  it("plans one card per page, named by a hash of what it is a picture of", async () => {
    const { planned } = await plan();
    expect(planned.map((p) => p.href)).toEqual(["/", "/guide/"]);
    for (const card of planned) {
      expect(card.rel).toMatch(/^_pagina\/og\/[a-z0-9-]+\.[0-9a-f]{8}\.png$/);
    }
    expect(planned[0]!.rel.startsWith("_pagina/og/index.")).toBe(true);
    expect(planned[1]!.rel.startsWith("_pagina/og/guide.")).toBe(true);
  });

  it("gives the same names for the same article however the files are read", async () => {
    // The claim the whole two-rasteriser arrangement rests on. `readText` is the only thing that
    // differs between a build and a publish; if the plan can see which one it is, the caching is
    // already broken.
    const disk = await plan({ readText: async (p) => folder({ "theme.css": ":root{--pg-accent:#123456}" })(p) });
    const store = await plan({ readText: (p) => Promise.resolve({ "theme.css": ":root{--pg-accent:#123456}" }[p]) });
    expect(disk.planned.map((p) => p.rel)).toEqual(store.planned.map((p) => p.rel));
  });

  it("leaves a page that already has artwork alone", async () => {
    const withCover = article();
    (withCover.manifest.pages["/"] as { cover?: string }).cover = "/media/hero.png";
    const { planned } = await planCards({
      article: withCover, config, fontDigest: "f00d", fontFamily: "Instrument Sans", readText: folder({}),
    });
    expect(planned.map((p) => p.href)).toEqual(["/guide/"]);
  });

  it("moves the hash when the copy moves and holds it when nothing does", async () => {
    const before = (await plan()).planned[0]!.rel;
    expect((await plan()).planned[0]!.rel).toBe(before);

    const retitled = article({
      pages: {
        "/": { title: "Something else", description: "The first page.", headings: [], readingMinutes: 3 },
        "/guide/": { title: "Guide", headings: [], readingMinutes: 1 },
      },
    } as unknown as Partial<RenderedArticle["manifest"]>);
    const after = (await planCards({
      article: retitled, config, fontDigest: "f00d", fontFamily: "Instrument Sans", readText: folder({}),
    })).planned[0]!.rel;
    expect(after).not.toBe(before);

    // A different font is a different card, which is what stops a font swap leaving stale pictures.
    const refonted = (await plan({ fontDigest: "beef" })).planned[0]!.rel;
    expect(refonted).not.toBe(before);
  });

  it("carries the glyph's bytes, and drops a glyph that is not there", async () => {
    const withGlyph: ArticleConfig = { ...config, og: { glyph: "scenes/x.mjs" } } as ArticleConfig;
    const found = await plan({ config: withGlyph, readText: folder({ "scenes/x.mjs": "export default {}" }) });
    expect(found.planned[0]!.spec.glyph?.file).toBe("scenes/x.mjs");
    expect(found.planned[0]!.glyphSource).toBe("export default {}");

    const missing = await plan({ config: withGlyph });
    expect(missing.planned[0]!.spec.glyph).toBeUndefined();
    expect(missing.diagnostics.some((d) => d.code === "og-glyph-missing")).toBe(true);
    // Still a card, just without the picture in the slot.
    expect(missing.planned).toHaveLength(2);
  });
});
