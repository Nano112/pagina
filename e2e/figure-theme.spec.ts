/**
 * A figure is painted by the page it sits in — pre-rendered and hydrated, in both themes.
 *
 * A figure resolves every fill as `var(--kg-color-<role>, <literal>)`. The literal is the palette
 * the figure was **drawn** with, server-side, from the module `article.yaml` names; the variable is
 * what the page **paints** with, and `tokens.css` points every one of them at the matching `--pg-*`.
 * That bridge is what makes a diagram look like it belongs to the article around it, and it is what
 * lets a host retint diagrams it never drew.
 *
 * pagina used to publish a declared theme's colours as `--kg-color-*` on `:root`, unlayered, after
 * the stylesheet — so an article's declaration beat the bridge, beat a host's own mapping, and beat
 * the page's theme. A light-declared figure stayed light on a dark site, and "just follow the page"
 * could only be said by deleting the declaration. The inversion is the subject of this file: a
 * figure inherits, and a theme scopes its claims to whatever declared it.
 *
 * None of that is visible in the markup — the markup was always right — so it is measured the only
 * way it can be: `getComputedStyle` in a real browser, over the *built* site, for both the frame a
 * reader sees before the runtime lands and the stage that replaces it. The two must agree with each
 * other and with the page. Eyeballing is how the old defect survived; two numbers is what replaces
 * it.
 *
 * The `bundle` project, because the artefact under test is a `buildStatic` output on a plain Node
 * server, and the *themed* build is the interesting one: it is the article that declares a palette
 * and must still follow its page.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { SITE_BASE, THEMED_BASE, THEMED_COLORS } from "./setup.js";

const SHOTS = fileURLToPath(new URL("../test-results/figure-theme/", import.meta.url));
const FIGURE = "figure.kg#kg-guide-figures-1";
/** The server-rendered frame, and the stage the runtime mounts over it. */
const STATIC = `${FIGURE} .kg-frame > svg`;
const LIVE = `${FIGURE} [data-kg-stage] svg`;

/** `#f4f1e9` → `rgb(244, 241, 233)`, which is what `getComputedStyle` hands back. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`;
}

/** pagina's own `--pg-bg-raised`, which `--kg-color-canvas` is pointed at, light and dark. */
const PAGE_CANVAS = { light: "rgb(246, 247, 249)", dark: "rgb(28, 31, 38)" };

/** The colour the browser actually resolves for a figure's canvas. */
const canvasOf = (page: Page, selector: string): Promise<string> =>
  page.locator(selector).first().evaluate((svg) => getComputedStyle(svg.querySelector(".kg-canvas")!).fill);

async function settled(page: Page): Promise<void> {
  await expect(page.locator(LIVE)).toBeVisible();
  await page.waitForFunction((sel) => {
    const svg = document.querySelector(sel);
    return svg !== null && Number(getComputedStyle(svg).getPropertyValue("--kg-timeline-progress")) >= 1;
  }, LIVE);
}

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
});

test.describe("a figure before the runtime lands", () => {
  test.use({ javaScriptEnabled: false });

  test("takes the page's colours, though its article declares a palette of its own", async ({ page }) => {
    await page.goto(`${THEMED_BASE}guide/figures/`);
    expect(await canvasOf(page, STATIC)).toBe(PAGE_CANVAS.light);
    await page.locator(FIGURE).screenshot({ path: `${SHOTS}prerendered-light.png` });
  });

  test("moves with the page when the page goes dark", async ({ page }) => {
    await page.goto(`${THEMED_BASE}guide/figures/`);
    await page.evaluate(() => (document.documentElement.dataset["theme"] = "dark"));
    expect(await canvasOf(page, STATIC)).toBe(PAGE_CANVAS.dark);
  });

  test("still carries the declared colour as its fallback, for a page with no tokens", async ({ page }) => {
    // The declaration is not lost, it is demoted: it is what draws the figure where the page says
    // nothing, which is what makes a figure legible outside pagina entirely.
    await page.goto(`${THEMED_BASE}guide/figures/`);
    const fill = await page.locator(STATIC).first().evaluate((svg) => svg.querySelector(".kg-canvas")!.getAttribute("fill"));
    expect(fill).toContain(THEMED_COLORS.light.canvas);
  });
});

test.describe("a figure once the runtime has mounted", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("is painted exactly as the pre-rendered frame was", async ({ page }) => {
    await page.goto(`${THEMED_BASE}guide/figures/`);
    // Read before hydration hides it, so the two numbers come from one page load.
    const prerendered = await canvasOf(page, STATIC);
    await settled(page);
    const hydrated = await canvasOf(page, LIVE);

    expect(hydrated).toBe(prerendered);
    expect(hydrated).toBe(PAGE_CANVAS.light);
    await page.locator(FIGURE).screenshot({ path: `${SHOTS}hydrated-light.png` });
  });

  test("follows the reader's theme without disagreeing with the frame", async ({ page }) => {
    await page.goto(`${THEMED_BASE}guide/figures/`);
    await settled(page);
    await page.evaluate(() => (document.documentElement.dataset["theme"] = "dark"));
    await expect.poll(async () => await canvasOf(page, LIVE)).toBe(PAGE_CANVAS.dark);
    expect(await canvasOf(page, STATIC)).toBe(PAGE_CANVAS.dark);
    await page.locator(FIGURE).screenshot({ path: `${SHOTS}hydrated-dark.png` });
  });

  test("follows a host that mapped only --pg-*, which is what used to be impossible", async ({ page }) => {
    // The reported failure, reproduced: a host recolours its surfaces and says nothing about
    // diagrams, and the diagram in an article that ships its own theme comes with it.
    await page.goto(`${THEMED_BASE}guide/figures/`);
    await settled(page);
    await page.addStyleTag({ content: ":root{--pg-bg-raised:#101216}" });
    await expect.poll(async () => await canvasOf(page, LIVE)).toBe(rgb("#101216"));
  });
});

test("an article that declares no theme is not a different case any more", async ({ page }) => {
  await page.goto(`${SITE_BASE}guide/figures/`);
  // The same number as the themed build's: declaring a theme changed what the figure was *drawn*
  // with, and drawing is no longer what decides what a reader sees.
  expect(await canvasOf(page, STATIC)).toBe(PAGE_CANVAS.light);
});
