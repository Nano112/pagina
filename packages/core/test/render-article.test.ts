import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { renderArticle, PaginaBuildError } from "../src/render-article.js";
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
    expect(figs.map((f) => f.kind)).toEqual(["module", "inline", "static"]);
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
    expect(sub.pages["/guide/figures/"]!.html).toContain(`srcset="/Nucleation/_pagina/figures/guide-figures/kg-guide-figures-1.dark.svg"`);
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
