/**
 * Cover images and SEO, in a browser, on built assets, under a foreign host.
 *
 * Everything about this feature is invisible until it is wrong: a meta tag nobody reads until a
 * link preview is blank, an `og:image` that 404s on someone else's origin, a `<select>` that looks
 * fine on the machine it was written on and like macOS chrome on the host that ships it. So this
 * runs in the `bundle` project — `dist/pagina.css` and `dist/editor.css` as a host copies them, on
 * a plain Node server, under a preflight-shaped reset — and checks three things a unit test cannot:
 *
 *  - the **built page** carries the tags, and the values in them survive being read back;
 *  - the **cover** actually renders, at its intended proportions, in the host's dark palette;
 *  - the toolbar's own controls are **pagina's**, not the platform's — which is the half of the
 *    "no naked browser controls" rule that M1 left behind.
 *
 * The three screenshots it writes are the deliverable; the assertions are what stop them from
 * being three pictures of a defect nobody looked closely at.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { SITE_BASE } from "./setup.js";

const SHOTS = fileURLToPath(new URL("../test-results/metadata/", import.meta.url));

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
});

/** The content of a meta tag, as the browser parsed it — not as the string we hoped we wrote. */
const meta = async (page: Page, selector: string): Promise<string | null> =>
  await page.locator(`head ${selector}`).getAttribute("content");

test.describe("the published page's metadata", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SITE_BASE);
    // The landing page's title lives in the article header — moved there, not reprinted.
    await expect(page.locator(".pg-article-header h1")).toHaveText("Fixture");
  });

  test("carries title, description, canonical, OpenGraph and Twitter", async ({ page }) => {
    await expect(page).toHaveTitle("Fixture · Fixture Docs");
    expect(await meta(page, 'meta[name="description"]')).toBe("A fixture article, used by pagina's own tests.");
    expect(await page.locator('head link[rel="canonical"]').getAttribute("href")).toBe("https://fixture.example/site/");
    expect(await meta(page, 'meta[property="og:type"]')).toBe("article");
    expect(await meta(page, 'meta[property="og:site_name"]')).toBe("Fixture Docs");
    expect(await meta(page, 'meta[property="og:url"]')).toBe("https://fixture.example/site/");
    expect(await meta(page, 'meta[property="og:image"]')).toBe("https://fixture.example/site/media/cover.svg");
    expect(await meta(page, 'meta[property="article:author"]')).toBe("Fixture Author");
    expect(await meta(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    // A published article says nothing about robots; only a draft or a noindex page does.
    expect(await page.locator('head meta[name="robots"]').count()).toBe(0);
  });

  test("carries a JSON-LD Article the browser can parse", async ({ page }) => {
    const blocks = page.locator('head script[type="application/ld+json"]');
    await expect(blocks).toHaveCount(1);
    const parsed = JSON.parse((await blocks.textContent())!) as Record<string, unknown>;
    expect(parsed["@type"]).toBe("Article");
    expect(parsed["headline"]).toBe("Fixture");
    expect(parsed["author"]).toEqual({ "@type": "Person", name: "Fixture Author" });
    expect(parsed["mainEntityOfPage"]).toEqual({ "@type": "WebPage", "@id": "https://fixture.example/site/" });
    expect(parsed["image"]).toEqual(["https://fixture.example/site/media/cover.svg"]);
  });

  test("serves a sitemap beside the pages, and no robots.txt it has no right to", async ({ page }) => {
    // This site is built at `/site/`. A sitemap may list any URL at or below its own directory, so
    // it belongs exactly here.
    const xml = await (await page.request.get(`${SITE_BASE}sitemap.xml`)).text();
    expect(xml).toContain("<loc>https://fixture.example/site/</loc>");
    expect(xml).toContain("<loc>https://fixture.example/site/guide/tabs/</loc>");
    expect(xml).not.toContain("undefined");
    // `robots.txt` is read from `/robots.txt` and nowhere else, so `/site/robots.txt` would be a
    // file no crawler ever requests. The build says so and writes nothing rather than shipping
    // reassurance. See `docs/deploying.md`.
    expect((await page.request.get(`${SITE_BASE}robots.txt`)).status()).toBe(404);
  });

  test("shows the cover, and the cover is a file that actually loads", async ({ page }) => {
    const img = page.locator(".pg-cover__img");
    await expect(img).toBeVisible();
    expect(await img.getAttribute("src")).toBe("/site/media/cover.svg");
    // `naturalWidth` is 0 for an image the browser could not fetch or decode — which is what a
    // build that recorded a URL nothing serves would produce, silently.
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    // Above the article, below the breadcrumbs: the header slot, not a floating image.
    const order = await page.evaluate(() => {
      const cover = document.querySelector(".pg-cover")!;
      const content = document.querySelector(".pg-content")!;
      return cover.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeGreaterThan(0);
    // Alt text a screen reader can use: the article title, since the fixture supplies no
    // `cover_alt`. Never empty, and never "cover.svg".
    expect(await img.getAttribute("alt")).toBe("Fixture Docs");
  });

  test("renders the title once, in the header, with a meta row under it", async ({ page }) => {
    // The h1 is *moved* into the header, not reprinted: a hero that repeats the headline
    // immediately below it is the defect this header would otherwise introduce.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator(".pg-article-header h1")).toHaveText("Fixture");
    await expect(page.locator(".pg-content h1")).toHaveCount(0);
    // …and the heading keeps its id, so a link to it still lands.
    expect(await page.locator(".pg-article-header h1").getAttribute("id")).toBe("fixture");

    const row = page.locator(".pg-article-meta");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Fixture Author");
    await expect(row).toContainText("min read");
  });

  test("keeps the hero off a sub-page: a cover belongs to the article", async ({ page }) => {
    await page.goto(`${SITE_BASE}guide/tabs/`);
    await expect(page.locator(".pg-content h1")).toHaveText("Tabs and snippets");
    // The manifest resolves this page's cover to the article's — and the shell still must not
    // draw it. A reference page three levels in is not the front of the magazine.
    await expect(page.locator(".pg-article-header")).toHaveCount(0);
    await expect(page.locator(".pg-cover")).toHaveCount(0);
  });

  test("publishes one reading time that the manifest and the page agree on", async ({ page }) => {
    const manifest = await (await page.request.get(`${SITE_BASE}_pagina/manifest.json`)).json() as {
      article: { readingMinutes?: number };
      pages: Record<string, { readingMinutes?: number }>;
    };
    const root = manifest.pages["/"]!.readingMinutes;
    expect(Number.isInteger(root)).toBe(true);
    expect(root).toBeGreaterThanOrEqual(1);
    // The article's number is the sum of the pages', so a card and a page list cannot disagree.
    const sum = Object.values(manifest.pages).reduce((n, m) => n + (m.readingMinutes ?? 0), 0);
    expect(manifest.article.readingMinutes).toBe(sum);
    // And the number on the page is that same number, not one the shell recomputed.
    await expect(page.locator(".pg-article-meta")).toContainText(`${String(root)} min read`);
  });
});

test.describe("the cover under the host's dark theme", () => {
  test("takes the host's surfaces, with no rule overridden", async ({ page }) => {
    await page.goto("/site-dark");
    const img = page.locator(".pg-cover__img");
    await expect(img).toBeVisible();

    const paint = await img.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopColor, radius: s.borderTopLeftRadius, ratio: s.aspectRatio, fit: s.objectFit };
    });
    // `--pg-line: #262233` from the host's block, not pagina's default `#e3e6eb`.
    expect(paint.border).toBe("rgb(38, 34, 51)");
    expect(paint.radius).toBe("14px");                  // --pg-radius-lg: 0.875rem
    expect(paint.ratio).toBe("2 / 1");
    expect(paint.fit).toBe("cover");

    // The host's reset flattens headings; the header's own rules must still be winning underneath.
    // This is the half the reading layer no longer covers — the title lives outside `.pg-content`
    // now, so `pagina.chrome` has to restate the whole declaration or the hero arrives body-sized.
    const h1 = await page.locator(".pg-article-header h1").evaluate((el) => getComputedStyle(el).fontSize);
    const body = await page.evaluate(() => getComputedStyle(document.body).fontSize);
    expect(parseFloat(h1)).toBeGreaterThan(parseFloat(body) * 1.4);
    // The meta row takes the host's muted ink, not a colour pagina hardcoded.
    expect(await page.locator(".pg-article-meta").evaluate((el) => getComputedStyle(el).color))
      .toBe("rgb(154, 147, 171)");                      // the host's --pg-muted

    await page.screenshot({ path: `${SHOTS}cover-dark-host.png`, fullPage: false });
  });

  test("is absent on a sub-page of the same article, under the same host", async ({ page }) => {
    await page.goto("/site-dark-sub");
    await expect(page.locator(".pg-content h1")).toHaveText("Tabs and snippets");
    await expect(page.locator(".pg-article-header")).toHaveCount(0);
    await expect(page.locator(".pg-cover")).toHaveCount(0);
    // The picture of the negative: the same palette, the same layout, no hero.
    await page.screenshot({ path: `${SHOTS}sub-page-dark-host.png`, fullPage: false });
  });
});

test.describe("the toolbar's own controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admonitions/editing-dark");
    await expect(page.locator(".ProseMirror").first()).toBeVisible({ timeout: 30_000 });
  });

  test("are pagina's, not the platform's", async ({ page }) => {
    const select = page.locator('.pge-toolbar select[aria-label="Block type"]');
    await expect(select).toBeVisible();

    const painted = await select.evaluate((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, background: s.backgroundColor, colour: s.color, scheme: s.colorScheme };
    });
    // `appearance: none` is what stops the OS from painting it; without it every other assertion
    // here can pass while the control still looks like a macOS pill.
    expect(painted.appearance).toBe("none");
    expect(painted.background).toBe("rgb(11, 11, 15)");        // the host's --pg-bg
    expect(painted.colour).toBe("rgb(236, 233, 242)");         // the host's --pg-fg
    expect(painted.scheme).toBe("dark");                       // so the popup list opens dark too

    // The caret `appearance: none` removed is markup now, and it is a token colour.
    const caret = page.locator(".pge-toolbar .pge-select-wrap__caret");
    await expect(caret).toBeVisible();
    expect(await caret.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(154, 147, 171)");

    // The admonition insert is a real menu, not a `<select>` impersonating one.
    await expect(page.locator('.pge-toolbar select[aria-label="Insert admonition"]')).toHaveCount(0);
    const menu = page.locator('.pge-toolbar button[aria-label="Insert admonition"]');
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(page.locator('.pge-menu__list[role="menu"]')).toBeVisible();
    const item = page.locator('.pge-menu__item', { hasText: "Danger" });
    await expect(item).toBeVisible();
    expect(await page.locator(".pge-menu__list").evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(21, 21, 29)");                                // the host's --pg-bg-raised

    await page.screenshot({ path: `${SHOTS}toolbar-dark-host.png`, fullPage: false });
    await page.keyboard.press("Escape");
    await expect(page.locator(".pge-menu__list")).toHaveCount(0);
  });
});

test.describe("the Article settings panel", () => {
  test("edits the article's metadata, in the host's palette", async ({ page }) => {
    await page.goto("/admonitions/editing-dark");
    await expect(page.locator(".ProseMirror").first()).toBeVisible({ timeout: 30_000 });

    await page.locator('button[aria-label="Article settings"]').click();
    const panel = page.locator('[role="dialog"][aria-label="Article settings"]');
    await expect(panel).toBeVisible();

    // Every field the design asks for, and the cover's own controls. The fixture already has a
    // cover, so the panel shows its preview and offers to *replace* it rather than to upload one.
    await expect(panel.locator('input[aria-label="Cover path"]')).toHaveValue("media/cover.svg");
    await expect(panel.locator(".pge-cover-pick__img")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Replace" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Remove" })).toBeEnabled();
    await expect(panel.locator("textarea")).toBeVisible();

    await panel.locator("textarea").fill("A description typed in a browser.");
    await panel.locator("label", { hasText: "Author" }).locator("input").fill("Ada Lovelace");
    await panel.locator("label", { hasText: "Tags" }).locator("input").fill("one, two");

    await page.screenshot({ path: `${SHOTS}settings-dark-host.png`, fullPage: false });

    // The panel is drawn from tokens, not from a parallel palette.
    expect(await panel.locator(".pge-modal__panel").evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(11, 11, 15)");

    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel).toHaveCount(0);

    // …and it reached the file, through the comment-preserving path, over HTTP.
    await expect(async () => {
      const yaml = await (await page.request.get("/api/articles/fixture/files/article.yaml")).text();
      expect(yaml).toContain("author: Ada Lovelace");
      expect(yaml).toContain("description: A description typed in a browser.");
      expect(yaml).toContain("tags: [ one, two ]");
      // The nav the author wrote is still the nav the author wrote.
      expect(yaml).toContain("{ title: Home, page: index.md }");
    }).toPass({ timeout: 10_000 });
  });
});
