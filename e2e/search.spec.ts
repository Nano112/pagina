/**
 * Search, on a **published site served as flat files**.
 *
 * Not the dev server, and not jsdom, for three reasons this spec is entirely about. The index is a
 * file a *build* writes, so the only honest place to ask whether it is there and correct is the
 * output directory. The dialog is a separate chunk reached by `import()`, so whether it is really
 * kept out of the first load is a question about a real network, not about a module graph. And
 * "the index is not fetched until someone searches" cannot be asserted anywhere that eagerly
 * bundles — which is exactly the shape of claim a dev server quietly makes true.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = "/site/";
const INDEX = `${SITE}_pagina/search.json`;
const SITE_DIR = fileURLToPath(new URL(".tmp/site/", import.meta.url));

/** The dialog's own elements, so a rename shows up as one failure rather than fifteen. */
const dialog = "[role='dialog']";
const input = ".pg-search__input";
const results = "[role='listbox'] [role='option']";

test.describe("the trigger", () => {
  test("ships disabled in the HTML and is enabled by the client", async ({ page }) => {
    // The served bytes, before any script has run: this is what a reader with scripting off gets.
    const html = readFileSync(`${SITE_DIR}index.html`, "utf8");
    expect(html).toContain("data-pg-search-open disabled");
    expect(html).toContain('title="Search needs JavaScript"');

    await page.goto(SITE);
    const trigger = page.locator("[data-pg-search-open]");
    await expect(trigger).toBeEnabled();
    await expect(trigger).not.toHaveAttribute("title", /JavaScript/);
  });

  test("opens the dialog, and the index is not fetched a moment before that", async ({ page }) => {
    const fetched: string[] = [];
    page.on("request", (r) => { if (r.url().includes("search.json")) fetched.push(r.url()); });
    await page.goto(SITE);
    await page.waitForLoadState("networkidle");
    // The whole weight argument for this design is this line.
    expect(fetched).toEqual([]);

    await page.locator("[data-pg-search-open]").click();
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator(input)).toBeFocused();
    // Polled rather than awaited on a response event: the fetch starts the instant the dialog
    // does, and a `waitForResponse` registered after the click can be registered after the answer.
    await expect.poll(() => fetched.length).toBe(1);
  });
});

test.describe("keys", () => {
  test("`/` opens it, and does not when the reader is already typing", async ({ page }) => {
    await page.goto(SITE);
    await page.keyboard.press("/");
    await expect(page.locator(dialog)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(dialog)).toBeHidden();

    // Inside the box itself, a slash is a slash — not a shortcut that eats the character.
    await page.keyboard.press("/");
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator(input)).toBeFocused();
    await page.keyboard.type("a/b");
    await expect(page.locator(input)).toHaveValue("a/b");
  });

  test("⌘K / Ctrl-K opens it too", async ({ page }) => {
    await page.goto(SITE);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(dialog)).toBeVisible();
  });

  test("arrows move the selection, Enter opens it at the section's anchor", async ({ page }) => {
    await page.goto(SITE);
    await page.keyboard.press("/");
    await page.locator(input).fill("figures");
    await expect(page.locator(results).first()).toBeVisible();

    // The listbox is driven from the input, which never loses focus.
    await expect(page.locator(input)).toBeFocused();
    await expect(page.locator(`${results}[aria-selected='true']`)).toHaveCount(1);
    const first = await page.locator(`${results}[aria-selected='true']`).getAttribute("id");
    await expect(page.locator(input)).toHaveAttribute("aria-activedescendant", String(first));
    await page.keyboard.press("ArrowDown");
    const second = await page.locator(`${results}[aria-selected='true']`).getAttribute("id");
    expect(second).not.toBe(first);
    await expect(page.locator(input)).toHaveAttribute("aria-activedescendant", String(second));

    // A section result must land on the section. Landing on the top of the page and leaving the
    // reader to scroll is the failure this whole "a document is a section" design exists to avoid.
    const href = await page.locator(`${results}[aria-selected='true'] a`).getAttribute("href");
    expect(href).toMatch(/^\/site\/.+#.+/);
    await page.keyboard.press("Enter");
    await expect(page.locator(dialog)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  });

  test("Escape closes and gives focus back to whatever had it", async ({ page }) => {
    await page.goto(SITE);
    const trigger = page.locator("[data-pg-search-open]");
    await trigger.click();
    await expect(page.locator(dialog)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(dialog)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("traps Tab inside the dialog", async ({ page }) => {
    await page.goto(SITE);
    await page.keyboard.press("/");
    const focused = async () =>
      page.evaluate(() => document.activeElement?.className ?? "");
    expect(await focused()).toContain("pg-search__input");
    await page.keyboard.press("Tab");
    expect(await focused()).toContain("pg-search__close");
    // Past the last focusable element, round to the first — never out into the page behind.
    await page.keyboard.press("Tab");
    expect(await focused()).toContain("pg-search__input");
    await page.keyboard.press("Shift+Tab");
    expect(await focused()).toContain("pg-search__close");
  });
});

test.describe("results", () => {
  test("says what it is before anything is typed, and says so plainly when nothing matches", async ({ page }) => {
    await page.goto(SITE);
    await page.keyboard.press("/");
    await expect(page.locator(".pg-search__state")).toContainText("Type a word");
    await expect(page.locator(results)).toHaveCount(0);

    await page.locator(input).fill("zzzznotaword");
    await expect(page.locator(".pg-search__state")).toContainText("Nothing matches");
    await expect(page.locator(".pg-search__count")).toHaveText("No results");
  });

  test("marks the matched word, and marks the whole word a prefix began", async ({ page }) => {
    await page.goto(SITE);
    await page.keyboard.press("/");
    await page.locator(input).fill("admoni");
    await expect(page.locator(`${results} mark`).first()).toHaveText(/admonitions?/i);
  });

  test("finds a diagram by what its author said it shows", async ({ page }) => {
    // The scene's `title`/`description` become the figure's `<title>`/`<desc>`, which a text
    // indexer over rendered HTML cannot read — the whole reason `svgProse` exists.
    await page.goto(SITE);
    await page.keyboard.press("/");
    await page.locator(input).fill("published");
    await expect(page.locator(results).first()).toBeVisible();
    await expect(page.locator(`${results} a[href*='/guide/figures/']`).first()).toBeVisible();
  });
});

test.describe("degrading", () => {
  test("says the index is unavailable rather than answering nothing", async ({ page }) => {
    await page.route(`**${INDEX}`, (route) => route.fulfill({ status: 503, body: "no" }));
    await page.goto(SITE);
    await page.keyboard.press("/");
    await expect(page.locator(".pg-search__state")).toContainText("Search is unavailable");
    await expect(page.locator(".pg-search__state")).toContainText("503");
    await expect(page.locator(".pg-search__retry")).toBeVisible();

    // And the retry is a retry: let it through, press it, and the box works.
    await page.unroute(`**${INDEX}`);
    await page.locator(".pg-search__retry").click();
    await page.locator(input).fill("tabs");
    await expect(page.locator(results).first()).toBeVisible();
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test("fills the screen and never makes the page scroll sideways", async ({ page }) => {
    await page.goto(SITE);
    await page.locator("[data-pg-search-open]").click();
    await page.locator(input).fill("figures");
    await expect(page.locator(results).first()).toBeVisible();

    const box = await page.locator(`${dialog}`).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
