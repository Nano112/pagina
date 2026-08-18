/**
 * The live demo, in a real browser, on a server that has never heard of Vite.
 *
 * `docs/demo.md` is how most people will ever meet this editor, and until now the only thing
 * covering it was a hundred lines of inline `<script>` that eslint, `tsc` and every test lane
 * skipped. The implementation moved to `packages/editor/src/demo.ts` (built to `dist/demo.js`) so
 * it is checked like everything else, and this spec drives it end to end: the deferred load, the
 * publish-and-read loop, the tabs that only the published page used to have, the delete control on
 * each tab, the draggable sidebar, and — at 390 px — the pages dialog that stands in for a sidebar
 * there is no room for.
 *
 * It uses browser storage, so each test starts from a cleared origin rather than from whatever the
 * one before it wrote.
 */
import { expect, test } from "@playwright/test";

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.afterEach(() => {
  expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
});

/**
 * Scrolls the demo into view — which is one of the two things that start it — and waits.
 *
 * Deliberately not a click: `page.click` scrolls the target into view first, which trips the
 * `IntersectionObserver` and detaches the placeholder mid-click. The button has its own test.
 */
async function load(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("#demo").scrollIntoViewIfNeeded();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".pge-status__state")).toHaveText("Saved", { timeout: 30_000 });
}

test("does not download the editor until the demo is wanted", async ({ page }) => {
  const bundles: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/editor.js")) bundles.push(r.url());
  });
  await expect(page.locator(".pgd__placeholder")).toBeVisible();
  expect(bundles, "the 1.3 MB bundle was fetched before anyone asked for it").toHaveLength(0);

  await load(page);
  expect(bundles).toHaveLength(1);
  // The seeded article is there, and it is in browser storage rather than on a server.
  await expect(page.locator(".ProseMirror h1")).toHaveText("A sample article");
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pagina:")));
  expect(stored).toContain("pagina:pagina-docs-demo:file:index.md");
});

test("the placeholder's button starts it too, without waiting to be scrolled to", async ({ page }) => {
  // Dispatched rather than clicked: a real click scrolls first, which is the *other* trigger.
  await page.locator(".pgd__button").dispatchEvent("click");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".pgd__placeholder")).toHaveCount(0);
});

test("publishes into a reading view, and comes back", async ({ page }) => {
  await load(page);
  await page.locator(".pge-bar__publish").click();

  const published = page.locator(".pge-published");
  await expect(published).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".pge-panes")).toHaveCount(0);
  await expect(published.locator(".pge-published__page h1")).toHaveText("A sample article");
  await expect(published.locator(".pge-published__note")).toContainText("rendered in this browser");

  await published.getByRole("button", { name: "Back to the editor" }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
});

test("the preview's tabs behave like the published page's", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "Things to try" }).click();

  const tabs = page.locator('.pge-preview [role="tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 30_000 });
  const panels = page.locator('.pge-preview [role="tabpanel"]');
  await expect(panels.nth(0)).toBeVisible();
  await expect(panels.nth(1)).toBeHidden();

  // The defect: this click used to do nothing at all, because the behaviour lived in the site's
  // client bundle and the preview does not load it.
  await tabs.nth(1).click();
  await expect(panels.nth(0)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
});

test("each tab carries its own delete, and the last one takes the group", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "Things to try" }).click();
  await expect(page.locator(".pge-tabs__tab")).toHaveCount(2, { timeout: 30_000 });

  await page.getByRole("button", { name: 'Delete the tab "Two"' }).click();
  await expect(page.locator(".pge-tabs__tab")).toHaveCount(1);

  const last = page.getByRole("button", { name: /Delete the tab "One"/ });
  await expect(last).toHaveAttribute("aria-label", /the last one, which removes the tab group/);
  await last.click();
  await expect(page.locator(".pge-tabs")).toHaveCount(0);

  // What matters is the file: a deleted tab has to serialise cleanly, not leave a half-written
  // `=== "…"` behind.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("pagina:pagina-docs-demo:file:guide/try.md") ?? "{}";
        return String((JSON.parse(raw) as { d?: string }).d ?? "");
      }),
    )
    .not.toContain("===");
});

test("the sidebar can be dragged, and the width is remembered", async ({ page }) => {
  await load(page);
  const sidebar = page.locator(".pge-panes > .pge-sidebar");
  const before = (await sidebar.boundingBox())?.width ?? 0;
  expect(before).toBeGreaterThan(0);

  const handle = page.locator(".pge-handle--sidebar");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + 60, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(before + 60);
  const widened = (await sidebar.boundingBox())!.width;

  // A separator that moves is a focusable one, and it says where it is.
  await expect(handle).toHaveAttribute("role", "separator");
  await expect(handle).toHaveAttribute("aria-valuenow", String(Math.round(widened)));

  await page.reload();
  await load(page);
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(widened, 0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("reaches the pages list through a modal, and gives focus back", async ({ page }) => {
    await load(page);
    await expect(page.locator(".pge-panes > .pge-sidebar")).toBeHidden();

    const fab = page.locator(".pge-pages-fab");
    await expect(fab).toBeVisible();
    await fab.focus();
    await fab.click();

    const dialog = page.locator(".pge-modal--pages");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    // Everything the hidden sidebar owned is reachable here — not just the page list.
    await expect(dialog.getByRole("button", { name: "New page" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Upload" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(fab).toBeFocused();

    // And it actually switches the page, which is the thing that was impossible here.
    await fab.click();
    await page.locator(".pge-modal--pages").getByRole("button", { name: "Things to try" }).click();
    await expect(page.locator(".pge-modal--pages")).toHaveCount(0);
    await expect(page.locator(".pge-status__path")).toHaveText("guide/try.md");

    // The page must not scroll sideways at 390 px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
