import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isKineglyphThemeModule, kineglyphThemeHref, parseArticleConfig } from "../src/config.js";

const yaml = readFileSync(new URL("./fixture/article.yaml", import.meta.url), "utf8");

describe("parseArticleConfig", () => {
  it("parses the fixture and applies defaults", () => {
    const cfg = parseArticleConfig(yaml);
    expect(cfg.slug).toBe("fixture");
    expect(cfg.form).toBe("docs");
    expect(cfg.visibility).toBe("public");
    expect(cfg.snippets.roots).toEqual([".", "../outside"]);
    expect(cfg.nav).toHaveLength(2);
    expect(cfg.nav[1]).toMatchObject({ section: "Guide" });
  });
  it("defaults snippets.roots to ['.']", () => {
    expect(parseArticleConfig(`slug: a\ntitle: A\nform: docs\nnav: []`).snippets.roots).toEqual(["."]);
  });
  it("reads the metadata fields, `site_url` under its snake_case key", () => {
    const cfg = parseArticleConfig(yaml);
    expect(cfg.cover).toBe("media/cover.svg");
    expect(cfg.description).toBe("A fixture article, used by pagina's own tests.");
    expect(cfg.author).toBe("Fixture Author");
    expect(cfg.siteUrl).toBe("https://fixture.example");
  });
  it('defaults cover_on to "root", because a cover belongs to the article', () => {
    expect(parseArticleConfig(yaml).coverOn).toBe("root");
    expect(parseArticleConfig(`slug: a\ntitle: A\nnav: []\ncover_on: all`).coverOn).toBe("all");
    expect(parseArticleConfig(`slug: a\ntitle: A\nnav: []\ncover_on: none`).coverOn).toBe("none");
  });
  it("rejects a cover_on it does not know rather than falling back", () => {
    // `cover_on: rooot` falling back to "none" would hide the header everywhere and look exactly
    // like the bug this option exists to fix.
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nnav: []\ncover_on: rooot`))
      .toThrow(/cover_on must be root\|all\|none/);
  });
  it("reads cover_alt under its snake_case key", () => {
    expect(parseArticleConfig(`slug: a\ntitle: A\nnav: []\ncover_alt: A wide shot`).coverAlt).toBe("A wide shot");
    expect(parseArticleConfig(`slug: a\ntitle: A\nnav: []`).coverAlt).toBeUndefined();
  });
  it("leaves absent metadata absent rather than empty", () => {
    const cfg = parseArticleConfig(`slug: a\ntitle: A\nnav: []`);
    expect(cfg.cover).toBeUndefined();
    expect(cfg.description).toBeUndefined();
    expect(cfg.author).toBeUndefined();
    expect(cfg.siteUrl).toBeUndefined();
    expect(cfg.published).toBeUndefined();
  });
  it("takes a date quoted or unquoted, and always yields a string", () => {
    // `article:published_time` wants one shape, whatever the author wrote and whichever schema
    // `yaml` happens to resolve it under.
    expect(parseArticleConfig(`slug: a\ntitle: A\npublished: 2026-08-17\nnav: []`).published).toBe("2026-08-17");
    expect(parseArticleConfig(`slug: a\ntitle: A\nupdated: "2026-08-17"\nnav: []`).updated).toBe("2026-08-17");
    expect(typeof parseArticleConfig(`slug: a\ntitle: A\npublished: 2026-08-17T09:30:00Z\nnav: []`).published).toBe("string");
  });
  it("rejects a metadata field of the wrong type, naming it", () => {
    expect(() => parseArticleConfig(`slug: a\ntitle: A\ncover: 3\nnav: []`)).toThrow(/cover/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nsite_url: []\nnav: []`)).toThrow(/site_url/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\npublished: []\nnav: []`)).toThrow(/published/);
  });
  describe("kineglyph.widths", () => {
    const cfg = (kg: string) =>
      parseArticleConfig(`slug: a\ntitle: A\nform: docs\nnav: []\nkineglyph:\n${kg}`);

    it("sorts the widths widest first and drops duplicates", () => {
      // Widest first is the order the page inlines them in, and the order that makes the
      // no-container-query fallback show the widest drawing rather than an arbitrary one.
      expect(cfg("  widths: [320, 960, 600, 320]").kineglyph?.widths).toEqual([960, 600, 320]);
    });

    it("leaves a single `width` alone", () => {
      const c = cfg("  width: 960");
      expect(c.kineglyph?.width).toBe(960);
      expect(c.kineglyph?.widths).toBeUndefined();
    });

    it("refuses a list that is not widths, or one long enough to bloat every page", () => {
      expect(() => cfg("  widths: 960")).toThrow(/kineglyph\.widths/);
      expect(() => cfg("  widths: []")).toThrow(/at least one/);
      expect(() => cfg('  widths: [960, "wide"]')).toThrow(/kineglyph\.widths\[1\]/);
      expect(() => cfg("  widths: [-1]")).toThrow(/kineglyph\.widths\[0\]/);
      expect(() => cfg("  widths: [960, 800, 700, 600, 500, 400]")).toThrow(/at most 5/);
    });
  });

  it("rejects missing slug and unknown form with field names", () => {
    expect(() => parseArticleConfig(`title: A\nform: docs\nnav: []`)).toThrow(/slug/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nform: post\nnav: []`)).toThrow(/form/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nform: docs\nnav: [{ title: X }]`)).toThrow(/nav\[0\]/);
  });
});

/**
 * `kineglyph.theme`: a module the article ships, or a theme by name.
 *
 * They are told apart the way an author tells them apart — a module is a file, so it has a path in
 * it — because a name has nothing to fetch. `inherit` is the reserved one and every runtime means
 * the same thing by it; any other name is Kineglyph's registry to answer, and an answer of "I do
 * not know that name" is inherit too, which is the right outcome for a typo as much as a decision.
 */
describe("kineglyph.theme, named or shipped", () => {
  it("recognises a file by its path, and a name by the absence of one", () => {
    for (const module of ["theme/kineglyph.mjs", "./theme.mjs", "../shared/theme.js", "/themes/x.mjs", "https://cdn/x.mjs", "theme.ts"])
      expect(isKineglyphThemeModule(module)).toBe(true);
    for (const name of ["inherit", "midnight", "paper", "default", "our-brand"])
      expect(isKineglyphThemeModule(name)).toBe(false);
  });

  it("gives a page a URL to load for a module, and nothing to load for a name", () => {
    expect(kineglyphThemeHref({ kineglyph: { theme: "theme/kg.mjs" } }, "/docs/")).toBe("/docs/theme/kg.mjs");
    expect(kineglyphThemeHref({ kineglyph: { theme: "https://cdn/x.mjs" } }, "/docs/")).toBe("https://cdn/x.mjs");
    expect(kineglyphThemeHref({ kineglyph: { theme: "inherit" } }, "/docs/")).toBeUndefined();
    expect(kineglyphThemeHref({ kineglyph: { theme: "midnight" } }, "/docs/")).toBeUndefined();
    expect(kineglyphThemeHref({}, "/docs/")).toBeUndefined();
  });
});
