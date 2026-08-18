import { describe, expect, it } from "vitest";
import { renderPage } from "../src/render-page.js";
import type { ArticleConfig, ContentFs } from "../src/types.js";

const config: ArticleConfig = {
  slug: "fm", title: "FM", form: "docs", status: "published", visibility: "public",
  tags: [], coverOn: "root", snippets: { roots: ["."] }, exclude: [], excludeGitignore: true, nav: [],
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
    const fs = memFs({ "index.md": "---\nauthor: A\n---\n# Real\n" });
    const { page } = await renderPage({ fs, config, path: "index.md", navPages: new Set(["index.md"]) });
    expect(page.title).toBe("Real");
    // The `---` fence must not survive as a horizontal rule, and the keys must not survive as text.
    expect(page.html).not.toContain("<hr>");
    expect(page.html).not.toContain("author");
  });

  it("lets front matter override the H1 as the page title", async () => {
    const fs = memFs({ "index.md": "---\ntitle: X\n---\n# Real\n" });
    const { page } = await renderPage({ fs, config, path: "index.md", navPages: new Set(["index.md"]) });
    expect(page.title).toBe("X");
    expect(page.frontMatter).toEqual({ title: "X" });
    // The heading itself is untouched: front matter names the page, it does not rewrite the page.
    expect(page.html).toContain("Real");
  });

  it("carries the rest of the front matter and the first paragraph through", async () => {
    const fs = memFs({
      "index.md": "---\ndescription: A one-liner\ncover: media/hero.png\nnoindex: true\n---\n# Real\n\nOpening prose.\n",
    });
    const { page } = await renderPage({ fs, config, path: "index.md", navPages: new Set(["index.md"]) });
    expect(page.frontMatter).toEqual({ description: "A one-liner", cover: "media/hero.png", noindex: true });
    expect(page.excerpt).toBe("Opening prose.");
  });

  it("reports malformed front matter instead of throwing", async () => {
    const fs = memFs({ "index.md": "---\ntitle: 3\n---\n# Real\n" });
    const { page, diagnostics } = await renderPage({ fs, config, path: "index.md", navPages: new Set(["index.md"]) });
    expect(diagnostics.map((d) => d.code)).toContain("front-matter-invalid");
    expect(page.title).toBe("Real");
  });
});
