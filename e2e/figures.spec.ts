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
/**
 * The server-rendered frame, and the stage the runtime mounts over it.
 *
 * A figure carries *several* pre-rendered drawings now — one per container width — and CSS shows
 * exactly one of them. So `STATIC` is the drawing on show rather than the drawings present, and
 * `:visible` is load-bearing: `.first()` would read the widest whatever the container query
 * decided, and would go on passing if selection broke entirely.
 */
const DRAWINGS = `${FIGURE} .kg-frame > svg`;
const STATIC = `${DRAWINGS}:visible`;
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

/** What a drawing is, once the browser has laid it out: which one, how big, and how legible. */
interface Drawn {
  /** The container width this drawing was measured for, from `data-kg-variant`. */
  readonly variant: string | null;
  /** The named layout it was resolved in — `wide` / `compact` / `narrow`. */
  readonly layout: string | null;
  readonly frameWidth: number;
  /** Whether the frame has to scroll to show all of it. With variants it should not. */
  readonly frameScrolls: boolean;
  readonly width: number;
  readonly height: number;
  readonly viewBox: number;
  /** Rendered width over measured width: >1 is scaled up, <1 is scaled down. */
  readonly scale: number;
  /** The smallest label on the glass, in CSS pixels. The number the reader actually reads. */
  readonly minType: number;
  readonly pageScroll: number;
}

/**
 * The drawing the page has chosen, having first proved that it chose exactly one.
 *
 * The count assertion is the point of the helper. Selecting the right drawing is the whole
 * mechanism this file now covers, and every measurement below is only meaningful once we know it
 * is being taken from the one on show.
 */
async function chosen(page: Page, figure: string = FIGURE): Promise<Drawn> {
  const all = page.locator(`${figure} .kg-frame > svg`);
  expect(await all.count(), "the figure should carry more than one drawing").toBeGreaterThan(1);
  await expect(page.locator(`${figure} .kg-frame > svg:visible`)).toHaveCount(1);

  return await page.locator(`${figure} .kg-frame > svg:visible`).evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const holder = svg.parentElement!;
    const viewBox = Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/)[2]);
    const scale = box.width / viewBox;
    const type = [...svg.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize));
    return {
      variant: svg.getAttribute("data-kg-variant"),
      layout: svg.getAttribute("data-layout"),
      frameWidth: Math.round(holder.getBoundingClientRect().width),
      frameScrolls: holder.scrollWidth > holder.clientWidth + 1,
      width: Math.round(box.width),
      height: Math.round(box.height),
      viewBox,
      scale: Math.round(scale * 100) / 100,
      minType: Math.round(Math.min(...type) * scale * 10) / 10,
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/**
 * Where a drawing's boxes and connectors sit, in its own coordinates.
 *
 * Read off the DOM rather than off a screenshot, because the thing worth pinning is the *routing*
 * decision: three boxes sharing a y with horizontal runs between them is a row; three sharing an x
 * with vertical runs is a column. A connector left pointing the old way after the boxes moved is
 * the regression this catches, and it is invisible in a height measurement.
 */
async function routing(locator: Locator): Promise<{ boxes: { x: number; y: number }[]; runs: { dx: number; dy: number }[] }> {
  return await locator.evaluate((svg) => {
    const boxes = ["n:source", "n:render", "n:store"].map((id) => {
      const el = svg.querySelector(`[data-node-id="${id}"]`)!;
      const b = (el as SVGGraphicsElement).getBBox();
      return { x: Math.round(b.x), y: Math.round(b.y) };
    });
    const seen = new Set<string>();
    const runs: { dx: number; dy: number }[] = [];
    for (const p of svg.querySelectorAll("path")) {
      const d = p.getAttribute("d") ?? "";
      const m = /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/.exec(d);
      if (m === null || seen.has(d)) continue;
      seen.add(d);
      runs.push({ dx: Math.round(Number(m[3]) - Number(m[1])), dy: Math.round(Number(m[4]) - Number(m[2])) });
    }
    return { boxes, runs };
  });
}

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

    // Several drawings are in the page and exactly one of them is on show. Both halves matter:
    // the first is what makes the figure answer for its own width with no JavaScript, the second
    // is what stops a reader being handed the same diagram four times over.
    await expect(page.locator(DRAWINGS)).toHaveCount(4);
    await expect(page.locator(STATIC)).toHaveCount(1);
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
  // Measured with the runtime off: the state a reader sees first regardless, and the one this
  // whole mechanism exists for.
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  /**
   * This used to assert the opposite, and said so in its name: "scrolls sideways instead of
   * shrinking its type to nothing". That was the best answer available while a figure had one
   * drawing — the only two moves were shrink or scroll, and scrolling at least kept the labels
   * readable. It is superseded rather than merely relaxed: the figure now carries a drawing
   * *measured for* a phone, so there is nothing to scroll to and nothing to shrink.
   */
  test("is drawn for the phone rather than scaled down to it, and needs no scrolling at all", async ({ page }) => {
    await page.goto(PUBLISHED);
    const drawn = await chosen(page);
    console.log("[figures] phone, no JS", JSON.stringify(drawn));

    // The narrowest drawing is the one chosen for a 326px frame, and it was laid out for it —
    // three boxes stacked into a column, not three columns squeezed side by side.
    expect(drawn.variant).toBe("320");
    expect(drawn.layout).toBe("narrow");

    // Drawn at its own size, near enough: never scaled *down*, which is the direction that costs
    // legibility. 326 into 320 is 1.02.
    expect(drawn.scale).toBeGreaterThanOrEqual(1);

    // The whole diagram is on screen. Nothing to scroll to, in the frame or in the page.
    expect(drawn.frameScrolls).toBe(false);
    expect(drawn.width).toBeLessThanOrEqual(drawn.frameWidth + 1);
    expect(drawn.pageScroll).toBeLessThanOrEqual(1);

    // And the number that matters, on the glass: the author's own 12px, not 8.4px behind a
    // horizontal scrollbar and not the 4.9px that scaling one 960-wide drawing to fit would give.
    expect(drawn.minType).toBeGreaterThanOrEqual(12);

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

  test("a figure that never mounts does not move at all, and one that does barely moves", async ({ browser }) => {
    const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORT });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(PUBLISHED);
    await expect(staticPage.locator(STATIC)).toBeVisible();
    const before = await figureHeights(staticPage);
    const beforeDrawn = await chosen(staticPage);
    await staticContext.close();

    const liveContext = await browser.newContext({ viewport: VIEWPORT });
    const livePage = await liveContext.newPage();
    await livePage.goto(PUBLISHED);
    await settled(livePage);
    const after = await figureHeights(livePage);
    const afterLive = await livePage.locator(LIVE).evaluate((svg) => ({
      layout: svg.getAttribute("data-layout"),
      viewBox: Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/)[2]),
    }));
    await liveContext.close();

    // Printed so a regression reads as numbers rather than as a bare boolean.
    console.log("[figures] hydration heights", JSON.stringify({ before, after, beforeDrawn, afterLive }, null, 1));

    // A figure with nothing to drive is never mounted, so there is nothing to move: still exact.
    expect(Math.abs(after["inline-demo"]! - before["inline-demo"]!)).toBeLessThanOrEqual(1);

    /*
     * The mounted one used to be exact too, and deliberately is not any more.
     *
     * The frame quantises: it shows whichever of four drawings fits, so at a 726px column it shows
     * the 640px drawing scaled up by 1.13. The runtime does not quantise — it measures the column
     * and resolves the scene at 726 exactly. Same diagram, same arrangement, same reading order;
     * the text simply wraps at a slightly different measure, so the two differ in height by a few
     * per cent. Removing that would mean pinning the live figure to the variant's width, which
     * costs the thing the runtime is uniquely good at: re-laying-out when the phone is turned.
     *
     * So the assertion is what actually matters to a reader — the page does not lurch — with a
     * bound tight enough that the ~100px chrome regression this test was written for could never
     * hide inside it.
     */
    const moved = Math.abs(after["kg-guide-figures-1"]! - before["kg-guide-figures-1"]!);
    expect(moved).toBeLessThan(before["kg-guide-figures-1"]! * 0.12);
    expect(moved).toBeLessThan(30);

    // And it is the *same picture*: hydration must not change which arrangement the reader is
    // looking at, only how finely it was fitted.
    expect(afterLive.layout).toBe(beforeDrawn.layout);
    expect(afterLive.viewBox).toBe(beforeDrawn.frameWidth);
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
      // It carries the same four drawings as any other figure — being inert is about whether the
      // runtime touches it, not about how many widths it was drawn for…
      frameSvgs: el.querySelectorAll(".kg-frame > svg").length,
      // …and CSS has still chosen exactly one of them, with no JavaScript involved in that either.
      shownSvgs: [...el.querySelectorAll<SVGElement>(".kg-frame > svg")].filter(
        (svg) => getComputedStyle(svg).display !== "none",
      ).length,
    }));
    expect(state).toEqual({
      inert: "true",
      mounted: undefined,
      error: undefined,
      stages: 0,
      frameHidden: false,
      frameSvgs: 4,
      shownSvgs: 1,
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
        // The drawing on show, not the first one in the markup: opting in widens the frame, which
        // is precisely the thing that makes a *different* drawing the right one.
        const svg = [...document.querySelectorAll<SVGElement>(`${fig!} .kg-frame > svg`)].find(
          (s) => getComputedStyle(s).display !== "none",
        )!;
        const box = svg.getBoundingClientRect();
        const viewBox = Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/)[2]);
        return {
          figureLeft: Math.round(f.left),
          figureWidth: Math.round(f.width),
          captionLeft: Math.round(document.querySelector(caption!)!.getBoundingClientRect().left),
          proseLeft: Math.round(document.querySelector(prose!)!.getBoundingClientRect().left),
          drawn: Math.round(box.width),
          variant: Number(svg.getAttribute("data-kg-variant")),
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

    // The figure grows, and the wider frame earns it a wider *drawing* rather than the same one
    // stretched: 640 measured for a 726px column becomes 960 measured for a 960px one, landing at
    // 1:1 with its type at exactly the size it was authored.
    expect(after.figureWidth).toBeGreaterThan(before.figureWidth!);
    expect(after.variant!).toBeGreaterThan(before.variant!);
    expect(after.scale).toBe(1);
    // Before the opt-in it was the next drawing down, scaled up to fill the measure — which is
    // the trade the variant set makes, and never the scaled-*down* type the token was added for.
    expect(before.scale!).toBeGreaterThanOrEqual(1);
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

  /**
   * Also superseded, and it was the sharpest statement of the old contract: "collapses back to the
   * column and scrolls", pinned to `rendered === 672` — 960 × `--pg-figure-min-scale`, the exact
   * width the legibility floor held a too-wide drawing at.
   *
   * The `min(960px, calc(100vw - 4rem))` opt-in still collapses to the column on a phone, which is
   * the half of the claim that was about the *token* and is unchanged. What is gone is the scroll:
   * the collapsed frame is 326px, and there is a drawing measured for that.
   */
  test("collapses back to the column, and there it needs no scrolling either", async ({ page }) => {
    // The value a host is told to write: the viewport term is what makes it safe here.
    await optIn(page, HOST_OPT_IN);
    await page.goto(PUBLISHED);
    const drawn = await chosen(page);

    const around = await frame(page).evaluate((el) => ({
      captionLeft: Math.round(el.closest("figure")!.querySelector("figcaption")!.getBoundingClientRect().left),
      proseLeft: Math.round(document.querySelector(".pg-content > h2")!.getBoundingClientRect().left),
    }));
    console.log("[figures] wide figure at 390px", JSON.stringify({ ...drawn, ...around }));

    // The breakout gave back the room it could not use: the frame is the column, as before.
    expect(drawn.frameWidth).toBeLessThanOrEqual(390);
    // And in that column the phone drawing is the right one, at its own size, entire.
    expect(drawn.variant).toBe("320");
    expect(drawn.frameScrolls).toBe(false);
    expect(drawn.scale).toBeGreaterThanOrEqual(1);
    expect(drawn.minType).toBeGreaterThanOrEqual(12);
    // The page itself does not scroll, which is the failure a breakout invites.
    expect(drawn.pageScroll).toBeLessThanOrEqual(1);
    // Below the measure there is no overhang to inset, so the caption is where it always was.
    expect(around.captionLeft).toBe(around.proseLeft);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * One figure, drawn several times, of which the page shows one.
 * ------------------------------------------------------------------------------------------- */

/**
 * The mechanism itself, which nothing else in this file gates.
 *
 * A diagram's geometry is measured at publish time because SVG cannot wrap text, so the figure
 * ships several finished drawings and CSS picks between them with a container query. Three things
 * can break independently: the wrong one can be picked, more or fewer than one can be shown, and
 * the whole query can fail to apply — which would leave four diagrams stacked in the page.
 *
 * Run with **JavaScript off** throughout, because that is the path under test: this selection is
 * CSS, and it has to be right for a reader whose runtime never arrives as well as before it does.
 */
test.describe("the drawing that fits the frame", () => {
  test.use({ javaScriptEnabled: false });

  /**
   * Viewport → the drawing that should win, for the fixture's `960 / 640 / 440 / 320` set.
   *
   * The rule is "the widest drawing no wider than the frame", so the frame — not the viewport —
   * decides, and the column here is the viewport less the page's own padding. Chosen to sit either
   * side of each boundary rather than in the middle of each band, because an off-by-one in the
   * query is exactly what this is for.
   */
  const CASES: readonly { viewport: number; variant: string; layout: string }[] = [
    { viewport: 390, variant: "320", layout: "narrow" },
    { viewport: 430, variant: "320", layout: "narrow" },
    { viewport: 560, variant: "440", layout: "narrow" },
    { viewport: 820, variant: "640", layout: "compact" },
    { viewport: 1280, variant: "640", layout: "compact" },
  ];

  for (const { viewport, variant, layout } of CASES) {
    test(`at ${String(viewport)}px the frame shows the ${variant}px drawing, and only that one`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: viewport, height: 900 } });
      const page = await context.newPage();
      await page.goto(PUBLISHED);

      const drawn = await chosen(page); // asserts exactly one is shown
      console.log(`[figures] variant at ${String(viewport)}px`, JSON.stringify(drawn));

      expect(drawn.variant).toBe(variant);
      expect(drawn.layout).toBe(layout);
      // Never wider than the frame it was chosen for, so it is never scaled down and the frame
      // never has to scroll — the two properties the whole selection rule exists to guarantee.
      expect(drawn.viewBox).toBeLessThanOrEqual(drawn.frameWidth);
      expect(drawn.scale).toBeGreaterThanOrEqual(1);
      expect(drawn.frameScrolls).toBe(false);
      expect(drawn.pageScroll).toBeLessThanOrEqual(1);
      // The author's own type size is the floor, at every width.
      expect(drawn.minType).toBeGreaterThanOrEqual(12);

      await context.close();
    });
  }

  test("a row of boxes becomes a column, and the connectors turn with it", async ({ browser }) => {
    /*
     * The part most likely to regress silently.
     *
     * `scenes/demo.mjs` is three boxes in a row with a labelled connector between each pair. Below
     * the narrow breakpoint the row becomes a column — and a connector that kept its old routing
     * would run *across* the column instead of down it, which is a diagram that still renders,
     * still measures well, and no longer means anything. Read off the emitted path rather than a
     * screenshot so the failure names itself.
     */
    const wide = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
    const widePage = await wide.newPage();
    await widePage.goto(PUBLISHED);
    await expect(widePage.locator(STATIC)).toHaveCount(1);
    const asRow = await routing(widePage.locator(STATIC));
    await wide.close();

    const narrow = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const narrowPage = await narrow.newPage();
    await narrowPage.goto(PUBLISHED);
    await expect(narrowPage.locator(STATIC)).toHaveCount(1);
    const asColumn = await routing(narrowPage.locator(STATIC));
    await narrow.close();

    console.log("[figures] routing", JSON.stringify({ asRow, asColumn }));

    // A row: the three boxes share a top edge and step across.
    expect(new Set(asRow.boxes.map((b) => b.y)).size).toBe(1);
    expect(new Set(asRow.boxes.map((b) => b.x)).size).toBe(3);
    // A column: they share a left edge and step down.
    expect(new Set(asColumn.boxes.map((b) => b.x)).size).toBe(1);
    expect(new Set(asColumn.boxes.map((b) => b.y)).size).toBe(3);

    // And the connectors follow the arrangement: horizontal runs between the boxes of a row,
    // vertical runs between the boxes of a column. Two of each, one per authored edge.
    expect(asRow.runs.length).toBeGreaterThanOrEqual(2);
    for (const run of asRow.runs) {
      expect(run.dy).toBe(0);
      expect(run.dx).toBeGreaterThan(0);
    }
    expect(asColumn.runs.length).toBeGreaterThanOrEqual(2);
    for (const run of asColumn.runs) {
      expect(run.dx).toBe(0);
      expect(run.dy).toBeGreaterThan(0);
    }
  });
});

test.describe("the live figure agrees with the drawing it replaced", () => {
  /**
   * Hydration swaps a chosen drawing for a freshly resolved one, and the two have to be the same
   * picture or the reader is shown a different diagram the moment JavaScript lands. They agree
   * because both answer to the container: CSS picks the drawing measured nearest below the frame,
   * and the runtime measures the frame itself. Checked at both ends of the range, since the phone
   * is where they were most recently claimed — wrongly — to disagree.
   */
  for (const viewport of [390, 1280]) {
    test(`at ${String(viewport)}px both are the same arrangement, drawn at full size`, async ({ browser }) => {
      const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: viewport, height: 900 } });
      const staticPage = await noJs.newPage();
      await staticPage.goto(PUBLISHED);
      const drawn = await chosen(staticPage);
      await noJs.close();

      const withJs = await browser.newContext({ viewport: { width: viewport, height: 900 } });
      const livePage = await withJs.newPage();
      await livePage.goto(PUBLISHED);
      await settled(livePage);
      const live = await livePage.locator(LIVE).evaluate((svg) => {
        const box = svg.getBoundingClientRect();
        const holder = svg.parentElement!;
        const viewBox = Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/)[2]);
        const scale = box.width / viewBox;
        const type = [...svg.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize));
        return {
          layout: svg.getAttribute("data-layout"),
          viewBox,
          width: Math.round(box.width),
          height: Math.round(box.height),
          minType: Math.round(Math.min(...type) * scale * 10) / 10,
          // The bug this file now guards: the stage used to be pinned to an aspect ratio that
          // capped its height while `overflow-y: hidden` threw the rest of the drawing away.
          pinned: (holder as HTMLElement).style.aspectRatio,
          hiddenBelow: holder.scrollHeight - holder.clientHeight,
          scrollsSideways: holder.scrollWidth > holder.clientWidth + 1,
          pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      await withJs.close();

      console.log(`[figures] static vs live at ${String(viewport)}px`, JSON.stringify({ drawn, live }));

      // The same arrangement, reached two different ways.
      expect(live.layout).toBe(drawn.layout);
      // The runtime resolved against the frame the CSS had already measured against.
      expect(live.viewBox).toBe(drawn.frameWidth);
      // Nothing of the drawing is cut off, and nothing has to be scrolled to.
      expect(live.pinned).toBe("");
      expect(live.hiddenBelow).toBeLessThanOrEqual(1);
      expect(live.scrollsSideways).toBe(false);
      expect(live.pageScroll).toBeLessThanOrEqual(1);
      // Both legible, and the live one exactly at the size it was authored.
      expect(live.minType).toBeGreaterThanOrEqual(12);
      expect(drawn.minType).toBeGreaterThanOrEqual(12);
    });
  }
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
