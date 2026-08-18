/**
 * The theming showcase and the theme lab, in a browser, over a **built** site page.
 *
 * Everything under test here is a claim jsdom cannot be asked about:
 *
 *  - a pre-rendered Kineglyph figure re-tints when a `--pg-*` moves, because its every paint is a
 *    `var(--kg-color-…)` that resolves through the token contract — that is inline SVG in a real
 *    artefact being repainted by the cascade, and it needs layout and a real style engine;
 *  - **the exported CSS reproduces what is on screen**, which is the lab's whole reason to exist and
 *    is only proved by taking the string, throwing the lab away, pasting the string, and finding
 *    every token back where it was;
 *  - the panel is usable at a true 390 px, measured in a same-origin iframe because Chrome will not
 *    lay a window out below about 614 px, and a viewport that lies is worse than no measurement.
 *
 * The page is `guide/figures/index.html` as `buildStatic` wrote it, with two empty divs and one
 * `autoMount()` appended — see `e2e/static-server.mjs`.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";

/**
 * Orchid, in both halves.
 *
 * A preset carries a light map and a dark one, and the lab exports both — so which of the two a
 * reader sees is decided by the page's `data-theme`, not by the preset. The page starts light.
 */
const ORCHID = {
  light: { accent: "#6d3ee0", accentRgb: "rgb(109, 62, 224)", raisedRgb: "rgb(243, 238, 255)", bgRgb: "rgb(251, 249, 255)" },
  dark: { accent: "#b388ff", accentRgb: "rgb(179, 136, 255)", raisedRgb: "rgb(27, 23, 48)", bgRgb: "rgb(18, 15, 28)" },
} as const;

const IDENTITIES = ["default", "almanac", "console", "orchid", "broadsheet", "bare"] as const;

const tokenValue = (page: Page | Frame, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** The plane a figure is drawn on: `--kg-color-canvas`, i.e. `--pg-bg-raised`, resolved. */
const figureCanvas = (page: Page | Frame): Promise<string> =>
  page.evaluate(() => {
    const canvas = document.querySelector<SVGElement>("figure.kg svg .kg-canvas");
    return canvas === null ? "" : getComputedStyle(canvas).fill;
  });

/** Every fill and stroke actually painted inside the page's first pre-rendered figure. */
const figurePaints = (page: Page | Frame): Promise<string[]> =>
  page.evaluate(() => {
    const svg = document.querySelector("figure.kg svg");
    if (svg === null) return [];
    const out = new Set<string>();
    for (const node of svg.querySelectorAll<SVGElement>("*")) {
      const style = getComputedStyle(node);
      for (const paint of [style.fill, style.stroke]) {
        if (paint !== "" && paint !== "none") out.add(paint);
      }
    }
    return [...out].sort();
  });

/** Every token the lab can set, as the browser currently resolves it. */
const snapshot = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => {
    const computed = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const field of document.querySelectorAll<HTMLElement>("[data-pg-lab-token]")) {
      const name = field.dataset["pgLabToken"];
      if (name !== undefined) out[name] = computed.getPropertyValue(name).trim();
    }
    return out;
  });

async function openLab(page: Page): Promise<void> {
  await page.waitForFunction(() => "__paginaTheming" in window);
  const launcher = page.locator("[data-pg-lab-launcher]");
  if ((await launcher.getAttribute("aria-expanded")) !== "true") await launcher.click();
  await expect(page.locator("[data-pg-lab-export]")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/theming");
  await page.evaluate(() => {
    localStorage.removeItem("pagina-theme-lab");
    localStorage.removeItem("pagina-theme");
  });
  await page.reload();
});

test("a preset retints the prose, the chrome and the pre-rendered figure at once", async ({ page }) => {
  await openLab(page);
  const before = await figurePaints(page);
  expect(before.length, "the built page really does carry a drawn figure").toBeGreaterThan(1);
  expect(await figureCanvas(page)).not.toBe(ORCHID.light.raisedRgb);

  await page.click('[data-pg-lab-preset="orchid"]');

  expect(await tokenValue(page, "--pg-accent")).toBe(ORCHID.light.accent);
  // The bridge under test: nothing set a `--kg-*`, and the figure's roles followed anyway.
  expect(await tokenValue(page, "--kg-color-accent")).toBe(ORCHID.light.accent);
  expect(await figureCanvas(page), "the drawing's own plane moved").toBe(ORCHID.light.raisedRgb);
  expect(await figurePaints(page), "and so did the rest of it").not.toEqual(before);

  // Prose and chrome, which read the same variables, moved with it.
  // The chrome's accent, not a link: the fixture's figures page has no prose links, and picking an
  // element that happens to exist on one page is how a spec starts skipping the thing it checks.
  await expect(page.locator(".pg-theme-toggle__thumb")).toHaveCSS("background-color", ORCHID.light.accentRgb);
  await expect(page.locator("body")).toHaveCSS("background-color", ORCHID.light.bgRgb);

  // The other half of the export, on the same click: switching the preview scheme moves the page,
  // the figure and the panel together, because a preset is two blocks and not a palette.
  await page.click('[data-pg-lab-scheme="dark"]');
  expect(await tokenValue(page, "--pg-accent")).toBe(ORCHID.dark.accent);
  expect(await figureCanvas(page)).toBe(ORCHID.dark.raisedRgb);
  await expect(page.locator("body")).toHaveCSS("background-color", ORCHID.dark.bgRgb);
});

test("a single token can be changed by hand, and only that token moves", async ({ page }) => {
  await openLab(page);
  const measureBefore = await tokenValue(page, "--pg-measure");
  const field = page.locator('[data-pg-lab-token="--pg-accent"]');
  await field.fill("#0aa06e");
  await field.press("Enter");

  expect(await tokenValue(page, "--pg-accent")).toBe("#0aa06e");
  expect(await tokenValue(page, "--pg-measure"), "nothing else was touched").toBe(measureBefore);
  await expect(page.locator(".pg-theme-toggle__thumb")).toHaveCSS("background-color", "rgb(10, 160, 110)");
  // A hand edit is no longer any preset.
  await expect(page.locator('[data-pg-lab-preset="orchid"]')).toHaveAttribute("aria-pressed", "false");
});

test("the exported CSS reproduces the page it was copied from", async ({ page }) => {
  await openLab(page);
  await page.click('[data-pg-lab-preset="console"]');
  const radius = page.locator('[data-pg-lab-token="--pg-radius"]');
  await radius.fill("11px");
  await radius.press("Enter");

  const exported = (await page.locator("[data-pg-lab-export]").textContent()) ?? "";
  expect(exported).toContain(":root {");
  expect(exported).toContain("--pg-radius: 11px");

  const wearing = await snapshot(page);

  // Throw the widget's stylesheet away entirely, then paste. This is the reader's workflow: they
  // copy twenty lines into their own site, where no pagina widget exists.
  await page.evaluate(() => {
    document.querySelector("style[data-pg-theme-lab]")?.remove();
  });
  expect(await snapshot(page), "the lab really was the only thing applying it").not.toEqual(wearing);

  await page.evaluate((css) => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
  }, exported);

  expect(await snapshot(page), "pasting the export puts every token back").toEqual(wearing);
});

test("the choice survives a reload, and Reset undoes it", async ({ page }) => {
  await openLab(page);
  const original = await tokenValue(page, "--pg-accent");
  await page.click('[data-pg-lab-preset="orchid"]');

  await page.reload();
  await page.waitForFunction(() => "__paginaTheming" in window);
  expect(await tokenValue(page, "--pg-accent"), "restored without anyone touching anything").toBe(ORCHID.light.accent);

  await openLab(page);
  await page.click("[data-pg-lab-reset]");
  expect(await tokenValue(page, "--pg-accent")).toBe(original);
  await page.reload();
  await page.waitForFunction(() => "__paginaTheming" in window);
  expect(await tokenValue(page, "--pg-accent"), "and the reset is remembered too").toBe(original);
});

test("the panel is reachable and operable from the keyboard", async ({ page }) => {
  await page.waitForFunction(() => "__paginaTheming" in window);
  const launcher = page.locator("[data-pg-lab-launcher]");
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  // Every control is a real control, so Tab reaches them without a roving handler of our own.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).toBe("BUTTON");
  await page.keyboard.press("Escape");
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-pg-lab-launcher") ?? false)).toBe(true);
});

test("the showcase renders every identity, wearing the CSS printed under it", async ({ page }) => {
  await page.waitForFunction(() => "__paginaTheming" in window);
  await expect(page.locator(".pgs__card")).toHaveCount(IDENTITIES.length);

  // The frames are written when they come near the viewport, so walk the section.
  for (const id of IDENTITIES) await page.locator(`#identity-${id}`).scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLIFrameElement>(".pgs__iframe")].every(
      (frame) => frame.contentDocument?.querySelector("article.pg-content") != null,
    ),
  );

  for (const id of IDENTITIES) {
    if (id === "default") continue; // nothing to list: it is the control
    const listing = ((await page.locator(`#identity-${id} .pgs__code`).textContent()) ?? "").trim();
    const inFrame = await page.evaluate((identity) => {
      const frame = document.querySelector<HTMLIFrameElement>(`#identity-${identity} iframe`);
      return frame?.contentDocument?.querySelector("style")?.textContent?.trim() ?? "";
    }, id);
    expect(listing, `${id}: the listing is not empty`).not.toBe("");
    expect(inFrame, `${id}: the listing is the frame's stylesheet`).toBe(listing);
  }

  // …and they really are six identities, not one look tinted six ways. Ground alone is not the
  // test — three of them are legitimately white — so the fingerprint is ground *and* body face
  // *and* heading size, which is the claim the section makes: type, rhythm and colour all move.
  const looks = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLIFrameElement>(".pgs__iframe")].map((frame) => {
      const inner = frame.contentDocument;
      const body = inner?.body;
      const h2 = inner?.querySelector(".pg-content h2");
      if (body == null || h2 == null) return "";
      const s = getComputedStyle(body);
      return `${s.backgroundColor}|${s.fontFamily}|${getComputedStyle(h2).fontSize}`;
    }),
  );
  expect(new Set(looks).size, "six identities, six looks").toBe(IDENTITIES.length);

  // The rung-3 frame links the tokens-only sheet, which is what makes it rung 3 at all.
  const bareSheet = await page.evaluate(
    () =>
      document
        .querySelector<HTMLIFrameElement>("#identity-bare iframe")
        ?.contentDocument?.querySelector("link")
        ?.getAttribute("href") ?? "",
  );
  // Content-hashed in a built site (`pagina.tokens.<hash>.css`), and derived from the sheet the
  // *page* links rather than passed in — which is the whole reason the two names share one hash.
  expect(bareSheet).toMatch(/\/pagina\.tokens(\.[0-9a-f]{8})?\.css(?=$|[?#])/);
});

test("works at a true 390px, without scrolling the page sideways", async ({ page }) => {
  // Chrome will not lay a window out below ~614px, so the phone viewport is a same-origin iframe
  // whose *layout* viewport really is 390px. Measuring the window instead is how a page comes to be
  // declared responsive while being unusable.
  // The outer window has to be taller than the frame, or the lab's `position: fixed` launcher sits
  // below the *embedder's* fold with nothing that can scroll it into view.
  await page.setViewportSize({ width: 800, height: 900 });
  await page.setContent(
    `<body style="margin:0"><iframe name="phone" src="/theming" style="width:390px;height:840px;border:0"></iframe></body>`,
  );
  const phone = page.frameLocator('iframe[name="phone"]');
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[name="phone"]');
    return frame?.contentWindow !== null && frame?.contentWindow !== undefined && "__paginaTheming" in frame.contentWindow;
  });
  const inner = page.frame({ name: "phone" });
  expect(inner, "the phone frame is addressable").not.toBeNull();

  expect(await inner!.evaluate(() => document.documentElement.clientWidth)).toBe(390);
  const overflow = (): Promise<number> =>
    inner!.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), "the page does not scroll sideways").toBeLessThanOrEqual(1);

  await phone.locator("[data-pg-lab-launcher]").click();
  const panel = phone.locator(".pgl__panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box, "the panel has a box").not.toBeNull();
  expect(box!.width, "and it fits").toBeLessThanOrEqual(390);

  await phone.locator('[data-pg-lab-preset="orchid"]').click();
  expect(await tokenValue(inner!, "--pg-accent")).toBe(ORCHID.light.accent);
  expect(await overflow(), "and still does not, wearing a theme").toBeLessThanOrEqual(1);
});
