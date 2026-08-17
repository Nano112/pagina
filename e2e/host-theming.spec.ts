/**
 * The preview pane, under a foreign host, against a built artefact.
 *
 * The defect: `editor.css` carried the tokens layer but not the *reading* layer, so a host page
 * with a CSS reset rendered the preview's `h1` at body size. pagina's own shell hid it — with no
 * reset, browser heading defaults filled the gap and the pane looked roughly right — and the dev
 * server hid it a second time, because Vite resolves the site sheet's imports and `/__edit/`
 * happens to link `pagina.css` too. It took a real host (schemat.io, Tailwind preflight) to find
 * it, and the host fixed it by hand: link `pagina.css` before `editor.css`, in that order.
 *
 * So this spec is deliberately built out of the things that hid it:
 *
 *  - a **built** `dist/editor.css` and `dist/pagina.css`, on a server that is not Vite;
 *  - a host page with a preflight-shaped reset linked **before** pagina's sheets;
 *  - a **published page** from `buildStatic`, as the reference the preview must match;
 *  - and no knowledge, in the host page, of what order pagina's stylesheets want.
 *
 * The assertion is the pane's actual job: an `h1` in the preview computes to the same
 * `font-size` and `font-weight` as the same `h1` on the published page.
 */
import { expect, test, type Page } from "@playwright/test";
import { SITE_BASE } from "./setup.js";

/** The computed properties a reset strips and the reading layer must therefore state itself. */
async function readingType(page: Page, selector: string): Promise<Record<string, string>> {
  return await page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily,
      marginTop: s.marginTop, marginBottom: s.marginBottom, lineHeight: s.lineHeight,
    };
  });
}

/**
 * The reading layer measured on markup neither page happens to contain.
 *
 * The fixture has no list, and a reset that strips list markers is half of what Tailwind's
 * preflight does. Injecting an identical probe into both pages compares the *sheets* rather than
 * whatever the fixture is currently made of, and it goes into `document.body` — outside
 * `.pge-app` — so nothing the editor's own layer says can be mistaken for the reading layer.
 */
async function probeReadingLayer(page: Page): Promise<Record<string, Record<string, string>>> {
  return await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "pg-content";
    probe.innerHTML = `<h1>H</h1><ul><li>item</li></ul><ol><li>item</li></ol><p>text</p>`;
    document.body.append(probe);
    const of = (sel: string, keys: string[]): Record<string, string> => {
      const s = getComputedStyle(probe.querySelector(sel)!);
      return Object.fromEntries(keys.map((k) => [k, s.getPropertyValue(k)]));
    };
    const out = {
      h1: of("h1", ["font-size", "font-weight", "font-family", "margin-top", "line-height"]),
      ul: of("ul", ["list-style-type", "padding-inline-start", "margin-top"]),
      ol: of("ol", ["list-style-type", "padding-inline-start"]),
      p: of("p", ["margin-top", "margin-bottom"]),
    };
    probe.remove();
    return out;
  });
}

/** Body `font-size`, the value a reset collapses headings to. */
const bodySize = async (page: Page): Promise<number> =>
  await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));

test.describe("a host with a CSS reset", () => {
  /** The reference: the published page, built by `buildStatic` and served as flat files. */
  let published: Record<string, string>;
  let publishedProbe: Record<string, Record<string, string>>;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    // A **sub-page**, deliberately. The landing page's `h1` is moved into the article header,
    // which is chrome; the reading layer's heading rules are measured on the content column, and
    // a sub-page is where that column is untouched — which is also the page the preview shows.
    await page.goto(`${SITE_BASE}guide/tabs/`);
    await expect(page.locator(".pg-content h1")).toHaveText("Tabs and snippets");
    published = await readingType(page, ".pg-content h1");
    publishedProbe = await probeReadingLayer(page);
    // Guard the guard: if the published page's own `h1` were body-sized, every comparison below
    // would pass while everything was broken.
    expect(parseFloat(published["fontSize"]!)).toBeGreaterThan(await bodySize(page) * 1.4);
    expect(Number(published["fontWeight"])).toBeGreaterThanOrEqual(700);
    expect(publishedProbe["ul"]!["list-style-type"]).toBe("disc");
    await page.close();
  });

  for (const [path, what] of [
    ["/host-reset", "links only editor.css"],
    ["/host-reset-editor-first", "links editor.css before pagina.css"],
    ["/host-reset-pagina-first", "links pagina.css before editor.css"],
  ] as const) {
    test(`gets a preview that matches the published page when it ${what}`, async ({ page }) => {
      const failures: string[] = [];
      page.on("pageerror", (e) => failures.push(e.message));
      await page.goto(path);

      const doc = page.locator(".ProseMirror").first();
      await expect(doc).toBeVisible({ timeout: 30_000 });
      await expect(doc).toContainText("Fixture", { timeout: 30_000 });
      expect(failures, `uncaught page errors: ${failures.join(" | ")}`).toHaveLength(0);

      // The reset is real: it is doing to *unstyled* headings exactly what it did to the preview.
      const control = await page.evaluate(() => {
        const h = document.createElement("h1");
        h.textContent = "control";
        document.body.append(h);
        const size = getComputedStyle(h).fontSize;
        h.remove();
        return size;
      });
      expect(parseFloat(control), "the reset must actually flatten an h1").toBe(await bodySize(page));

      // Both `.pg-content` surfaces: the preview pane, and ProseMirror's own document.
      for (const selector of [".pge-preview .pg-content h1", ".ProseMirror.pg-content h1"]) {
        await expect(page.locator(selector).first()).toBeVisible({ timeout: 30_000 });
        expect(await readingType(page, selector), selector).toEqual(published);
      }

      // …and the rest of the column, on markup the fixture does not contain.
      expect(await probeReadingLayer(page)).toEqual(publishedProbe);
    });
  }
});
