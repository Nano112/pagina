/**
 * A Kineglyph figure as a reader gets it: built assets, a foreign host, a real browser.
 *
 * Everything this covers used to be impossible rather than merely broken, and for one reason —
 * the figure arrived through `<img>`. An image is a separate document, so a host's CSS never
 * reached it, its `<title>`/`<desc>` never reached the accessibility tree, and the `alt=""` one
 * line of `figures.ts` wrote made every diagram in the system invisible to a screen reader. The
 * figure is inline SVG now, and these are the things that buys.
 *
 * A page shows the figure two ways and both are checked, because a reader may see either:
 *
 *  - the **pre-rendered frame**, which is the whole figure with no JavaScript at all — the only
 *    thing a reader without the runtime, or before it lands, ever sees;
 *  - the **live stage** the runtime mounts over it, which re-lays-out to the container.
 *
 * Both are inline SVG now, so both take the host's tokens. That is the claim.
 *
 * This runs in the `bundle` project because that is the only configuration where this project's
 * defects have ever been visible: `dist/pagina.css` on a plain Node server, under a
 * preflight-shaped reset that the host links first.
 *
 * The three screenshots are the deliverable — default palette, host theme, phone — and the
 * assertions are what stop them from being three pictures of a bug nobody looked closely at.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { SITE_BASE } from "./setup.js";

const SHOTS = fileURLToPath(new URL("../test-results/figures/", import.meta.url));
const PUBLISHED = `${SITE_BASE}guide/figures/`;
/** The figure built from `scenes/demo.mjs` — the one with tones, edges and a caption. */
const FIGURE = "figure.kg#kg-guide-figures-1";
/** The server-rendered frame, and the stage the runtime mounts over it. */
const STATIC = `${FIGURE} .kg-frame > svg`;
const LIVE = `${FIGURE} [data-kg-stage] svg`;

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
});

/**
 * The colours the browser resolves for a diagram's own parts — the tokens, applied.
 *
 * Every text fill is collected rather than one, because the point is that the *whole* palette
 * arrives: a diagram whose labels took the host's ink while its captions kept Kineglyph's would
 * pass a single-element check and still be half-themed.
 */
async function paint(page: Page, selector: string): Promise<{ canvas: string; inks: string[] }> {
  return await page.locator(selector).first().evaluate((svg) => ({
    canvas: getComputedStyle(svg.querySelector(".kg-canvas")!).fill,
    inks: [...new Set([...svg.querySelectorAll("text")].map((t) => getComputedStyle(t).fill))].sort(),
  }));
}

const frame = (page: Page): Locator => page.locator(`${FIGURE} .kg-frame`);

/**
 * Waits for the live figure to finish revealing itself.
 *
 * A scene with a timeline autoplays from nothing, so for the first few hundred milliseconds the
 * stage is legitimately empty — and a screenshot taken then is a picture of an empty box, not of
 * the figure. The runtime writes `--kg-timeline-progress` on the root every frame; 1 is done.
 */
async function settled(page: Page): Promise<void> {
  await expect(page.locator(LIVE)).toBeVisible();
  await page.waitForFunction((sel) => {
    const svg = document.querySelector(sel);
    return svg !== null && Number(getComputedStyle(svg).getPropertyValue("--kg-timeline-progress")) >= 1;
  }, LIVE);
}

/** pagina's documented defaults, resolved: `--pg-bg-raised`, then `--pg-fg` and `--pg-muted`. */
const DEFAULT_PAINT = { canvas: "rgb(246, 247, 249)", inks: ["rgb(107, 114, 128)", "rgb(26, 29, 35)"] };
/** The host page's own: `#15151d`, `#ece9f2`, `#9a93ab`. */
const HOST_PAINT = { canvas: "rgb(21, 21, 29)", inks: ["rgb(154, 147, 171)", "rgb(236, 233, 242)"] };

test.describe("the figure a reader gets without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("is the whole diagram, in the page rather than linked from it", async ({ page }) => {
    await page.goto(PUBLISHED);

    // The premise. An `<img>` here would put a document boundary between the diagram and every
    // other assertion in this file.
    await expect(page.locator(STATIC)).toBeVisible();
    await expect(page.locator(`${FIGURE} img`)).toHaveCount(0);
    await expect(page.locator(`${FIGURE} picture`)).toHaveCount(0);
  });

  test("carries the author's words into the accessibility tree", async ({ page }) => {
    await page.goto(PUBLISHED);
    const svg = page.locator(STATIC);

    await expect(svg).toHaveAttribute("role", "img");
    // The SVG's own `<title>` and `<desc>`, which an `<img>` could never expose and which
    // `alt=""` used to throw away outright.
    await expect(svg).toHaveAccessibleName("How a page is published");
    await expect(svg).toHaveAccessibleDescription(/host's own font/);
    // And the caption is visible prose the surrounding text can refer to.
    await expect(page.locator(`${FIGURE} figcaption`)).toBeVisible();
    await expect(page.locator(`${FIGURE} figcaption`)).toContainText("Publishing, end to end");
  });

  test("takes pagina's default palette, with no runtime to do it", async ({ page }) => {
    await page.goto(PUBLISHED);
    // Straight out of `dist/pagina.css`. Not Kineglyph's own #f7f8fa / #15171a.
    expect(await paint(page, STATIC)).toEqual(DEFAULT_PAINT);
  });

  test("takes the host's palette too, from `--pg-*` alone", async ({ page }) => {
    await page.goto("/site-figures-dark");
    expect(await paint(page, STATIC)).toEqual(HOST_PAINT);
  });
});

test.describe("the figure once the runtime has mounted", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("takes pagina's default palette", async ({ page }) => {
    await page.goto(PUBLISHED);
    await settled(page);

    expect(await paint(page, LIVE)).toEqual(DEFAULT_PAINT);
    await page.screenshot({ path: `${SHOTS}published-default.png`, fullPage: true });
  });

  test("is re-tinted by `--pg-*` alone, with no `--kg-*` anywhere on the page", async ({ page }) => {
    await page.goto("/site-figures-dark");
    await settled(page);

    // The host defines twenty `--pg-*` properties and nothing else — the mapping in `tokens.css`
    // is what carries them into the diagram.
    const declaresKg = await page.evaluate(() =>
      [...document.querySelectorAll("style")].some((s) => (s.textContent ?? "").includes("--kg-color")),
    );
    expect(declaresKg).toBe(false);

    expect(await paint(page, LIVE)).toEqual(HOST_PAINT);
    // The accent reaches the diagram's emphasis too: `--pg-accent: #ff2bd1`.
    const accents = await page.locator(LIVE).evaluate((svg) =>
      [...svg.querySelectorAll("*")].filter((el) => getComputedStyle(el).stroke === "rgb(255, 43, 209)").length,
    );
    expect(accents).toBeGreaterThan(0);

    await page.screenshot({ path: `${SHOTS}host-theme.png`, fullPage: true });
  });

  test("holds back the space the pre-rendered figure was occupying", async ({ page }) => {
    await page.goto(PUBLISHED);
    await expect(page.locator(LIVE)).toBeVisible();

    // The floor the stage reserves is exactly the height the frame had at this width, so the
    // drawing lands where the reader was already looking. The stage may be *taller* — the runtime
    // adds a readout and a transport the static frame has none of — but it can never be shorter,
    // which is the direction that pulls the page up.
    const stage = await page.locator(`${FIGURE} [data-kg-stage]`).evaluate((el) => {
      const s = getComputedStyle(el.closest("figure")!);
      const width = el.getBoundingClientRect().width;
      return {
        height: el.getBoundingClientRect().height,
        reserved: (width * Number(s.getPropertyValue("--kg-h"))) / Number(s.getPropertyValue("--kg-w")),
        drawing: el.querySelector("svg")!.getBoundingClientRect().height,
      };
    });
    expect(stage.height).toBeGreaterThanOrEqual(stage.reserved - 1);
    // …and the drawing itself is really drawn, not clipped to nothing by the reservation.
    expect(stage.drawing).toBeGreaterThan(stage.reserved * 0.9);
  });

  test("fits the column, and never scrolls the page sideways", async ({ page }) => {
    await page.goto(PUBLISHED);
    await expect(page.locator(LIVE)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe("the same figure on a phone", () => {
  // Measured with the runtime off: this is the state that used to be worst — a 960-wide diagram
  // scaled to 390px, with its 16px type at 6px — and the state a reader sees first regardless.
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test("scrolls sideways instead of shrinking its type to nothing", async ({ page }) => {
    await page.goto(PUBLISHED);
    await expect(page.locator(STATIC)).toBeVisible();

    const measured = await frame(page).evaluate((el) => {
      const svg = el.querySelector("svg")!;
      const fig = el.closest("figure")!;
      return {
        scroll: el.scrollWidth,
        client: el.clientWidth,
        rendered: svg.getBoundingClientRect().width,
        natural: Number(getComputedStyle(fig).getPropertyValue("--kg-w")),
        type: [...svg.querySelectorAll("text")]
          .map((t) => parseFloat(getComputedStyle(t).fontSize))
          .sort((a, b) => a - b),
      };
    });

    // The frame is its own scroll box, and the diagram keeps a legible size inside it.
    expect(measured.scroll).toBeGreaterThan(measured.client);
    const scale = measured.rendered / measured.natural;
    expect(scale).toBeGreaterThanOrEqual(0.69);

    // What that buys, in pixels on the glass. Scaled to fit this viewport instead the figure
    // would be at 0.41, which is where a 16px label lands at 6.5px and a caption at 4.9px.
    const onGlass = measured.type.map((size) => size * scale);
    expect(Math.max(...onGlass)).toBeGreaterThan(11);
    expect(Math.min(...onGlass)).toBeGreaterThan(8);
    expect(scale).toBeGreaterThan(390 / measured.natural + 0.25);

    // …and the *page* still does not scroll sideways: the overflow is contained by the frame.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.screenshot({ path: `${SHOTS}phone.png`, fullPage: false });
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Quiet by default, and what "quiet" is worth.
 * ------------------------------------------------------------------------------------------- */

/** The three figures the fixture carries, one per chrome state. */
const QUIET = FIGURE; // said nothing → a picture
const OPTED_IN = "figure.kg#instrument-demo"; // data-instrument="true"
const AS_BEFORE = "figure.kg#chrome-demo"; // data-controls/readout="true" → what every figure was

const chromeOf = async (page: Page, selector: string): Promise<Record<string, number>> => ({
  readout: await page.locator(`${selector} .kg-figure__readout`).count(),
  controls: await page.locator(`${selector} .kg-figure__controls`).count(),
});

test.describe("a figure in prose is a picture", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("wears no readout and no transport when the author asked for neither", async ({ page }) => {
    await page.goto(PUBLISHED);
    await settled(page);

    expect(await chromeOf(page, QUIET)).toEqual({ readout: 0, controls: 0 });
    // The drawing is untouched — this is about the furniture, not the picture.
    await expect(page.locator(`${QUIET} [data-kg-stage] svg`)).toBeVisible();
    // …and with no chrome to hold together, the runtime's own box is gone too, so the figure
    // does not gain a border it never had in its pre-rendered form.
    const bordered = await page.locator(`${QUIET} .kg-figure`).evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(bordered).toBe("0px");
  });

  test("gives an opted-in figure what its scene justifies, and a scene-less bar to nobody", async ({ page }) => {
    await page.goto(PUBLISHED);
    await settled(page);

    // `data-instrument="true"` on a scene that animates *and* has inspectable boxes: both.
    expect(await chromeOf(page, OPTED_IN)).toEqual({ readout: 1, controls: 1 });
    // The transport is live, not a disabled ornament — the complaint that started this.
    await expect(page.locator(`${OPTED_IN} .kg-figure__controls button`).first()).toBeEnabled();
  });

  test("leaves a figure that explicitly asked for chrome exactly as it was", async ({ page }) => {
    await page.goto(PUBLISHED);
    await settled(page);
    expect(await chromeOf(page, AS_BEFORE)).toEqual({ readout: 1, controls: 1 });
  });

  test("the quiet figure is markedly shorter than the same figure with the instrument", async ({ page }) => {
    await page.goto(PUBLISHED);
    await settled(page);

    const height = async (sel: string): Promise<number> =>
      await page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
    const [quiet, loud] = [await height(QUIET), await height(OPTED_IN)];
    // Same scene, same caption length class: the whole difference is the chrome. It was ~100px
    // of readout and transport on every figure on every page.
    expect(loud - quiet).toBeGreaterThan(80);
  });
});

test.describe("hydration does not resize the figure", () => {
  /**
   * The measurement the last round left open.
   *
   * The pre-rendered frame and the live stage are two different renderings of one diagram, and
   * the reader sees the first replaced by the second. Any height difference between them is the
   * page moving under someone mid-sentence. It used to be ~100px, because the runtime added a
   * readout and a transport that the frame had no equivalent of; with those gone the two should
   * agree, and this measures rather than assumes it.
   *
   * Measured as two loads of the same URL at one viewport — JavaScript off, then on — because
   * that is exactly what "before and after hydration" means, and it does not race the mount.
   */
  const VIEWPORT = { width: 1280, height: 900 };

  const figureHeights = async (page: Page): Promise<Record<string, number>> =>
    await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("figure.kg")].map((f) => [
          f.id,
          Math.round(f.getBoundingClientRect().height * 100) / 100,
        ]),
      ),
    );

  test("the frame and the live stage are the same height, figure for figure", async ({ browser }) => {
    const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORT });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(PUBLISHED);
    await expect(staticPage.locator(STATIC)).toBeVisible();
    const before = await figureHeights(staticPage);
    await staticContext.close();

    const liveContext = await browser.newContext({ viewport: VIEWPORT });
    const livePage = await liveContext.newPage();
    await livePage.goto(PUBLISHED);
    await settled(livePage);
    const after = await figureHeights(livePage);
    await liveContext.close();

    // Printed so a regression reads as numbers rather than as a bare boolean.
    console.log("[figures] hydration heights", JSON.stringify({ before, after }, null, 1));

    // The quiet figure is the claim: it must not move at all. One pixel of tolerance for
    // sub-pixel layout rounding between two renderings, and nothing more.
    expect(Math.abs(after["kg-guide-figures-1"]! - before["kg-guide-figures-1"]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(after["inline-demo"]! - before["inline-demo"]!)).toBeLessThanOrEqual(1);
  });
});

/**
 * A still figure is not hydrated at all.
 *
 * `inline-demo` is a heading in a box: no timeline, nothing inspectable, no machine. Mounting it
 * would fetch a module, resolve a scene and rebuild the DOM in order to draw the SVG that was
 * already on screen — and would throw away the server-rendered one, which is the copy a screen
 * reader has already read and CSS has already themed. So the publish marks it `data-kg-inert` and
 * the client declines it. The height assertion above already proves the reader cannot tell.
 */
test.describe("a figure with nothing to drive is left alone", () => {
  const INERT = "figure.kg#inline-demo";

  test("keeps the server-rendered SVG and never mounts", async ({ page }) => {
    await page.goto(PUBLISHED);
    // Wait for a figure that *does* mount, so "not mounted" is a decision rather than a race.
    await settled(page);

    const state = await page.locator(INERT).evaluate((el) => ({
      inert: el.dataset.kgInert,
      mounted: el.dataset.kineglyphMounted,
      error: el.dataset.kineglyphError,
      stages: el.querySelectorAll("[data-kg-stage]").length,
      frameHidden: el.querySelector<HTMLElement>("[data-kg-static]")!.hidden,
      frameSvgs: el.querySelectorAll(".kg-frame > svg").length,
    }));
    expect(state).toEqual({
      inert: "true",
      mounted: undefined,
      error: undefined,
      stages: 0,
      frameHidden: false,
      frameSvgs: 1,
    });
  });

  test("still hydrates the figures that have something to drive", async ({ page }) => {
    await page.goto(PUBLISHED);
    await settled(page);
    const mounted = await page.evaluate(() =>
      [...document.querySelectorAll('figure.kg[data-kineglyph-mounted="true"]')].map((f) => f.id).sort(),
    );
    expect(mounted).toEqual(["chrome-demo", "instrument-demo", "kg-guide-figures-1"]);
  });
});

/**
 * A diagram is wider than prose by nature: `--pg-figure-max`.
 *
 * The measure is chosen for sentences. Squeezing a 960-wide diagram into it scales the type down
 * with the picture — comfortably above `--pg-figure-min-scale`, so the scroll rule never fires,
 * and still too small to read. The token lets a host spend the room it actually has.
 *
 * The tests below set it on the page rather than in the fixture, because the default is the thing
 * every other test in this file already covers: opting in is what needs proving.
 */
/** The value `docs/theming.md` tells a host to write: room to spare, guarded against the viewport. */
const HOST_OPT_IN = "min(960px, calc(100vw - 4rem))";

/**
 * Sets `--pg-figure-max` the way a host would — in a stylesheet the document links — rather than
 * through `addStyleTag`, which needs JavaScript and so cannot run in the no-JS lane that matters
 * most here. The next navigation gets it.
 */
async function optIn(page: Page, value: string): Promise<void> {
  await page.route(/\/guide\/figures\/?$/, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace("</head>", `<style>:root { --pg-figure-max: ${value}; }</style></head>`),
    });
  });
}

test.describe("a figure may be wider than the column", () => {
  const CAPTION = `${FIGURE} > figcaption`;
  const PROSE = ".pg-content > h2";

  /** Reads the geometry that matters, before and after the host opts in. */
  const geometry = async (page: Page): Promise<Record<string, number>> =>
    await page.evaluate(
      ([fig, caption, prose]) => {
        const f = document.querySelector(fig!)!.getBoundingClientRect();
        const svg = document.querySelector(`${fig!} .kg-frame > svg`)!;
        const box = svg.getBoundingClientRect();
        const viewBox = Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/)[2]);
        return {
          figureLeft: Math.round(f.left),
          figureWidth: Math.round(f.width),
          captionLeft: Math.round(document.querySelector(caption!)!.getBoundingClientRect().left),
          proseLeft: Math.round(document.querySelector(prose!)!.getBoundingClientRect().left),
          drawn: Math.round(box.width),
          // What a 12px label actually lands at, which is the whole point of the token.
          scale: Math.round((box.width / viewBox) * 100) / 100,
          pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      },
      [FIGURE, CAPTION, PROSE],
    );

  test.use({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });

  test("uses the room the host offers, and leaves the prose exactly where it was", async ({ page }) => {
    await page.goto(PUBLISHED);
    await expect(page.locator(STATIC)).toBeVisible();
    const before = await geometry(page);

    await optIn(page, HOST_OPT_IN);
    await page.goto(PUBLISHED);
    await expect(page.locator(STATIC)).toBeVisible();
    const after = await geometry(page);
    console.log("[figures] --pg-figure-max", JSON.stringify({ before, after }, null, 1));

    // The figure grows to its natural width, so it is drawn at 1:1 and its type is its own size.
    expect(after.figureWidth).toBeGreaterThan(before.figureWidth!);
    expect(after.scale).toBe(1);
    expect(before.scale!).toBeLessThan(1);
    // The prose does not move with it: only the figure's own margins changed.
    expect(after.proseLeft).toBe(before.proseLeft);
    // …and the figure is centred on the column it left, not shoved to one side.
    const overhang = (after.figureWidth! - before.figureWidth!) / 2;
    expect(Math.abs(before.figureLeft! - after.figureLeft! - overhang)).toBeLessThanOrEqual(1);
    // The caption is prose, so it stays in the column with the paragraphs.
    expect(Math.abs(after.captionLeft! - after.proseLeft!)).toBeLessThanOrEqual(1);
    // And the page still does not scroll sideways.
    expect(after.pageScroll).toBeLessThanOrEqual(1);
  });

  test("changes nothing for a host that does not opt in", async ({ page }) => {
    await page.goto(PUBLISHED);
    await expect(page.locator(STATIC)).toBeVisible();
    const g = await geometry(page);
    // The default is `100%` — the measure — so the figure and the prose share an edge.
    expect(g.figureLeft).toBe(g.proseLeft);
    expect(g.captionLeft).toBe(g.proseLeft);
  });
});

test.describe("a wide figure on a phone", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test("collapses back to the column and scrolls, rather than pushing the page sideways", async ({ page }) => {
    // The value a host is told to write: the viewport term is what makes it safe here.
    await optIn(page, HOST_OPT_IN);
    await page.goto(PUBLISHED);
    await expect(page.locator(STATIC)).toBeVisible();

    const measured = await frame(page).evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      rendered: Math.round(el.querySelector("svg")!.getBoundingClientRect().width),
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      captionLeft: Math.round(el.closest("figure")!.querySelector("figcaption")!.getBoundingClientRect().left),
      proseLeft: Math.round(document.querySelector(".pg-content > h2")!.getBoundingClientRect().left),
    }));
    console.log("[figures] wide figure at 390px", JSON.stringify(measured, null, 1));

    // Still scrolling at the legibility floor, exactly as it did before the token existed.
    expect(measured.scroll).toBeGreaterThan(measured.client);
    expect(measured.rendered).toBe(672); // 960 × --pg-figure-min-scale
    // The page itself does not scroll, which is the failure a breakout invites.
    expect(measured.pageScroll).toBeLessThanOrEqual(1);
    // Below the measure there is no overhang to inset, so the caption is where it always was.
    expect(measured.captionLeft).toBe(measured.proseLeft);
  });
});

test.describe("what it looks like", () => {
  /**
   * The deliverable: the same diagram in the same host theme, three ways, so the change is legible
   * side by side rather than argued about.
   *
   * On the host page — schemat.io-shaped magenta-on-near-black with Figtree — because a figure
   * that only looks considered in pagina's own palette has not been themed, it has been decorated.
   */
  test("quiet, opted in, and as it was — in the host's theme", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/site-figures-dark");
    await settled(page);
    await page.waitForFunction(() => document.fonts.ready.then(() => true));

    // A figure in prose: the drawing, its caption, and nothing else.
    await page.locator(QUIET).screenshot({ path: `${SHOTS}quiet-host.png` });
    // The same scene, opted into the instrument with `data-instrument="true"`.
    await page.locator(OPTED_IN).screenshot({ path: `${SHOTS}instrument-host.png` });
    // And the previous rendering, for comparison: before this change *every* figure looked like
    // this one, including the two above. It is reachable today only by asking for it explicitly.
    await page.locator(AS_BEFORE).screenshot({ path: `${SHOTS}previous-rendering-host.png` });
  });

  test("the quiet figure on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/site-figures-dark");
    await settled(page);
    await page.waitForFunction(() => document.fonts.ready.then(() => true));
    await page.locator(QUIET).screenshot({ path: `${SHOTS}quiet-phone.png` });
  });
});
