import { describe, expect, it } from "vitest";
import { extractFigures, inlineFigureSvgs } from "../src/figures.js";
const opts = { pageSlug: "guide-figures" };
describe("extractFigures", () => {
  it("classifies inline, module and static figures and leaves a frame for each live one", () => {
    const html = `<figure class="kg" data-scene="/scenes/demo.mjs"></figure>
<figure class="kg" id="inline-demo"><script type="text/kineglyph">export default 1</script></figure>
<figure class="kg" data-static="/media/s.svg"><img src="/media/s.svg" alt="static"></figure>`;
    const r = extractFigures(html, opts);
    expect(r.figures).toEqual([
      { id: "kg-guide-figures-1", kind: "module", scene: "/scenes/demo.mjs" },
      { id: "inline-demo", kind: "inline", source: "export default 1" },
      { id: "kg-guide-figures-3", kind: "static", static: "/media/s.svg" },
    ]);
    expect(r.html).toContain(`<figure class="kg" data-scene="/scenes/demo.mjs" id="kg-guide-figures-1"><div class="kg-frame" data-kg-static data-kg-frame="kg-guide-figures-1"></div></figure>`);
    expect(r.html).toContain(`<script type="text/kineglyph">export default 1</script>`); // inline kept for the runtime
    expect(r.html).toContain(`<img src="/media/s.svg" alt="static">`);           // static untouched
  });

  it("rejects an unusable author-supplied id, falling back to the generated one", () => {
    const html = `<figure class="kg" id="../../evil" data-scene="/scenes/demo.mjs"></figure>`;
    const r = extractFigures(html, opts);
    expect(r.figures).toEqual([{ id: "kg-guide-figures-1", kind: "module", scene: "/scenes/demo.mjs" }]);
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([["warning", "figure-id-invalid"]]);
    expect(r.html).toContain(`id="kg-guide-figures-1"`);
    expect(r.html).not.toContain("../../evil");
  });

  it("does not treat class tokens that merely contain \"kg\" as the kg marker", () => {
    const html = `<figure class="kg-static"><img src="x.svg"></figure><figure class="not-kg"><img src="y.svg"></figure>`;
    const r = extractFigures(html, opts);
    expect(r.figures).toEqual([]);
    expect(r.html).toBe(html);
  });
});

describe("inlineFigureSvgs", () => {
  const svg = (desc = "<desc>What it shows</desc>") =>
    `<svg viewBox="0 0 960 240" role="img"><title>A</title>${desc}</svg>`;
  const framed = (): string =>
    extractFigures(`<figure class="kg" id="f" data-scene="/s.mjs"></figure>`, opts).html;

  it("puts the SVG in the page rather than a link to it", () => {
    const { html } = inlineFigureSvgs(framed(), () => svg());

    // Inline, so the host's CSS and the accessibility tree both reach it — neither crosses the
    // document boundary an `<img>` would put in the way.
    expect(html).toContain(`<div class="kg-frame" data-kg-static data-kg-frame="f">${svg()}</div>`);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('alt=""');
  });

  it("carries the figure's natural size on the figure, where both the frame and the stage see it", () => {
    // The live stage is the frame's *sibling*, so a shared ancestor is the only place a custom
    // property reaches both — and it has to be there before any script runs, or hydration shifts
    // the page.
    expect(inlineFigureSvgs(framed(), () => svg()).html).toContain(
      `<figure class="kg" id="f" data-scene="/s.mjs" style="--kg-w:960;--kg-h:240">`,
    );
  });

  it("keeps a style the author already wrote", () => {
    const authored = extractFigures(
      `<figure class="kg" id="f" data-scene="/s.mjs" style="margin-top:0"></figure>`,
      opts,
    ).html;

    expect(inlineFigureSvgs(authored, () => svg()).html).toContain(
      `style="--kg-w:960;--kg-h:240;margin-top:0"`,
    );
  });

  it("reports a figure with no description instead of shipping a silent one", () => {
    const { diagnostics } = inlineFigureSvgs(framed(), () => svg(""), "guide/figures.md");

    expect(diagnostics.map((d) => [d.severity, d.code, d.page])).toEqual([
      ["warning", "figure-no-description", "guide/figures.md"],
    ]);
    expect(inlineFigureSvgs(framed(), () => svg()).diagnostics).toEqual([]);
  });

  it("leaves the frame empty when the figure did not render", () => {
    // A diagram that failed to pre-render still hydrates client-side; an empty frame is the
    // thing it hydrates into.
    const { html } = inlineFigureSvgs(framed(), () => undefined);

    expect(html).toContain(`<div class="kg-frame" data-kg-static data-kg-frame="f"></div>`);
  });

  it("marks a figure the live runtime could add nothing to", () => {
    // Settled at publish time so the page never has to fetch a scene module to learn it.
    const { html } = inlineFigureSvgs(framed(), () => ({ svg: svg(), needsRuntime: false }));

    expect(html).toContain(
      `<figure class="kg" id="f" data-scene="/s.mjs" data-kg-inert="true" style="--kg-w:960;--kg-h:240">`,
    );
  });

  it("does not mark a figure that has something to drive, or one that said nothing", () => {
    expect(inlineFigureSvgs(framed(), () => ({ svg: svg(), needsRuntime: true })).html).not.toContain(
      "data-kg-inert",
    );
    // A bare string is the old signature: no opinion, so no mark and no behaviour change.
    expect(inlineFigureSvgs(framed(), () => svg()).html).not.toContain("data-kg-inert");
  });

  describe("variants", () => {
    const at = (w: number, h: number): string =>
      `<svg viewBox="0 0 ${w} ${h}" role="img" style="--kg-accent:red"><title>A</title><desc>D</desc></svg>`;
    const three = {
      svg: at(960, 240),
      needsRuntime: false,
      variants: [
        { containerWidth: 960, svg: at(960, 240) },
        { containerWidth: 600, svg: at(600, 380) },
        { containerWidth: 320, svg: at(320, 700) },
      ],
    };

    it("inlines every drawing, widest first, each tagged with the width it was measured for", () => {
      const { html } = inlineFigureSvgs(framed(), () => three);
      expect([...html.matchAll(/<svg[^>]*data-kg-variant="(\d+)"/g)].map((m) => m[1])).toEqual([
        "960",
        "600",
        "320",
      ]);
      // Widest first is what makes the no-container-query fallback correct: `:first-of-type` is
      // the drawing such a browser is left with. Measured inside the frame, because the generated
      // stylesheet names the same widths ahead of it.
      const frame = /<div class="kg-frame".*?<\/div>/s.exec(html)?.[0] ?? "";
      expect(frame.indexOf('data-kg-variant="960"')).toBeLessThan(frame.indexOf('data-kg-variant="320"'));
    });

    it("gives each drawing its own geometry, merged into the style it already had", () => {
      const { html } = inlineFigureSvgs(framed(), () => three);
      // Merged, not appended: two `style` attributes on one tag is one attribute and a silent loss
      // of the theme's palette. And the floor is a fraction of *this* drawing's width, so the
      // 320px drawing must not inherit the 960px one's.
      expect(html).toContain(`style="--kg-w:320;--kg-h:700;--kg-accent:red" data-kg-variant="320"`);
      expect(html).toContain(`style="--kg-w:960;--kg-h:240;--kg-accent:red" data-kg-variant="960"`);
      for (const tag of html.match(/<svg[^>]*>/g) ?? [])
        expect((tag.match(/style="/g) ?? []).length).toBeLessThan(2);
    });

    it("marks the figure and emits the queries that pick exactly one", () => {
      const { html } = inlineFigureSvgs(framed(), () => three);
      expect(html).toContain(`data-kg-variants="3"`);
      // Narrowest first and claiming everything down to zero, so the last query that matches is
      // the widest drawing that fits and a container below them all still gets the smallest.
      expect(html).toContain("@container kg-frame (min-width:0px)");
      expect(html).toContain(`.kg-frame>svg[data-kg-variant="320"]{display:block}`);
      expect(html).toContain("@container kg-frame (min-width:600px)");
      expect(html).toContain("@container kg-frame (min-width:960px)");
      expect(html).not.toContain("(min-width:320px)");
      expect(html).toContain("@supports (container-type:inline-size)");
      expect(html.indexOf("min-width:0px")).toBeLessThan(html.indexOf("min-width:960px"));
    });

    it("keeps the figure's own size at the widest drawing's", () => {
      // Read by the empty stage's reservation and by the mount width, both of which are about the
      // picture before CSS has chosen one.
      expect(inlineFigureSvgs(framed(), () => three).html).toContain(`style="--kg-w:960;--kg-h:240"`);
    });

    it("changes nothing at all for a figure with one drawing", () => {
      const one = { svg: at(960, 240), needsRuntime: false, variants: [{ containerWidth: 960, svg: at(960, 240) }] };
      const plain = inlineFigureSvgs(framed(), () => ({ svg: at(960, 240), needsRuntime: false }));
      expect(inlineFigureSvgs(framed(), () => one).html).toBe(plain.html);
      expect(plain.html).not.toContain("data-kg-variant");
      expect(plain.html).not.toContain("<style>");
    });
  });
});
