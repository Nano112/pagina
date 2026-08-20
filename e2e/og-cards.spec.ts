/**
 * Social cards, drawn by the browser, at publish time.
 *
 * This runs in the `bundle` project — the *built* `dist/editor.js` on a plain Node server — for a
 * reason that is not the usual one. Everything this file asserts is a fact about a real browser:
 * `FontFace`, `<img>` decoding an SVG document, `canvas.toBlob`, and whether any of that taints a
 * canvas. jsdom has none of it. A unit test here could only check that we *called* `toBlob`, which
 * is the one thing that was never in doubt.
 *
 * So the spec publishes the fixture from the editor and then looks at what landed on the backend:
 * that it is a PNG, that it is 1200×630, that the ink in it is the card's composition rather than a
 * blank rectangle or a fallback font, and that publishing again does not redraw it.
 *
 * It also compares each card against the one `buildStatic` drew for the same page with resvg. Not
 * byte-for-byte — the two rasterisers antialias differently, and Node's HarfBuzz measurement does
 * not apply the font's variable weight axis where the browser's does, so heavy text can wrap a line
 * earlier on one path. What is compared is what a reader would notice: the same size, the same
 * ground colour, the same accent in the same place, and ink in the same regions.
 */
import { expect, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CARDS_ARTICLE, CARDS_SITE } from "./setup.js";

/** The card directory, under whichever root wrote it. */
const OG = "_pagina/og";

/** Width, height and colour type, read straight out of the IHDR chunk. */
function pngHeader(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [i, byte] of signature.entries()) {
    if (bytes[i] !== byte) throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 8 bytes of signature, 4 of length, 4 of "IHDR", then the two dimensions.
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Every card in a directory, by file name. */
async function cardsIn(root: string): Promise<Map<string, Uint8Array>> {
  const dir = join(root, OG);
  const out = new Map<string, Uint8Array>();
  if (!existsSync(dir)) return out;
  for (const name of await readdir(dir)) {
    if (name.endsWith(".png")) out.set(name, new Uint8Array(await readFile(join(dir, name))));
  }
  return out;
}

/** Publishes through the element's own `publish()`, the way a host does, and returns the manifest. */
async function publish(page: import("@playwright/test").Page): Promise<Record<string, { card?: string; cardAlt?: string }>> {
  return await page.evaluate(async () => {
    const el = document.querySelector("[data-editor]") as HTMLElement & { publish(): Promise<{ article: { manifest: { pages: Record<string, { card?: string; cardAlt?: string }> } } }> };
    const result = await el.publish();
    return result.article.manifest.pages;
  });
}

test.describe("social cards drawn in the browser", () => {
  test("publishing draws a card per page and hands it to the backend", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });
    await page.goto("/cards-edit");
    await expect(page.locator("[data-editor] .ProseMirror")).toBeVisible({ timeout: 30_000 });

    const pages = await publish(page);
    const withCards = Object.entries(pages).filter(([, meta]) => meta.card !== undefined);
    expect(withCards.length).toBeGreaterThan(0);

    // Nothing quietly gave up: a page that could not be drawn says so, and none should have.
    expect(warnings.filter((w) => w.includes("og-card") || w.includes("card font"))).toEqual([]);

    const drawn = await cardsIn(CARDS_ARTICLE);
    expect(drawn.size).toBe(withCards.length);

    for (const [href, meta] of withCards) {
      const name = meta.card!.split("/").pop()!;
      const bytes = drawn.get(name);
      expect(bytes, `${href} → ${meta.card!} should be on the backend`).toBeDefined();
      // The size every crawler expects, and the one thing a card is allowed to be rejected for.
      expect(pngHeader(bytes!)).toEqual({ width: 1200, height: 630 });
      // A card with no alt text is the accessibility gap social cards reliably ship.
      expect(meta.cardAlt ?? "").not.toBe("");
    }
  });

  test("the embedded font is the font the card is actually drawn in", async ({ page }) => {
    await page.goto("/cards-edit");
    await expect(page.locator("[data-editor] .ProseMirror")).toBeVisible({ timeout: 30_000 });

    // The one fact the whole browser path rests on, tested directly rather than inferred from a
    // finished card: an `<img>`-rasterised SVG resolves an `@font-face` whose `src` is a `data:`
    // URI, and resolves nothing else. The card composition cannot show this — dropping the embed
    // leaves the layout, the palette and the slot untouched and swaps only the glyph shapes, which
    // is precisely the change a coarse comparison of two cards is blind to.
    const result = await page.evaluate(async () => {
      const mod = await import("/vendor/pagina/editor.js") as {
        loadCardFont(url: string): Promise<{ dataUri: string; family: string }>;
        embedCardFont(svg: string, font: { dataUri: string; family: string }): string;
        rasterisePng(svg: string, w: number, h: number): Promise<Blob>;
      };
      const font = await mod.loadCardFont("/vendor/pagina/pagina-card-font.ttf");
      const W = 600, H = 120;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><text x="10" y="80" font-family="${font.family}" font-size="64" font-weight="400" fill="#000">Handgloves</text></svg>`;

      const pixels = async (source: string | HTMLCanvasElement): Promise<Uint8ClampedArray> => {
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, W, H);
        if (typeof source === "string") {
          const blob = await mod.rasterisePng(source, W, H);
          context.drawImage(await createImageBitmap(blob), 0, 0);
        } else {
          context.drawImage(source, 0, 0);
        }
        return context.getImageData(0, 0, W, H).data;
      };

      // The reference: the same string, at the same size, drawn straight onto a canvas with the
      // `FontFace` this page registered. That is unambiguously Instrument Sans.
      const reference = document.createElement("canvas");
      reference.width = W; reference.height = H;
      const rc = reference.getContext("2d")!;
      rc.fillStyle = "#fff"; rc.fillRect(0, 0, W, H);
      rc.fillStyle = "#000";
      rc.font = `400 64px "${font.family}"`;
      rc.fillText("Handgloves", 10, 80);

      const differ = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) > 90) n++;
        return n / (W * H);
      };
      const ref = await pixels(reference);
      return {
        embedded: differ(await pixels(mod.embedCardFont(svg, font)), ref),
        bare: differ(await pixels(svg), ref),
      };
    });

    // With the font embedded, the SVG raster lands on the same glyphs as the canvas reference.
    expect(result.embedded).toBeLessThan(0.005);
    // Without it, the same SVG is drawn in the viewer's fallback face and does not.
    expect(result.bare).toBeGreaterThan(0.01);
  });

  test("a second publish reuses the cards rather than redrawing them", async ({ page }) => {
    await page.goto("/cards-edit");
    await expect(page.locator("[data-editor] .ProseMirror")).toBeVisible({ timeout: 30_000 });

    await publish(page);
    const first = await cardsIn(CARDS_ARTICLE);
    expect(first.size).toBeGreaterThan(0);
    const before = new Map([...first].map(([name, bytes]) => [name, bytes.byteLength]));

    // Publishing again with nothing changed must upload nothing: the file name carries the hash of
    // everything that can change the picture, so the plan's card is the card already at that URL.
    // Without this a debounced save would redraw every card on every keystroke.
    const uploads: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/upload")) uploads.push(request.url());
    });
    await publish(page);
    expect(uploads).toEqual([]);

    const second = await cardsIn(CARDS_ARTICLE);
    expect([...second].map(([n, b]) => [n, b.byteLength])).toEqual([...before]);
  });

  test("the browser's card and the build's card are the same picture", async ({ page }) => {
    await page.goto("/cards-edit");
    await expect(page.locator("[data-editor] .ProseMirror")).toBeVisible({ timeout: 30_000 });
    await publish(page);

    const built = await cardsIn(CARDS_SITE);
    const drawn = await cardsIn(CARDS_ARTICLE);
    test.skip(built.size === 0, "the fixture build drew no cards to compare against");

    // The same pages, under the same names: both paths hash the same inputs with the same function,
    // so a disagreement here is the caching quietly breaking rather than a picture looking different.
    expect([...drawn.keys()].sort()).toEqual([...built.keys()].sort());

    // And the same picture, compared the way a person compares two cards: downsample both to a
    // coarse grid and require the cells to land on the same colours. That survives antialiasing and
    // a line of text wrapping differently; it does not survive a blank card, a card in the wrong
    // palette, or a composition that moved.
    for (const [name, bytes] of drawn) {
      const mine = await grid(page, bytes);
      const theirs = await grid(page, built.get(name)!);
      const off = mine.filter((cell, i) => distance(cell, theirs[i]!) > 40);
      expect(off.length, `${name}: ${String(off.length)} of ${String(mine.length)} cells differ`).toBeLessThanOrEqual(mine.length * 0.1);
    }
  });

  test("a font that will not load costs the publish a picture, not the publish", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
    await page.goto("/cards-edit-no-font");
    await expect(page.locator("[data-editor] .ProseMirror")).toBeVisible({ timeout: 30_000 });

    // The publish still succeeds. That is the whole claim: a card is the least important thing in
    // this transaction, and an author who cannot draw one must not lose their article over it.
    const pages = await publish(page);
    expect(Object.keys(pages).length).toBeGreaterThan(0);
    expect(Object.values(pages).every((meta) => meta.card === undefined)).toBe(true);

    // Quiet, but not silent. A publish that drew no cards says so once, in terms that name the
    // cause and the consequence — not a stack trace, and not nothing at all.
    const said = warnings.filter((w) => w.includes("card font could not be loaded"));
    expect(said.length).toBe(1);
    expect(said[0]).toContain("the pages keep the cards the last build wrote");
  });

  test("a card is legible at the size it is actually read", async ({ page }) => {
    await page.goto("/cards-edit");
    await expect(page.locator("[data-editor] .ProseMirror")).toBeVisible({ timeout: 30_000 });
    const pages = await publish(page);
    const first = Object.values(pages).find((meta) => meta.card !== undefined);
    expect(first).toBeDefined();
    const name = first!.card!.split("/").pop()!;
    const bytes = (await cardsIn(CARDS_ARTICLE)).get(name)!;

    // A card is read at a quarter of its size, in a timeline, next to nine others. Scaled to 300px
    // the title has to still be ink on the ground rather than a grey wash — which is what a card
    // drawn in a font that failed to load, or with no text at all, collapses to.
    const ink = await page.evaluate(async ({ data }) => {
      const blob = new Blob([new Uint8Array(data)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 158;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0, 300, 158);
      const pixels = context.getImageData(0, 0, 300, 158).data;
      // Only the copy half. The other one is the slot — a saturated panel that is *supposed* to be
      // entirely unlike the ground, and including it would measure the slot rather than the type.
      const at = (x: number, y: number): number => (y * 300 + x) * 4;
      // The ground, read where the editorial template leaves the card empty: above the eyebrow.
      const ground = [pixels[at(150, 4)]!, pixels[at(150, 4) + 1]!, pixels[at(150, 4) + 2]!];
      let different = 0;
      let counted = 0;
      for (let y = 0; y < 158; y++) {
        for (let x = 0; x < 180; x++) {
          counted++;
          const i = at(x, y);
          const d = Math.abs(pixels[i]! - ground[0]!) + Math.abs(pixels[i + 1]! - ground[1]!) + Math.abs(pixels[i + 2]! - ground[2]!);
          if (d > 60) different++;
        }
      }
      return different / counted;
    }, { data: [...bytes] });

    // Enough ink to be a card with type on it — a card whose font failed to load draws nothing at
    // all here — and not so much that the copy half has become a solid block.
    expect(ink).toBeGreaterThan(0.01);
    expect(ink).toBeLessThan(0.5);
  });
});

/** Mean colour of each cell of a 12×7 grid over a card, computed in the browser's own decoder. */
async function grid(page: import("@playwright/test").Page, bytes: Uint8Array): Promise<[number, number, number][]> {
  return await page.evaluate(async ({ data }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 7;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0, 12, 7);
    const pixels = context.getImageData(0, 0, 12, 7).data;
    const cells: [number, number, number][] = [];
    for (let i = 0; i < pixels.length; i += 4) cells.push([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]);
    return cells;
  }, { data: [...bytes] });
}

const distance = (a: readonly number[], b: readonly number[]): number =>
  Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
