/**
 * An article that ships its own Kineglyph theme gets painted in it — pre-rendered and hydrated.
 *
 * A figure resolves every fill as `var(--kg-color-<role>, <literal>)`. The literal is the palette
 * the figure was **drawn** with, server-side, from the module `article.yaml` names. The variable is
 * what the page **paints** with, and `pagina.css` defines every one of them as the matching `--pg-*`
 * token — which is how a host retints diagrams it never drew, and which also meant that an article
 * declaring its own theme had that declaration overruled at paint time. The served SVG said
 * `#237f74`; every reader saw pagina's `#3b5bdb`, a colour that appears nowhere in the article.
 *
 * That is not visible in the markup — the markup was always right — so it is measured here the only
 * way it can be: `getComputedStyle` in a real browser, over the *built* site, for both the frame a
 * reader sees before the runtime lands and the stage that replaces it. The two must agree with each
 * other and with the declaration, in both themes. Eyeballing is how this survived; two numbers is
 * what replaces it.
 *
 * The `bundle` project, because the artefact under test is a `buildStatic` output on a plain Node
 * server, and because the sibling `guide/figures/` page of the *unthemed* build is what proves the
 * host-follows-tokens case still holds next door.
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

  test("is painted in the colours the article declared", async ({ page }) => {
    await page.goto(`${THEMED_BASE}guide/figures/`);
    expect(await canvasOf(page, STATIC)).toBe(rgb(THEMED_COLORS.light.canvas));
    await page.locator(FIGURE).screenshot({ path: `${SHOTS}prerendered-light.png` });
  });

  test("and in the article's dark palette when the page is dark", async ({ page }) => {
    await page.goto(`${THEMED_BASE}guide/figures/`);
    await page.evaluate(() => (document.documentElement.dataset["theme"] = "dark"));
    expect(await canvasOf(page, STATIC)).toBe(rgb(THEMED_COLORS.dark.canvas));
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
    expect(hydrated).toBe(rgb(THEMED_COLORS.light.canvas));
    await page.locator(FIGURE).screenshot({ path: `${SHOTS}hydrated-light.png` });
  });

  test("follows the reader's theme without disagreeing with the frame", async ({ page }) => {
    await page.goto(`${THEMED_BASE}guide/figures/`);
    await settled(page);
    await page.evaluate(() => (document.documentElement.dataset["theme"] = "dark"));
    await expect
      .poll(async () => await canvasOf(page, LIVE))
      .toBe(rgb(THEMED_COLORS.dark.canvas));
    expect(await canvasOf(page, STATIC)).toBe(rgb(THEMED_COLORS.dark.canvas));
    await page.locator(FIGURE).screenshot({ path: `${SHOTS}hydrated-dark.png` });
  });
});

test("an article that declares no theme still follows its host's tokens", async ({ page }) => {
  await page.goto(`${SITE_BASE}guide/figures/`);
  // pagina's `--pg-bg-raised`, which is what the bridge in `pagina.css` is for — and which the
  // themed build above must *not* be showing, or the two cases have been confused for each other.
  const unthemed = await canvasOf(page, STATIC);
  expect(unthemed).toBe("rgb(246, 247, 249)");
  expect(unthemed).not.toBe(rgb(THEMED_COLORS.light.canvas));
});
