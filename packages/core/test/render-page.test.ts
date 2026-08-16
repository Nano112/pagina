import { describe, expect, it } from "vitest";
import { renderPage } from "../src/render-page.js";
import type { ArticleConfig, ContentFs } from "../src/types.js";

const config: ArticleConfig = {
  slug: "fm", title: "FM", form: "docs", status: "published", visibility: "public",
  tags: [], snippets: { roots: ["."] }, nav: [],
};

function memFs(files: Record<string, string>): ContentFs {
  return {
    read: async (p) => { const v = files[p]; if (v === undefined) throw new Error(`missing ${p}`); return v; },
    readBinary: async (p) => new TextEncoder().encode(files[p] ?? ""),
    exists: async (p) => p in files,
    list: async () => Object.keys(files),
  };
}

describe("renderPage", () => {
  it("strips leading front-matter before rendering", async () => {
    const fs = memFs({ "index.md": "---\ntitle: X\n---\n# Real\n" });
    const { page } = await renderPage({ fs, config, path: "index.md", navPages: new Set(["index.md"]) });
    expect(page.title).toBe("Real");
    expect(page.html).not.toContain("<hr>");
  });
});
