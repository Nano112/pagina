import { describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStatic, bundleClient } from "../src/index.js";
import { stubShell } from "./stub-shell.js";

const fixture = new URL("../../core/test/fixture/", import.meta.url).pathname;
/** The real shell's client entry, for the CSS-emission assertions below. */
const shellClient = new URL("../../shell-static/client/pagina.ts", import.meta.url).pathname;

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
    // The client bundle keeps `kineglyph` as a bare import for the page's import map.
    const client = await readFile(join(outDir, "_pagina/pagina.js"), "utf8");
    expect(client.length).toBeGreaterThan(0);
    expect(/from\s*"kineglyph"/.test(client), client).toBe(true);
  }, 60_000);

  it("puts base in every emitted URL but never in the output paths", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-base-"));
    const r = await buildStatic({ folder: fixture, outDir, shell: stubShell, strict: true, base: "/Nucleation/" });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const html = await readFile(join(outDir, "guide/figures/index.html"), "utf8");
    expect(html).toContain(`srcset="/Nucleation/_pagina/figures/guide-figures/kg-guide-figures-1.dark.svg"`);
    expect(html).toContain(`"kineglyph":"/Nucleation/_pagina/kineglyph.js"`);
    // outDir is the directory served *at* base, so base must not appear inside it.
    const figs = await readdir(join(outDir, "_pagina/figures/guide-figures"));
    expect(figs.sort()).toEqual([
      "inline-demo.dark.svg",
      "inline-demo.light.svg",
      "kg-guide-figures-1.dark.svg",
      "kg-guide-figures-1.light.svg",
    ]);
    expect(existsSync(join(outDir, "Nucleation"))).toBe(false);
  }, 60_000);

  it("reports a broken figure as a diagnostic and still renders the others", async () => {
    const root = await mkdtemp(join(tmpdir(), "pagina-broken-"));
    const folder = join(root, "fixture");
    await cp(fixture, folder, { recursive: true });
    await cp(join(fixture, "../outside"), join(root, "outside"), { recursive: true }); // a snippet root
    await writeFile(join(folder, "scenes/demo.mjs"), `export default null;\n`);

    const outDir = await mkdtemp(join(tmpdir(), "pagina-broken-out-"));
    const r = await buildStatic({ folder, outDir, shell: stubShell, strict: false });
    const broken = r.diagnostics.filter((d) => d.code === "figure-prerender");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ severity: "error", page: "guide/figures.md" });
    expect(broken[0]!.message).toContain("kg-guide-figures-1");
    // the healthy figure on the same page still rendered
    expect((await readdir(join(outDir, "_pagina/figures/guide-figures"))).sort())
      .toEqual(["inline-demo.dark.svg", "inline-demo.light.svg"]);

    const strictOut = await mkdtemp(join(tmpdir(), "pagina-broken-strict-"));
    await expect(buildStatic({ folder, outDir: strictOut, shell: stubShell })).rejects.toThrow(/kg-guide-figures-1/);
  }, 60_000);
});

describe("bundleClient", () => {
  it("ships the tokens sheet beside the full one, from the same source file", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-css-"));
    const urls = await bundleClient(outDir, "/docs/", shellClient);
    expect(urls.cssUrl).toBe("/docs/_pagina/pagina.css");
    expect(urls.tokensCssUrl).toBe("/docs/_pagina/pagina.tokens.css");

    // Copied verbatim: the tokens sheet is the file `pagina.css` imports, not a re-derivation.
    const tokens = await readFile(join(outDir, "_pagina/pagina.tokens.css"), "utf8");
    const source = await readFile(new URL("../../shell-static/client/tokens.css", import.meta.url), "utf8");
    expect(tokens).toBe(source);
    expect(tokens).toContain("@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome;");

    // The bundled sheet is minified by lightningcss, which drops the standalone `@layer`
    // declaration *because* it has already sorted the blocks into the declared order — so the
    // guarantee to assert on the emitted file is the block order, which is what the cascade
    // actually reads. (`docs/theming.md` says the same.)
    const css = await readFile(join(outDir, "_pagina/pagina.css"), "utf8");
    expect([...css.matchAll(/@layer\s+([a-z.]+)\s*\{/g)].map((m) => m[1])).toEqual([
      "pagina.reset", "pagina.tokens", "pagina.reading", "pagina.chrome",
    ]);
    expect(css).not.toContain("@import");
    expect(css).toContain("--pg-accent");
  }, 60_000);

  it("skips the tokens sheet for a shell that has none", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-css-none-"));
    const urls = await bundleClient(outDir, "/", stubShell.clientEntry);
    expect(urls.tokensCssUrl).toBeUndefined();
    expect(existsSync(join(outDir, "_pagina/pagina.tokens.css"))).toBe(false);
  }, 60_000);
});
