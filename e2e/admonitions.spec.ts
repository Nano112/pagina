/**
 * The redesigned admonition, in a browser, on built assets, under a foreign host.
 *
 * The complaint was "I hate those admonitions, they look super ugly" — and looking is exactly the
 * thing no unit test can do. What *can* be asserted, and is asserted here, is everything the look
 * is made of:
 *
 *  - each kind is separable without reading the class name: its own glyph, its own label, and a
 *    ground and edge that differ from every other kind's *as computed by the browser*;
 *  - a collapsible is a real disclosure — closed on load, no raw `▶`, a chevron that turns;
 *  - a host that defines the tokens retints all seven without overriding a single rule, which is
 *    checked by loading a page that does exactly that and finding the host's colours;
 *  - and the editor's node view is the same block, in the same palette, with no naked browser
 *    control left in it.
 *
 * This runs in the `bundle` project because that is the only configuration where this project's
 * defects have ever been visible: `dist/pagina.css` and `dist/editor.css` as a host copies them,
 * on a plain Node server, under a preflight-shaped reset that the host links first.
 *
 * The four screenshots it writes are the deliverable — published and in-editor, default palette
 * and a dark host theme — and the assertions are what stops them from being four pictures of a
 * bug nobody looked closely at.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const KINDS = ["note", "tip", "info", "warning", "danger", "example", "quote"] as const;
const SHOTS = fileURLToPath(new URL("../test-results/admonitions/", import.meta.url));

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
});

/** The computed colours a kind is actually drawn in — the tokens, resolved. */
async function paint(block: Locator): Promise<{ ground: string; edge: string; ink: string; glyph: string }> {
  return await block.evaluate((el) => {
    const s = getComputedStyle(el);
    const title = el.querySelector<HTMLElement>(".pg-admonition__title")!;
    const icon = el.querySelector<HTMLElement>(".pg-admonition__icon")!;
    return {
      ground: s.backgroundColor,
      edge: s.borderInlineStartColor,
      ink: getComputedStyle(title).color,
      glyph: getComputedStyle(icon).color,
    };
  });
}

const blockOf = (page: Page, kind: string): Locator => page.locator(`.pg-admonition--${kind}`).first();

test.describe("the published admonition", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admonitions/published");
    await expect(page.locator("[data-published] h1")).toHaveText("Admonitions");
  });

  test("gives every kind a glyph, a label and colours of its own", async ({ page }) => {
    const seen = new Set<string>();
    for (const kind of KINDS) {
      const block = blockOf(page, kind);
      await expect(block, kind).toBeVisible();

      // The two things a stripe alone never said.
      await expect(block.locator(".pg-admonition__icon"), `${kind} glyph`).toBeVisible();
      await expect(block.locator(".pg-admonition__label"), `${kind} label`).toHaveText(`A ${kind} with a title`);

      const drawn = await paint(block);
      // Not the page's own background: the block has to read as a surface, not as a margin note.
      expect(drawn.ground, `${kind} is tinted`).not.toBe("rgba(0, 0, 0, 0)");
      // The edge and the glyph carry the kind's hue; the title carries its ink.
      expect(drawn.edge, `${kind} edge`).toBe(drawn.glyph);
      expect(drawn.ink, `${kind} ink`).not.toBe(drawn.ground);
      const fingerprint = `${drawn.ground}|${drawn.edge}`;
      expect(seen.has(fingerprint), `${kind} looks like a kind already seen`).toBe(false);
      seen.add(fingerprint);
    }
    expect(seen.size).toBe(KINDS.length);
  });

  test("resolves an omitted title to the kind rather than leaving the bar empty", async ({ page }) => {
    const untitled = page.locator(".pg-admonition--warning").nth(1);
    await expect(untitled.locator(".pg-admonition__label")).toHaveText("Warning");
  });

  test("renders a collapsible as a disclosure, closed, with no raw marker", async ({ page }) => {
    const details = page.locator("details.pg-admonition--collapsible");
    await expect(details).toHaveCount(1);
    await expect(details).not.toHaveAttribute("open", /.*/);
    await expect(details.locator(".pg-admonition__chevron")).toBeVisible();

    // The browser's own triangle is gone, not merely covered: `::marker` and the WebKit
    // pseudo-element are both suppressed, which is what a raw `▶ asas` was.
    const marker = await details.locator("summary").evaluate((el) => getComputedStyle(el).listStyleType);
    expect(marker).toBe("none");

    // The body is genuinely hidden until it is opened, and the chevron turns when it is.
    const body = details.locator("p").last();
    await expect(body).toBeHidden();
    const before = await details.locator(".pg-admonition__chevron").evaluate((el) => getComputedStyle(el).transform);
    await details.locator("summary").click();
    await expect(body).toBeVisible();
    const after = await details.locator(".pg-admonition__chevron").evaluate((el) => getComputedStyle(el).transform);
    expect(after).not.toBe(before);
  });

  test("survives the host's reset: the title is not body text", async ({ page }) => {
    // The reset sets `p { margin: 0 }` and flattens headings; a block that leaned on the UA sheet
    // for its title weight would be indistinguishable from its body here.
    const weight = await blockOf(page, "danger")
      .locator(".pg-admonition__title")
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(weight)).toBeGreaterThanOrEqual(600);
  });

  test("takes the default palette", async ({ page }) => {
    // The documented default, straight out of `dist/pagina.css`, with no host tokens on the page.
    expect(await paint(blockOf(page, "danger"))).toMatchObject({
      ground: "rgb(253, 236, 236)",
      edge: "rgb(214, 69, 69)",
      ink: "rgb(161, 39, 39)",
    });
    await page.screenshot({ path: `${SHOTS}published-default.png`, fullPage: true });
  });
});

test.describe("the published admonition under a dark host theme", () => {
  test("takes the host's tokens, with no rule overridden", async ({ page }) => {
    await page.goto("/admonitions/published-dark");
    await expect(page.locator("[data-published] h1")).toHaveText("Admonitions");

    // schemat.io's magenta-and-near-black, applied purely by defining `--pg-*`.
    expect(await paint(blockOf(page, "danger"))).toMatchObject({
      ground: "rgb(30, 16, 23)",
      edge: "rgb(255, 92, 138)",
      ink: "rgb(255, 146, 177)",
    });
    expect(await paint(blockOf(page, "example"))).toMatchObject({
      ground: "rgb(23, 17, 31)",
      edge: "rgb(192, 139, 255)",
    });
    // Still seven distinguishable blocks after the retint, not seven variations of one.
    const grounds = new Set<string>();
    for (const kind of KINDS) grounds.add((await paint(blockOf(page, kind))).ground);
    expect(grounds.size).toBe(KINDS.length);

    await page.screenshot({ path: `${SHOTS}published-dark-host.png`, fullPage: true });
  });
});

/** The editor's node view for a given kind, once the document has loaded. */
const nodeOf = (page: Page, kind: string): Locator => page.locator(`.pge-adm[data-kind="${kind}"]`).first();

test.describe("the admonition in the editor", () => {
  for (const [path, name] of [
    ["/admonitions/editing", "default"],
    ["/admonitions/editing-dark", "dark-host"],
  ] as const) {
    test(`is the same block, tool-shaped, under the ${name} theme`, async ({ page }) => {
      const failures: string[] = [];
      page.on("pageerror", (e) => failures.push(e.message));
      await page.goto(path);

      const doc = page.locator(".ProseMirror").first();
      await expect(doc).toBeVisible({ timeout: 30_000 });
      await expect(doc).toContainText("Every kind", { timeout: 30_000 });
      expect(failures, `uncaught page errors: ${failures.join(" | ")}`).toHaveLength(0);

      for (const kind of KINDS) {
        const node = nodeOf(page, kind);
        await expect(node, kind).toBeVisible();
        // The same three tokens as the published block: tinted ground, hued edge.
        const drawn = await node.evaluate((el) => {
          const s = getComputedStyle(el);
          return { ground: s.backgroundColor, edge: s.borderInlineStartColor };
        });
        expect(drawn.ground, `${kind} is tinted in the editor`).not.toBe("rgba(0, 0, 0, 0)");
        expect(drawn.edge, `${kind} has an accent edge in the editor`).not.toBe(drawn.ground);
      }

      // The chrome: an icon-and-label kind control, an inline title, a real switch, a remove.
      const note = nodeOf(page, "note");
      await expect(note.locator(".pge-adm__glyph")).toBeVisible();
      await expect(note.locator(".pge-adm__kindname")).toHaveText("Note");
      await expect(note.locator('input[aria-label="Admonition title"]')).toHaveValue("A note with a title");
      await expect(note.locator('[role="switch"]')).toHaveAttribute("aria-checked", "false");
      await expect(page.locator('.pge-adm[data-kind="tip"][data-collapsible] [role="switch"]').first())
        .toHaveAttribute("aria-checked", "true");

      // No naked browser control: the `<select>` is the real one, laid transparently over the
      // label we draw, so nothing on screen is the host's or the platform's idea of a dropdown.
      const picker = note.locator("select.pge-adm__picker");
      await expect(picker).toHaveCount(1);
      const chrome = await picker.evaluate((el) => {
        const s = getComputedStyle(el);
        return { opacity: s.opacity, appearance: s.appearance, position: s.position };
      });
      expect(chrome).toMatchObject({ opacity: "0", appearance: "none", position: "absolute" });
      // …but it is still a real control: focusable, and it still reports its accessible name.
      await expect(picker).toHaveAttribute("aria-label", "Admonition kind");

      // The remove control every block now carries, reachable and named.
      const remove = note.locator('button[aria-label="Remove admonition"]');
      await expect(remove).toHaveCount(1);
      // Quiet until wanted, but never *unreachable*: focus alone must bring it up, because
      // "hover to discover" is not an affordance a keyboard has. Polled rather than read once —
      // it fades in, and a single read catches it mid-transition.
      await remove.focus();
      await expect(remove).toBeFocused();
      await expect
        .poll(async () => Number(await remove.evaluate((el) => getComputedStyle(el).opacity)), { timeout: 5_000 })
        .toBe(1);

      await note.hover();
      await page.screenshot({ path: `${SHOTS}editor-${name}.png`, fullPage: false });
    });
  }

  test("removes the block through the control, and the file loses the block", async ({ page }) => {
    // The whole point, end to end, in the configuration a host actually runs.
    await page.goto("/admonitions/editing");
    const doc = page.locator(".ProseMirror").first();
    await expect(doc).toContainText("Every kind", { timeout: 30_000 });

    const danger = nodeOf(page, "danger");
    await expect(danger).toBeVisible();
    await danger.hover();
    await danger.locator('button[aria-label="Remove admonition"]').click();
    await expect(page.locator('.pge-adm[data-kind="danger"]')).toHaveCount(0);

    // …and it reaches the backend, which is the only place "deleted" means anything.
    await page.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/articles/fixture/files/guide/admonitions.md");
        return (await res.text()).includes("!!! danger");
      }, { timeout: 15_000 })
      .toBe(false);
  });
});
