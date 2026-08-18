/**
 * The 404, from the only address it is ever really served from: one nobody chose.
 *
 * A 404 page is the one document in a static site whose URL is not its path. The host hands
 * `404.html` to a request for `/site/any/depth/at/all/`, and the browser resolves every URL on it
 * against *that* — so a page that looks right at `/site/404.html` can be entirely broken in
 * production, with a stylesheet and a nav pointing five directories into nowhere. Only a browser at
 * depth can be asked about it, which is why this lives here and not in the unit suite.
 *
 * The second claim is the one that needs a *second* browser: it has to work with JavaScript off. A
 * reader who cannot run scripts is exactly the reader most likely to be looking at a 404, and a
 * page that needs JS to tell them where they are is worse than no page.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { SITE_BASE } from "./setup.js";

const SHOTS = fileURLToPath(new URL("../test-results/not-found/", import.meta.url));
/** Deep, and plausible enough to be a real mistake — a moved page, not a fuzzer. */
const DEEP = `${SITE_BASE}guide/tabs/that/never/existed/`;

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
});

test.describe("the 404 a build emits", () => {
  test("is served at depth with a 404 status and its assets still resolve", async ({ page }) => {
    // Every subresource the page asks for, and whether it arrived. The document itself is expected
    // to be a 404 — that is the status under test — so it is not one of them.
    const notOk: string[] = [];
    page.on("response", (r) => {
      const kind = r.request().resourceType();
      if (["stylesheet", "script", "image", "font"].includes(kind) && !r.ok()) notOk.push(`${String(r.status())} ${r.url()}`);
    });
    const response = await page.goto(DEEP);
    expect(response?.status()).toBe(404);
    await expect(page.locator("h1.pg-404__title")).toBeVisible();
    await expect(page.locator(".pg-404__folio").first()).toBeVisible();
    // The stylesheet *parsed*, four directories below where the file lives. This is the whole
    // relative-URL question asked of the browser: a sheet that 404'd has a null `sheet`, and the
    // page's own inline fallbacks would have made it look fine anyway.
    const rules = await page.evaluate(() => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
      return link === null ? -1 : (link.sheet?.cssRules.length ?? 0);
    });
    expect(rules).toBeGreaterThan(0);
    expect(notOk).toEqual([]);
  });

  test("lists the article's real pages, and they are reachable from here", async ({ page }) => {
    await page.goto(DEEP);
    const links = page.locator(".pg-404__list a.pg-404__name");
    expect(await links.count()).toBeGreaterThan(1);
    for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) {
      expect(href.startsWith(SITE_BASE), href).toBe(true);
    }
    await links.first().click();
    await expect(page).toHaveURL(new RegExp(`${SITE_BASE}$`));
  });

  test("tells the reader which address they asked for, as text and never as markup", async ({ page }) => {
    await page.goto(`${SITE_BASE}oops/<img src=x onerror=alert(1)>/`);
    await expect(page.locator("[data-pagina-404-path]")).toHaveText(/\/site\/oops\/<img src=x onerror=alert\(1\)>\//);
    // Echoed as text: the injected tag is a string in the DOM, not an element in it.
    expect(await page.locator("img").count()).toBe(0);
  });

  test("is a correct index with JavaScript turned off", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(DEEP);
    await expect(page.locator("h1.pg-404__title")).toBeVisible();
    expect(await page.locator(".pg-404__list a.pg-404__name").count()).toBeGreaterThan(1);
    // No script ran, so the row still carries the sentence the HTML shipped rather than an empty gap.
    await expect(page.locator("[data-pagina-404-path]")).toHaveText("an address that is not in this article");
    await page.screenshot({ path: `${SHOTS}no-js.png`, fullPage: true });
    await context.close();
  });

  test("reads on a desktop and on a 390px handset", async ({ page }) => {
    // The toggle persists a choice, so without this the second viewport would load in whatever the
    // first one left behind and the two pairs of screenshots would not be comparable.
    await page.addInitScript(() => { try { localStorage.removeItem("pagina-theme"); } catch { /* a browser with storage off is fine here */ } });
    for (const [name, width, height] of [["desktop", 1280, 900], ["handset", 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(DEEP);
      // Nothing overflows sideways: the folio column and the address both have to give way first.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, name).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}${name}-light.png`, fullPage: true });
      // The 404 carries its own toggle rather than the client bundle — it has no figures to retint
      // and no reason to fetch a runtime — so this is the only thing proving that toggle is wired.
      await page.locator("[data-pagina-theme-toggle]").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.screenshot({ path: `${SHOTS}${name}-dark.png`, fullPage: true });
    }
  });
});
