import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStatic, type Shell } from "../src/index.js";

const fixture = new URL("../../core/test/fixture/", import.meta.url).pathname;
const stubShell: Shell = {
  clientEntry: new URL("./stub-client.ts", import.meta.url).pathname,
  render: async (article, ctx) =>
    Object.fromEntries(
      Object.values(article.pages).map((p) => [
        p.href === "/" ? "index.html" : `${p.href.replace(/^\/|\/$/g, "")}/index.html`,
        `<!doctype html><script type="importmap">{"imports":{"kineglyph":"${ctx.kineglyphRuntimeUrl}"}}</script>${p.html}`,
      ]),
    ),
};

describe("buildStatic", () => {
  it("emits pages, copies assets, pre-renders figures, writes manifest and runtime", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-"));
    const r = await buildStatic({ folder: fixture, outDir, shell: stubShell, strict: true });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    for (const f of [
      "index.html",
      "guide/tabs/index.html",
      "guide/figures/index.html",
      "scenes/demo.mjs",
      "media/static.svg",
      "_pagina/manifest.json",
      "_pagina/kineglyph.js",
    ])
      expect((await stat(join(outDir, f))).isFile(), f).toBe(true);
    const figs = await readdir(join(outDir, "_pagina/figures/guide-figures"));
    expect(figs.sort()).toEqual([
      "inline-demo.dark.svg",
      "inline-demo.light.svg",
      "kg-guide-figures-1.dark.svg",
      "kg-guide-figures-1.light.svg",
    ]);
    expect(
      await readFile(join(outDir, "_pagina/figures/guide-figures/inline-demo.light.svg"), "utf8"),
    ).toContain("Inline");
    const html = await readFile(join(outDir, "guide/figures/index.html"), "utf8");
    expect(html).toContain(`srcset="/_pagina/figures/guide-figures/kg-guide-figures-1.dark.svg"`);
    expect(html).toContain(`"kineglyph":"/_pagina/kineglyph.js"`);
  }, 60_000);
});
