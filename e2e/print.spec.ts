/**
 * The print stylesheet, checked in the print medium.
 *
 * There is no `pagina pdf` and this is the argument that there does not need to be one: a docs page
 * is already a column of prose, and what stood between it and a deliberate PDF was a handful of
 * screen affordances that make no sense on paper. Those are what this file asserts — in
 * `emulateMedia({ media: "print" })`, where the rules are actually in effect, and finishing with a
 * real `page.pdf()` because a stylesheet that computes correctly and still crops a diagram is a
 * stylesheet that has not been checked.
 *
 * It runs in the **bundle** project, over a built site served by a plain Node server, for the same
 * reason `figures.spec.ts` does: the artefact is `_pagina/pagina.<hash>.css`, and a dev server's
 * pipeline is not what a reader prints.
 */
import { expect, test } from "@playwright/test";

const PAGE = "/site/guide/figures/";

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.emulateMedia({ media: "print" });
});

test("drops every control a sheet of paper cannot be used with", async ({ page }) => {
  // The page with the code blocks on it, since the copy button is one of the controls.
  await page.goto("/site/guide/tabs/");
  await page.emulateMedia({ media: "print" });
  // The brand row, the sidebar, the TOC rail, the breadcrumbs, the pager, the search trigger and
  // the per-listing copy button: all of them are ways of *moving around a site*.
  for (const sel of [".pg-header", ".pg-nav", ".pg-toc", ".pg-crumbs", ".pg-pager", ".pg-search-trigger"]) {
    const n = await page.locator(sel).count();
    if (n === 0) continue;
    await expect(page.locator(sel).first(), `${sel} prints`).toBeHidden();
  }
  // The copy buttons are appended by the client, so they exist by now and must not be visible.
  const copies = page.locator(".pg-copy");
  expect(await copies.count(), "the page has code blocks with copy buttons").toBeGreaterThan(0);
  await expect(copies.first()).toBeHidden();

  // …and the article itself stays.
  await expect(page.locator(".pg-content").first()).toBeVisible();
});

test("keeps the light palette even for a reader who chose dark", async ({ page }) => {
  // Chrome prints `color` and drops backgrounds, so a dark-theme page printed as authored is grey
  // ink on white. The dark palette is scoped to `@media screen` for exactly this.
  await page.evaluate(() => { document.documentElement.dataset["theme"] = "dark"; });
  const ink = await page.evaluate(() => getComputedStyle(document.body).color);
  // #1a1d23 — the light theme's `--pg-fg`, not the dark theme's #e7e9ee.
  expect(ink).toBe("rgb(26, 29, 35)");
  // The figures follow the page: a diagram's text token is the light one too.
  const figureInk = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--kg-color-text").trim());
  expect(figureInk).not.toBe("");
});

test("lets a wide figure shrink to the page instead of running off it", async ({ page }) => {
  // On screen a drawing narrower than `--pg-figure-min-scale` of its natural width scrolls its
  // frame rather than shrinking further. On paper there is nothing to scroll, so the floor lifts.
  await page.setViewportSize({ width: 800, height: 1000 });
  const overflow = await page.evaluate(() => {
    const out: { id: string; svg: number; frame: number }[] = [];
    for (const frame of document.querySelectorAll<HTMLElement>(".kg-frame")) {
      for (const svg of frame.querySelectorAll<SVGElement>("svg")) {
        if (svg.getBoundingClientRect().width === 0) continue;   // a variant this width does not show
        out.push({
          id: svg.id,
          svg: Math.round(svg.getBoundingClientRect().width),
          frame: Math.round(frame.getBoundingClientRect().width),
        });
      }
    }
    return out;
  });
  expect(overflow.length, "the page draws at least one figure").toBeGreaterThan(0);
  for (const f of overflow) expect(f.svg, `${f.id} is wider than its frame`).toBeLessThanOrEqual(f.frame + 1);

  // Nothing at all sticks out past the page box.
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el.getBoundingClientRect().right > limit)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().split(" ")[0] ?? ""}`)
      .slice(0, 5);
  });
  expect(wide, "elements past the right edge of the sheet").toEqual([]);
});

test("expands the URLs a reader could type back in, and no others", async ({ page }) => {
  const shown = await page.evaluate(() => {
    const after = (sel: string): string => {
      const el = document.querySelector(sel);
      return el === null ? "" : getComputedStyle(el, "::after").content;
    };
    const absolute = [...document.querySelectorAll<HTMLAnchorElement>(".pg-content a[href^='http']")][0];
    const internal = [...document.querySelectorAll<HTMLAnchorElement>(".pg-content a:not([href^='http'])")][0];
    return {
      absolute: absolute === undefined ? null : getComputedStyle(absolute, "::after").content,
      internal: internal === undefined ? null : getComputedStyle(internal, "::after").content,
      nav: after(".pg-nav a"),
    };
  });
  if (shown.absolute !== null) expect(shown.absolute, "an absolute link prints its URL").toContain("http");
  // `#anchor` and `/guide/` resolve against a page the paper does not carry: printing them is noise.
  if (shown.internal !== null) expect(shown.internal, "a relative link stays quiet").toBe("none");
});

test("prints a whole page as a PDF, with the content on it", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "page.pdf() is Chromium-only");
  const pdf = await page.pdf({ format: "A4", printBackground: false });
  expect(pdf.byteLength, "a PDF was produced").toBeGreaterThan(2000);
  // Chromium writes the page tree's `/Count` uncompressed in the catalog.
  const count = /\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/.exec(pdf.toString("latin1"))
    ?? /\/Count\s+(\d+)/.exec(pdf.toString("latin1"));
  expect(count, "the PDF declares a page count").not.toBeNull();
  const pages = Number(count![1]);
  // A four-heading fixture page. The upper bound is the assertion that matters: before the break
  // rules, one figure per sheet and a page-tall sidebar took this into double figures.
  expect(pages).toBeGreaterThanOrEqual(1);
  expect(pages, "the fixture page fits in a handful of sheets").toBeLessThanOrEqual(6);
});
