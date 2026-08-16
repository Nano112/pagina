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
  it("rejects missing slug and unknown form with field names", () => {
    expect(() => parseArticleConfig(`title: A\nform: docs\nnav: []`)).toThrow(/slug/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nform: post\nnav: []`)).toThrow(/form/);
    expect(() => parseArticleConfig(`slug: a\ntitle: A\nform: docs\nnav: [{ title: X }]`)).toThrow(/nav\[0\]/);
  });
});
