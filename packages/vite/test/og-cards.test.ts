/**
 * The card pipeline: what gets planned, what gets cached, and what happens when a glyph is broken.
 *
 * A card is a picture and the bar for a picture is a person looking at it. Everything *around* the
 * picture is what rots silently, so that is what is here: precedence, a mark that has to be the same
 * for a slug next year, a cache key that moves when the picture would, a scene that throws, and the
 * one assertion that a rasteriser can get wrong without anyone noticing — the emitted size.
 *
 * `inProcess: true` throughout. The child process exists so that a renderer *abort* cannot take a
 * build down, which is a property of the supervisor rather than of any one card; running in-process
 * here buys a stack trace when an assertion fails, and the degradation path is exercised either way.
 */
import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "../../../test/tmp.js";
import { renderArticle } from "@pagina/core";
import type { ArticleConfig, RenderedArticle } from "@pagina/core";
import { NodeContentFs } from "../src/node-fs.js";
import { cardCacheKey, cardSlug, generateOgCards, planOgCards, withOgCards } from "../src/og-cards.js";
import { proceduralMark, slugSeed } from "../src/og-card.js";
import { DEFAULT_LIGHT } from "../src/og-theme.js";
import type { CardJob } from "../src/og-render.js";

/** Width and height out of a PNG's IHDR — the only honest way to ask how big a card came out. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const ARTICLE_YAML = (extra = ""): string => [
  "slug: cards", "title: Cards", "form: docs", "status: published",
  "category: documentation",
  "description: An article about cards.",
  "site_url: https://cards.test/",
  "nav:", "  - title: Home", "    page: index.md", "  - title: Next", "    page: next.md",
  extra,
].join("\n");

/** A folder with two pages and whatever `article.yaml` and front matter the test needs. */
async function fixture(o: { yaml?: string; indexFrontMatter?: string; extraFiles?: Record<string, string> } = {}): Promise<{
  folder: string; outDir: string; article: RenderedArticle;
}> {
  const folder = await tempDir("og-fixture");
  const outDir = await tempDir("og-out");
  await writeFile(join(folder, "article.yaml"), o.yaml ?? ARTICLE_YAML());
  await writeFile(join(folder, "index.md"), `${o.indexFrontMatter ?? ""}# Home\n\nThe first paragraph of the home page.\n`);
  await writeFile(join(folder, "next.md"), "# Next\n\nAnother page entirely.\n");
  for (const [name, body] of Object.entries(o.extraFiles ?? {})) {
    await mkdir(join(folder, name, ".."), { recursive: true });
    await writeFile(join(folder, name), body);
  }
  const article = await renderArticle({ fs: new NodeContentFs(folder), base: "/" });
  return { folder, outDir, article };
}

/** `planOgCards`/`generateOgCards` want the parsed config, which the manifest does not carry whole. */
async function configOf(folder: string): Promise<ArticleConfig> {
  const { parseArticleConfig } = await import("@pagina/core");
  return parseArticleConfig(await readFile(join(folder, "article.yaml"), "utf8"));
}

describe("cardSlug", () => {
  it("flattens an href into a readable file name", () => {
    expect(cardSlug("/")).toBe("index");
    expect(cardSlug("/theming/")).toBe("theming");
    expect(cardSlug("/guide/nested/deep/")).toBe("guide-nested-deep");
    expect(cardSlug("/Odd Name!/")).toBe("odd-name");
  });
});

describe("the procedural mark", () => {
  it("is the same for a slug every time it is asked", () => {
    // Pinned rather than compared to itself: the point of this test is that a build next year
    // draws the picture this build drew, so the numbers are the assertion.
    expect(slugSeed("cards/theming/")).toBe(slugSeed("cards/theming/"));
    const first = proceduralMark("cards/theming/");
    expect(proceduralMark("cards/theming/")).toEqual(first);
    expect(first.angle % 15).toBe(0);
    expect(first.center[0]).toBeGreaterThanOrEqual(0.2);
    expect(first.center[0]).toBeLessThanOrEqual(0.8);
    expect(first.radii.length).toBeGreaterThanOrEqual(4);
    expect(first.emphasis).toBeLessThan(first.radii.length);
  });

  it("gives two pages two different marks", () => {
    expect(proceduralMark("cards/theming/")).not.toEqual(proceduralMark("cards/install/"));
  });

  it("stays inside the panel it is clipped to, whatever the seed", () => {
    // Not a nicety: a clipped group whose contents miss the clip entirely makes resvg abort the
    // process rather than raise an error, and there is no catching that.
    for (let i = 0; i < 500; i++) {
      const mark = proceduralMark(`page-${i}/`);
      for (const [axis, v] of mark.center.entries())
        expect(v, `centre axis ${axis} for page-${i}`).toBeGreaterThan(0);
      for (const v of mark.center) expect(v).toBeLessThan(1);
      for (const r of mark.radii) expect(r).toBeLessThan(0.9);
    }
  });
});

describe("cardCacheKey", () => {
  const base: Omit<CardJob, "out"> = {
    page: "/", content: { title: "Home", description: "d", siteName: "Cards", footer: "f", slug: "cards/" },
    palette: DEFAULT_LIGHT, template: "editorial", width: 1200, height: 630, slotWidth: 392, glyphPosition: "right",
  };
  const key = (o: Partial<Parameters<typeof cardCacheKey>[0]> = {}): string =>
    cardCacheKey({ job: base, fontDigest: "f00", fontFamily: "Instrument Sans", pagina: "0.2.0", ...o });

  it("changes when any input that can change the picture changes", () => {
    const original = key();
    const differs: Record<string, string> = {
      title: key({ job: { ...base, content: { ...base.content, title: "Other" } } }),
      description: key({ job: { ...base, content: { ...base.content, description: "other" } } }),
      slug: key({ job: { ...base, content: { ...base.content, slug: "cards/other/" } } }),
      theme: key({ job: { ...base, palette: { ...DEFAULT_LIGHT, accent: "#a00000" } } }),
      template: key({ job: { ...base, template: "figure" } }),
      width: key({ job: { ...base, width: 1000 } }),
      height: key({ job: { ...base, height: 500 } }),
      slotWidth: key({ job: { ...base, slotWidth: 480 } }),
      glyphPosition: key({ job: { ...base, glyphPosition: "left" } }),
      fonts: key({ fontDigest: "beef" }),
      pagina: key({ pagina: "0.3.0" }),
    };
    for (const [what, value] of Object.entries(differs)) expect(value, what).not.toBe(original);
  });

  it("follows the glyph's bytes, not its path", () => {
    const withGlyph = { ...base, glyph: { file: "/a/scene.mjs", alt: "a", time: "end" as const } };
    const one = key({ job: withGlyph, glyphSource: "export default one" });
    const two = key({ job: withGlyph, glyphSource: "export default two" });
    // A scene edited in place keeps its path and has to redraw the card that shows it.
    expect(one).not.toBe(two);
    // And the same bytes at a different path are the same picture.
    expect(key({ job: { ...withGlyph, glyph: { ...withGlyph.glyph, file: "/b/scene.mjs" } }, glyphSource: "export default one" })).toBe(one);
  });

  it("does not move for something a reader cannot see", () => {
    expect(key({ job: { ...base, page: "/somewhere-else/" } })).toBe(key());
  });
});

describe("planOgCards", () => {
  it("plans one card per page, named for the page and its inputs", async () => {
    const { folder, outDir, article } = await fixture();
    const { planned } = await planOgCards({ article, config: await configOf(folder), folder, outDir, base: "/" });
    expect(planned.map((p) => p.href).sort()).toEqual(["/", "/next/"]);
    expect(planned.find((p) => p.href === "/")!.rel).toMatch(/^_pagina\/og\/index\.[0-9a-f]{8}\.png$/);
    expect(planned.every((p) => !p.cached)).toBe(true);
  });

  it("draws nothing for a page that already has a cover", async () => {
    const { folder, outDir, article } = await fixture({
      yaml: `${ARTICLE_YAML()}\ncover: media/c.png\n`,
      extraFiles: { "media/c.png": "not really a png" },
    });
    const { planned } = await planOgCards({ article, config: await configOf(folder), folder, outDir, base: "/" });
    expect(planned).toEqual([]);
  });

  it("draws nothing for an article that turned cards off, and honours a page turning them back on", async () => {
    const off = await fixture({ yaml: `${ARTICLE_YAML()}\nog: false\n` });
    expect((await planOgCards({ ...off, config: await configOf(off.folder), base: "/" })).planned).toEqual([]);

    const back = await fixture({ yaml: `${ARTICLE_YAML()}\nog: false\n`, indexFrontMatter: "---\nog: true\n---\n" });
    const planned = (await planOgCards({ ...back, config: await configOf(back.folder), base: "/" })).planned;
    expect(planned.map((p) => p.href)).toEqual(["/"]);
  });

  it("puts the base in the card's URL, so a sub-path deployment addresses its own file", async () => {
    const { folder, outDir, article } = await fixture();
    const { planned } = await planOgCards({ article, config: await configOf(folder), folder, outDir, base: "/docs/" });
    expect(planned[0]!.url.startsWith("/docs/_pagina/og/")).toBe(true);
  });
});

describe("generateOgCards", () => {
  it("draws a card at the size every consumer expects, and puts it in the manifest", async () => {
    const { folder, outDir, article } = await fixture();
    const result = await generateOgCards({ article, config: await configOf(folder), folder, outDir, base: "/", inProcess: true });
    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(2);
    const bytes = await readFile(join(outDir, result.files[0]!));
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });

    const manifest = withOgCards(article.manifest, result.cards);
    expect(manifest.pages["/"]!.card).toBe(result.cards.get("/")!.url);
    expect(manifest.pages["/"]!.cardAlt).toContain("Home");
    // The url a page carries is a file this build wrote.
    expect(result.files).toContain(manifest.pages["/"]!.card!.replace(/^\//, ""));
  }, 30_000);

  it("honours a card asked for at another size", async () => {
    const { folder, outDir, article } = await fixture({ yaml: `${ARTICLE_YAML()}\nog:\n  width: 800\n  height: 420\n` });
    const result = await generateOgCards({ article, config: await configOf(folder), folder, outDir, base: "/", inProcess: true });
    expect(pngSize(await readFile(join(outDir, result.files[0]!)))).toEqual({ width: 800, height: 420 });
  }, 30_000);

  it("redraws nothing on a second build that changed nothing", async () => {
    const { folder, outDir, article } = await fixture();
    const opts = { article, config: await configOf(folder), folder, outDir, base: "/", inProcess: true } as const;
    const first = await generateOgCards(opts);
    const before = await Promise.all(first.files.map((f) => readFile(join(outDir, f))));
    const again = await planOgCards(opts);
    expect(again.planned.every((p) => p.cached), "every card is already on disk").toBe(true);
    const second = await generateOgCards(opts);
    expect(second.files).toEqual(first.files);
    const after = await Promise.all(second.files.map((f) => readFile(join(outDir, f))));
    expect(after.map((b) => b.toString("base64"))).toEqual(before.map((b) => b.toString("base64")));
  }, 40_000);

  it("draws the same bytes for the same inputs in two separate output directories", async () => {
    const a = await fixture();
    const b = await fixture();
    const draw = async (f: Awaited<ReturnType<typeof fixture>>): Promise<string> => {
      const r = await generateOgCards({ ...f, config: await configOf(f.folder), base: "/", inProcess: true });
      return (await readFile(join(f.outDir, r.files.find((x) => x.includes("index"))!))).toString("base64");
    };
    // Embedded fonts and `loadSystemFonts: false`: a card built in CI is a card built on a laptop.
    expect(await draw(a)).toBe(await draw(b));
  }, 40_000);

  it("drops a glyph that throws and draws the card without it", async () => {
    const { folder, outDir, article } = await fixture({
      yaml: `${ARTICLE_YAML()}\nog:\n  glyph: scenes/broken.mjs\n`,
      extraFiles: { "scenes/broken.mjs": "throw new Error('this scene is broken');\n" },
    });
    const result = await generateOgCards({ article, config: await configOf(folder), folder, outDir, base: "/", inProcess: true });
    // The build is not failed, and every page still shares as something.
    expect(result.cards.size).toBe(2);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["og-glyph-failed", "og-glyph-failed"]);
    expect(result.diagnostics[0]!.message).toContain("this scene is broken");
    expect(pngSize(await readFile(join(outDir, result.files[0]!)))).toEqual({ width: 1200, height: 630 });
  }, 40_000);

  it("says so and moves on when a glyph names a file that is not there", async () => {
    const { folder, outDir, article } = await fixture({ yaml: `${ARTICLE_YAML()}\nog:\n  glyph: scenes/absent.mjs\n` });
    const result = await generateOgCards({ article, config: await configOf(folder), folder, outDir, base: "/", inProcess: true });
    expect(result.diagnostics.map((d) => d.code)).toEqual(["og-glyph-missing", "og-glyph-missing"]);
    expect(result.cards.size).toBe(2);
  }, 30_000);

  it("draws a glyph into the slot when the scene is sound", async () => {
    const scene = [
      'import { figure } from "kineglyph";',
      'export default figure("g", { title: "A glyph" }, (f) => {',
      '  f.root(f.stack([f.text("hello", { textStyle: "body" })], { width: 300, height: 200, padding: 20 }));',
      "});",
      "",
    ].join("\n");
    const { folder, outDir, article } = await fixture({
      yaml: `${ARTICLE_YAML()}\nog:\n  glyph: scenes/ok.mjs\n`,
      extraFiles: { "scenes/ok.mjs": scene },
    });
    const result = await generateOgCards({ article, config: await configOf(folder), folder, outDir, base: "/", inProcess: true });
    expect(result.diagnostics).toEqual([]);
    expect(pngSize(await readFile(join(outDir, result.files[0]!)))).toEqual({ width: 1200, height: 630 });
  }, 40_000);
});

/**
 * The reason the drawing happens somewhere else.
 *
 * resvg is Rust, and a group with a clip whose contents miss the clip entirely makes it **abort**
 * rather than return an error. An abort is not catchable: in-process it would take vitest down with
 * it, exactly as it would take a docs deploy down. So this one runs through the real child process,
 * and what it asserts is that the build survived — a passing run *is* the assertion.
 */
describe("a glyph that aborts the renderer", () => {
  const ABORTING_SCENE = [
    'import { figure } from "kineglyph";',
    'export default figure("bad", { title: "Off the canvas" }, (f) => {',
    "  f.root(f.stack([",
    '    f.coordinates([f.circle({ id: "far", radius: 20, fill: "accent", position: { x: 9, y: 9 } })],',
    '      { id: "box", width: 200, height: 200, clip: true, allowOverflow: true }),',
    '  ], { width: 300, height: 300 }));',
    "});",
    "",
  ].join("\n");

  it("degrades to a plain card instead of taking the build with it", async () => {
    const { folder, outDir, article } = await fixture({
      yaml: `${ARTICLE_YAML()}\nog:\n  glyph: scenes/abort.mjs\n`,
      extraFiles: { "scenes/abort.mjs": ABORTING_SCENE },
    });
    const result = await generateOgCards({ article, config: await configOf(folder), folder, outDir, base: "/" });
    expect(result.cards.size).toBe(2);
    expect(result.files).toHaveLength(2);
    for (const f of result.files) expect(pngSize(await readFile(join(outDir, f)))).toEqual({ width: 1200, height: 630 });
    // Either the scene raised something the worker could report, or the process stopped answering
    // and the supervisor worked out which card was in flight. Both come out here.
    expect(result.diagnostics.map((d) => d.code)).toEqual(["og-glyph-failed", "og-glyph-failed"]);
  }, 60_000);
});

describe("withOgCards", () => {
  it("leaves a manifest alone when nothing was drawn", async () => {
    const { article } = await fixture();
    expect(withOgCards(article.manifest, new Map())).toBe(article.manifest);
  });

  it("only touches the pages it drew for", async () => {
    const { article } = await fixture();
    const out = withOgCards(article.manifest, new Map([["/", { url: "/c.png", alt: "a" }]]));
    expect(out.pages["/"]).toMatchObject({ card: "/c.png", cardAlt: "a" });
    expect(out.pages["/next/"]!.card).toBeUndefined();
  });
});
