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
    await expect(page.locator(".pg-content h1")).toHaveText("Fixture");
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

  test("serves a sitemap and a robots.txt beside the pages", async ({ page }) => {
    const xml = await (await page.request.get(`${SITE_BASE}sitemap.xml`)).text();
    expect(xml).toContain("<loc>https://fixture.example/site/</loc>");
    expect(xml).toContain("<loc>https://fixture.example/site/guide/tabs/</loc>");
    const robots = await (await page.request.get(`${SITE_BASE}robots.txt`)).text();
    expect(robots).toContain("Sitemap: https://fixture.example/site/sitemap.xml");
    expect(robots).not.toContain("undefined");
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

    // The host's reset flattens headings; the reading layer must still be winning underneath.
    const h1 = await page.locator(".pg-content h1").evaluate((el) => getComputedStyle(el).fontSize);
    const body = await page.evaluate(() => getComputedStyle(document.body).fontSize);
    expect(parseFloat(h1)).toBeGreaterThan(parseFloat(body) * 1.4);

    await page.screenshot({ path: `${SHOTS}cover-dark-host.png`, fullPage: false });
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
