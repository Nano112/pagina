/**
 * The card's configuration surface, and the parts of it a build cannot see go wrong.
 *
 * A picture is checked by looking at it. What is checked here is everything around the picture that
 * rots silently: which of two `og:` blocks wins, what a mistyped key costs, and the text a screen
 * reader is handed in place of the image.
 */
import { describe, expect, it } from "vitest";
import { parseArticleConfig } from "../src/config.js";
import { parseFrontMatter } from "../src/front-matter.js";
import { DEFAULT_OG_CONFIG, cardAltText, clampWords, parseOgConfig, resolveOgConfig } from "../src/og.js";

const yaml = (extra: string): string => `slug: a\ntitle: A\nform: docs\nstatus: published\n${extra}`;

describe("parseOgConfig", () => {
  it("reads the block, mapping snake_case keys onto their fields", () => {
    const { og, diagnostics } = parseOgConfig({
      template: "figure", scheme: "dark", glyph: "scenes/x.mjs",
      glyph_width: 480, glyph_position: "left", time: 250, alt: "a card", width: 1000, height: 500,
    }, "where");
    expect(diagnostics).toEqual([]);
    expect(og).toEqual({
      template: "figure", scheme: "dark", glyph: "scenes/x.mjs",
      glyphWidth: 480, glyphPosition: "left", time: 250, alt: "a card", width: 1000, height: 500,
    });
  });

  it("takes `og: false` as the opt-out and `og: true` as the opt back in", () => {
    expect(parseOgConfig(false, "w").og).toEqual({ enabled: false });
    expect(parseOgConfig(true, "w").og).toEqual({ enabled: true });
  });

  it("says nothing about an absent block", () => {
    expect(parseOgConfig(undefined, "w")).toEqual({ diagnostics: [] });
    expect(parseOgConfig(null, "w")).toEqual({ diagnostics: [] });
  });

  it("drops a bad field and reports it, rather than guessing", () => {
    const { og, diagnostics } = parseOgConfig({ template: "fancy", glyph_position: "up", time: "middle", width: 9 }, "where");
    expect(og).toEqual({});
    expect(diagnostics.map((d) => d.code)).toEqual(["og-invalid", "og-invalid", "og-invalid", "og-invalid"]);
    expect(diagnostics[0]!.message).toContain("where: og.template must be editorial|figure|full");
  });

  it("refuses a scalar that is not a boolean", () => {
    const { og, diagnostics } = parseOgConfig("editorial", "where");
    expect(og).toBeUndefined();
    expect(diagnostics[0]!.message).toContain("og must be a mapping");
  });
});

describe("resolveOgConfig", () => {
  it("fills every default when neither level says anything", () => {
    expect(resolveOgConfig()).toEqual(DEFAULT_OG_CONFIG);
    expect(resolveOgConfig().width).toBe(1200);
    expect(resolveOgConfig().height).toBe(630);
  });

  it("lets the page override the article field by field", () => {
    const merged = resolveOgConfig({ template: "figure", scheme: "dark", glyphWidth: 500 }, { glyph: "s.mjs" });
    // The page named a glyph and nothing else, so the article's template and scheme still stand.
    expect(merged).toMatchObject({ template: "figure", scheme: "dark", glyphWidth: 500, glyph: "s.mjs" });
  });

  it("lets a page opt out of an article that draws cards, and back in", () => {
    expect(resolveOgConfig({}, { enabled: false }).enabled).toBe(false);
    expect(resolveOgConfig({ enabled: false }, { enabled: true }).enabled).toBe(true);
  });
});

describe("where the block is written", () => {
  it("is read from article.yaml, and a mistake there is an error", () => {
    expect(parseArticleConfig(yaml("og:\n  template: figure\n  glyph: scenes/x.mjs\n")).og)
      .toEqual({ template: "figure", glyph: "scenes/x.mjs" });
    expect(parseArticleConfig(yaml("og: false\n")).og).toEqual({ enabled: false });
    expect(() => parseArticleConfig(yaml("og:\n  template: fancy\n"))).toThrow(/og\.template must be/);
  });

  it("is read from front matter, and a mistake there is a warning on that page", () => {
    const good = parseFrontMatter("---\nog:\n  glyph: s.mjs\n---\nbody\n", "p.md");
    expect(good.meta.og).toEqual({ glyph: "s.mjs" });
    expect(good.diagnostics).toEqual([]);
    // One malformed page must not take a site's build with it — the same call the rest of this
    // file's keys make.
    const bad = parseFrontMatter("---\nog:\n  scheme: sepia\n---\nbody\n", "p.md");
    expect(bad.meta.og).toEqual({});
    expect(bad.diagnostics[0]).toMatchObject({ severity: "warning", code: "og-invalid", page: "p.md" });
  });
});

describe("clampWords", () => {
  it("cuts on a word boundary rather than mid-word", () => {
    expect(clampWords("bringing a design system along", 14)).toBe("bringing a…");
    expect(clampWords("short", 20)).toBe("short");
  });

  it("collapses the whitespace a folded YAML scalar leaves behind", () => {
    expect(clampWords("one\n  two   three", 40)).toBe("one two three");
  });

  it("falls back to a hard cut when there is no boundary worth using", () => {
    expect(clampWords("Supercalifragilisticexpialidocious", 10)).toBe("Supercalif…");
  });
});

describe("cardAltText", () => {
  it("describes the card from what is on it", () => {
    expect(cardAltText({ title: "Theming", description: "Twenty custom properties.", siteName: "pagina" }))
      .toBe("Card from pagina: Theming — Twenty custom properties.");
  });

  it("uses the author's alt when there is one", () => {
    expect(cardAltText({ title: "Theming", alt: "A blue card" })).toBe("A blue card");
  });

  it("is still a sentence for a page with no description", () => {
    expect(cardAltText({ title: "Install", siteName: "pagina" })).toBe("Card from pagina: Install");
  });
});
