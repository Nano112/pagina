import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseArticleConfig } from "../src/config.js";

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
  it("rejects missing slug and unknown form with field names", () => {
    expect(() => parseArticleConfig(`title: A\nform: docs\nnav: []`)).toThrow(/slug/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nform: post\nnav: []`)).toThrow(/form/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nform: docs\nnav: [{ title: X }]`)).toThrow(/nav\[0\]/);
  });
});
