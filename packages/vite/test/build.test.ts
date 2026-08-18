import { describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticShell } from "@pagina/shell-static";
import { buildStatic, bundleClient } from "../src/index.js";
import { stubShell } from "./stub-shell.js";

const fixture = new URL("../../core/test/fixture/", import.meta.url).pathname;
/** The real shell's client entry, for the CSS-emission assertions below. */
const shellClient = new URL("../../shell-static/client/pagina.ts", import.meta.url).pathname;

/**
 * A throwaway copy of the fixture whose `article.yaml` has been edited.
 *
 * The fixture reaches *outside* its own folder for a snippet (`roots: [".", "../outside"]`), so a
 * copy that is not given a sibling `outside/` fails the build on a missing snippet rather than on
 * whatever the test is actually about.
 */
async function variant(edit: (yaml: string) => string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "pagina-variant-"));
  const folder = join(parent, "fixture");
  await cp(fixture, folder, { recursive: true });
  await cp(new URL("../../core/test/outside/", import.meta.url).pathname, join(parent, "outside"), { recursive: true });
  await writeFile(join(folder, "article.yaml"), edit(await readFile(join(folder, "article.yaml"), "utf8")));
  return folder;
}

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
      "chrome-demo.dark.svg",
      "chrome-demo.light.svg",
      "inline-demo.dark.svg",
      "inline-demo.light.svg",
      "instrument-demo.dark.svg",
      "instrument-demo.light.svg",
      "kg-guide-figures-1.dark.svg",
      "kg-guide-figures-1.light.svg",
    ]);
    expect(
      await readFile(join(outDir, "_pagina/figures/guide-figures/inline-demo.light.svg"), "utf8"),
    ).toContain("Inline");
    const html = await readFile(join(outDir, "guide/figures/index.html"), "utf8");
    // The figure is *in* the page, not linked from it. That is what lets the host's CSS and a
    // screen reader reach it, and it is why the SVG carries no XML declaration here.
    expect(html).toContain(`style="--kg-w:960;--kg-h:152"><div class="kg-frame" data-kg-static data-kg-frame="kg-guide-figures-1"><svg`);
    expect(html).toContain(`id="kg-guide-figures-1-light" class="kg-scene"`);
    expect(html).not.toContain("<?xml");
    expect(html).not.toContain("kg-export-background");
    // Colour is the page's to decide; the value it was drawn with is only the fallback.
    expect(html).toContain(`fill="var(--kg-color-text, `);
    expect(html).toContain(`"kineglyph":"/_pagina/kineglyph.js"`);
    // The client bundle keeps `kineglyph` as a bare import for the page's import map.
    const client = await readFile(join(outDir, "_pagina/pagina.js"), "utf8");
    expect(client.length).toBeGreaterThan(0);
    expect(/from\s*"kineglyph"/.test(client), client).toBe(true);
  }, 60_000);

  it("writes sitemap.xml and robots.txt for a standalone static site", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-seo-"));
    const r = await buildStatic({ folder: fixture, outDir, shell: stubShell, strict: true });
    expect(r.files).toContain("sitemap.xml");
    expect(r.files).toContain("robots.txt");
    // The fixture declares `site_url`, so the sitemap is absolute and complete.
    const xml = await readFile(join(outDir, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://fixture.example/</loc>");
    expect(xml).toContain("<loc>https://fixture.example/guide/tabs/</loc>");
    const robots = await readFile(join(outDir, "robots.txt"), "utf8");
    expect(robots).toContain("Sitemap: https://fixture.example/sitemap.xml");
    // The cover was copied by the ordinary asset pass, which is the whole point of that rule.
    expect((await stat(join(outDir, "media/cover.svg"))).isFile()).toBe(true);
  }, 60_000);

  it("skips the sitemap and warns rather than writing a relative one", async () => {
    const folder = await variant((yaml) => yaml.replace("site_url: https://fixture.example\n", ""));
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-nosite-"));
    const r = await buildStatic({ folder, outDir, shell: stubShell, strict: true });
    expect(existsSync(join(outDir, "sitemap.xml"))).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("sitemap-skipped");
    const robots = await readFile(join(outDir, "robots.txt"), "utf8");
    expect(robots).not.toContain("Sitemap");
    expect(robots).not.toContain("undefined");
  }, 60_000);

  it("lets --site-url override the folder, and honours base in the sitemap", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-siteurl-"));
    const r = await buildStatic({ folder: fixture, outDir, shell: stubShell, strict: true, base: "/docs/", siteUrl: "https://host.example" });
    const xml = await readFile(join(outDir, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://host.example/docs/</loc>");
    expect(xml).not.toContain("fixture.example");
    // The sitemap belongs here: it may list any URL at or below its own directory, and `/docs/` is
    // exactly what this deployment owns.
    expect(r.files).toContain("sitemap.xml");
  }, 60_000);

  it("writes no robots.txt under a sub-path, and says what to serve at the root instead", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-subpath-robots-"));
    const r = await buildStatic({ folder: fixture, outDir, shell: stubShell, strict: true, base: "/docs/", siteUrl: "https://host.example" });
    // A crawler reads robots.txt from `/robots.txt` and nowhere else. `/docs/robots.txt` would be a
    // file nothing ever requests — the one outcome that looks like coverage and provides none.
    expect(existsSync(join(outDir, "robots.txt"))).toBe(false);
    expect(r.files).not.toContain("robots.txt");
    expect(r.robots.outPath).toBeUndefined();
    expect(r.robots.rootSitemapLine).toBe("Sitemap: https://host.example/docs/sitemap.xml");
    expect(r.robots.reason).toContain("origin root");
    // Not a diagnostic: no edit to the folder could resolve it, so it must not fail a strict build.
    expect(r.diagnostics.map((d) => d.code)).not.toContain("robots-skipped");
    expect(r.diagnostics.map((d) => d.code)).not.toContain("seo-site-url-path-ignored");
  }, 60_000);

  it("points a mirror's canonical at the primary, and asks for no indexing of its own", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-mirror-"));
    const r = await buildStatic({
      folder: fixture, outDir, shell: staticShell, strict: true,
      base: "/Project/", siteUrl: "https://user.github.io", mirrorOf: "https://primary.example/docs/",
    });
    const html = await readFile(join(outDir, "guide/tabs/index.html"), "utf8");
    expect(html).toContain('<link rel="canonical" href="https://primary.example/docs/guide/tabs/">');
    expect(html).toContain('<meta property="og:url" content="https://primary.example/docs/guide/tabs/">');
    expect(html).not.toContain('canonical" href="https://user.github.io');
    // Submitting the mirror's own URLs for indexing would argue with every page's own head.
    expect(existsSync(join(outDir, "sitemap.xml"))).toBe(false);
    expect(r.files).not.toContain("sitemap.xml");
    // …and that is the intended outcome, so it is not reported as something that went wrong.
    expect(r.diagnostics.map((d) => d.code)).not.toContain("sitemap-skipped");
    // The mirror still serves its own images: og:image has to be fetchable from where the page is.
    expect(html).toContain('property="og:image" content="https://user.github.io/Project/media/cover.svg"');
  }, 60_000);

  it("warns when site_url carries a path the build is not served at", async () => {
    const folder = await variant((yaml) => yaml.replace("site_url: https://fixture.example", "site_url: https://fixture.example/docs/"));
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-pathmismatch-"));
    // Built at the root while `site_url` names `/docs/`: every canonical would read
    // `https://fixture.example/` — a plausible-looking URL that is not this article.
    const r = await buildStatic({ folder, outDir, shell: stubShell, strict: true });
    expect(r.diagnostics.map((d) => d.code)).toContain("seo-site-url-path-ignored");
    const matching = await buildStatic({ folder, outDir: await mkdtemp(join(tmpdir(), "pagina-build-pathmatch-")), shell: stubShell, strict: true, base: "/docs/" });
    expect(matching.diagnostics.map((d) => d.code)).not.toContain("seo-site-url-path-ignored");
  }, 60_000);

  it("disallows everything for a draft, and writes no sitemap", async () => {
    const folder = await variant((yaml) => yaml.replace("status: published", "status: draft"));
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-draft-"));
    await buildStatic({ folder, outDir, shell: staticShell, strict: true });
    expect(existsSync(join(outDir, "sitemap.xml"))).toBe(false);
    expect(await readFile(join(outDir, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /\n");
    // …and the switch holds on the page itself, not only in robots.txt.
    expect(await readFile(join(outDir, "index.html"), "utf8")).toContain('<meta name="robots" content="noindex, nofollow">');
  }, 60_000);

  it("puts base in every emitted URL but never in the output paths", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-build-base-"));
    const r = await buildStatic({ folder: fixture, outDir, shell: stubShell, strict: true, base: "/Nucleation/" });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const html = await readFile(join(outDir, "guide/figures/index.html"), "utf8");
    expect(html).toContain(`data-scene="/Nucleation/scenes/demo.mjs"`);
    expect(html).toContain(`"kineglyph":"/Nucleation/_pagina/kineglyph.js"`);
    // outDir is the directory served *at* base, so base must not appear inside it.
    const figs = await readdir(join(outDir, "_pagina/figures/guide-figures"));
    expect(figs.sort()).toEqual([
      "chrome-demo.dark.svg",
      "chrome-demo.light.svg",
      "inline-demo.dark.svg",
      "inline-demo.light.svg",
      "instrument-demo.dark.svg",
      "instrument-demo.light.svg",
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
    // One diagnostic per figure that referenced the broken module — the page has three, which is
    // the point: a build tells the author about every figure it could not draw, not just the first.
    expect(broken).toHaveLength(3);
    for (const d of broken) expect(d).toMatchObject({ severity: "error", page: "guide/figures.md" });
    expect(broken.map((d) => d.message).join("\n")).toContain("kg-guide-figures-1");
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
    expect(tokens).toContain("@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome, pagina.editor;");

    // The bundled sheet is minified by lightningcss, which drops the standalone `@layer`
    // declaration *because* it has already sorted the blocks into the declared order — so the
    // guarantee to assert on the emitted file is the block order, which is what the cascade
    // actually reads. (`docs/theming.md` says the same.)
    const css = await readFile(join(outDir, "_pagina/pagina.css"), "utf8");
    // Blocks *and* the bare `@layer x;` lightningcss keeps for a slot it has no block for
    // (`pagina.editor` — the site sheet reserves it so `editor.css` cannot land ahead of the
    // reading layer). Together they are the order the cascade reads.
    const order: string[] = [];
    for (const m of css.matchAll(/@layer\s+([a-z.,\s]+?)\s*[;{]/g)) {
      for (const name of m[1]!.split(",").map((s) => s.trim())) if (!order.includes(name)) order.push(name);
    }
    expect(order).toEqual([
      "pagina.reset", "pagina.tokens", "pagina.reading", "pagina.chrome", "pagina.editor",
    ]);
    // Both source `@import`s are inlined, so a host gets one file with one hash — an imported
    // sheet has no URL of its own for a cache-buster to stamp.
    expect(css).not.toContain("@import");
    expect(css).toContain(".pg-content h1");
    expect(css).toContain("--pg-accent");
  }, 60_000);

  /**
   * The defect this closes: `pagina.tokens.css` was a *name* — the template linked it and the
   * docs published it — with nothing checking that a build ever wrote a file under that name. A
   * `theme: "tokens"` site therefore shipped a `<link>` to a 404 and rendered untokenised.
   *
   * So: build at every theme level with the *real* shell, and follow each `<link rel=stylesheet>`
   * to the file it names. This is deliberately blind to which name is right — rename the artefact
   * or rename the reference, either fixes it; shipping a link nothing answers does not.
   */
  it.each(["full", "tokens", "none"] as const)("links only stylesheets that exist in the built site (theme: %s)", async (theme) => {
    const outDir = await mkdtemp(join(tmpdir(), `pagina-links-${theme}-`));
    await buildStatic({ folder: fixture, outDir, shell: staticShell, strict: true, base: "/docs/", theme });
    const html = await readFile(join(outDir, "index.html"), "utf8");
    const hrefs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]!);

    expect(hrefs).toEqual(theme === "none" ? [] : [`/docs/_pagina/pagina${theme === "tokens" ? ".tokens" : ""}.css`]);
    for (const href of hrefs) {
      // `outDir` is the directory served *at* base, so base comes off the front of the URL.
      const file = join(outDir, href.replace(/^\/docs\//, ""));
      expect(existsSync(file), `${href} is linked but ${file} was never written`).toBe(true);
      // A file, not an empty placeholder, and one that carries pagina's contract.
      expect(await readFile(file, "utf8")).toContain("--pg-accent");
    }
  }, 60_000);

  it("skips the tokens sheet for a shell that has none", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pagina-css-none-"));
    const urls = await bundleClient(outDir, "/", stubShell.clientEntry);
    expect(urls.tokensCssUrl).toBeUndefined();
    expect(existsSync(join(outDir, "_pagina/pagina.tokens.css"))).toBe(false);
  }, 60_000);
});
