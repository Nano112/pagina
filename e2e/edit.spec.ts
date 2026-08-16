/**
 * The one loop no unit test can prove: a browser, the real editor, the real dev server, and a
 * file on disk that changed because someone typed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ARTICLE } from "./setup.js";

const TABS = join(ARTICLE, "guide/tabs.md");

test("types into a page and the file on disk changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("/__edit/guide/tabs/");

  const doc = page.locator(".ProseMirror").first();
  await expect(doc).toBeVisible({ timeout: 30_000 });
  // The document is only really open once the markdown has been parsed into it.
  await expect(doc).toContainText("Tabs", { timeout: 30_000 });

  // A mark that only survives if the page is never reloaded. The dev server broadcasts
  // `full-reload` for the write this test is about to make, and the editor's own guard is the only
  // reason that frame does not throw the document away — the bug this replaced lost an upload's
  // freshly inserted node exactly here.
  await page.evaluate(() => { (window as unknown as { __marker?: string }).__marker = "before-typing"; });

  const sentence = `Typed by Playwright at ${String(Date.now())}.`;
  await doc.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(sentence);

  // The status bar is the editor's own claim that the write landed; the file is the truth.
  await expect(page.locator(".pge-status__state")).toHaveText("Saved", { timeout: 30_000 });
  await expect.poll(async () => await readFile(TABS, "utf8"), { timeout: 30_000 }).toContain(sentence);

  // The preview renders the same document through @pagina/core.
  await expect(page.locator(".pge-preview")).toContainText(sentence, { timeout: 30_000 });

  // Well past the watcher's latency and the guard's own 2 s window: if the write was going to
  // reload this page, it has had every chance.
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe("before-typing");
  await expect(doc).toContainText(sentence);

  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("hydrates the page's figures inside the editor", async ({ page }) => {
  await page.goto("/__edit/guide/figures/");
  await expect(page.locator(".ProseMirror").first()).toBeVisible({ timeout: 30_000 });
  // Two of the three fixture figures are live scenes; Kineglyph mounts an <svg> for each.
  await expect(page.locator(".pge-figure__stage svg").first()).toBeVisible({ timeout: 30_000 });
});
