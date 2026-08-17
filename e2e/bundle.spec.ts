/**
 * The built bundle, loaded the way a host application loads it.
 *
 * The failure this guards against: `dist/editor.js` inlines CJS dependencies that read
 * `process.env.NODE_ENV` while the module is being evaluated. Under Vite's dev server that is
 * defined for you, so `/__edit/` and the other e2e spec both passed while the published bundle
 * threw `ReferenceError: process is not defined` on the first line a real host ever ran — the
 * element never upgraded, and `<pagina-editor>` sat inert. Found by the Laravel integration, not
 * by this repo, because this repo had never once loaded its own build.
 *
 * So this spec asserts the whole chain outside Vite: the module evaluates, the element upgrades,
 * the editor mounts against the HTTP contract, typing reaches the file, and publish returns.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { STATIC_ARTICLE } from "./setup.js";

test("the published bundle runs in a page that has never heard of Vite", async ({ page }) => {
  const errors: string[] = [];
  const failures: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => failures.push(e.message));

  await page.goto("/edit");

  // The precise regression: a module-evaluation throw never reaches `defineElement()`.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __paginaDefined?: boolean }).__paginaDefined))
    .toBe(true);
  expect(failures, `uncaught page errors: ${failures.join(" | ")}`).toHaveLength(0);

  // Upgraded, not merely present: an un-upgraded custom element is still in the DOM.
  const upgraded = await page.evaluate(
    () => document.querySelector("pagina-editor")?.constructor.name !== "HTMLElement",
  );
  expect(upgraded).toBe(true);

  const doc = page.locator(".ProseMirror").first();
  await expect(doc).toBeVisible({ timeout: 30_000 });
  // The host page sends `page=""`, as Blade does; the editor must fall back to `index.md` rather
  // than open the path `""` — which the contract answers with its file listing, so the tell is a
  // document full of JSON.
  await expect(doc).toContainText("Fixture", { timeout: 30_000 });
  await expect(doc).not.toContainText(`{"files"`);

  const sentence = `Typed against the built bundle at ${String(Date.now())}.`;
  await doc.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(sentence);

  await expect(page.locator(".pge-status__state")).toHaveText("Saved", { timeout: 30_000 });
  await expect
    .poll(async () => await readFile(join(STATIC_ARTICLE, "index.md"), "utf8"), { timeout: 30_000 })
    .toContain(sentence);

  // Publish exercises the other half of the bundle — `@pagina/core`'s renderer and the
  // browser-side figure prerender — which is where a second missing `define` would surface.
  await page.locator("[data-publish]").click();
  await expect(page.locator("[data-publish-status]")).toContainText("published", { timeout: 60_000 });

  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("no bare `process.` reference survives in either built bundle", async () => {
  // The browser check above is the real test; this one names the cause when it fails, and covers
  // the iife build, which no browser test loads.
  for (const file of ["editor.js", "editor.iife.js"]) {
    const source = await readFile(join(process.cwd(), "packages/editor/dist", file), "utf8");
    const hits = source.match(/\bprocess\s*\./g) ?? [];
    expect(hits, `${file} still reads ${hits[0] ?? ""} at runtime`).toHaveLength(0);
  }
});
