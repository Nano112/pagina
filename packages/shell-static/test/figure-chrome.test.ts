/**
 * @vitest-environment jsdom
 *
 * pagina's editorial default for a figure's chrome, and the compatibility it rests on.
 *
 * The behaviour under test is a *change*: figures that said nothing used to get a readout and a
 * transport and now get neither. That makes the interesting cases the ones that must NOT change —
 * every figure already authored with an explicit `data-controls`/`data-readout` — so those get as
 * much coverage here as the new default does.
 */
import { describe, expect, it } from "vitest";
import { figureChrome } from "../client/figure-chrome.js";

const figure = (attrs: Record<string, string> = {}): HTMLElement => {
  const el = document.createElement("figure");
  el.className = "kg";
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
};

describe("a figure that asks for nothing", () => {
  it("is a picture: no readout, no transport", () => {
    expect(figureChrome(figure())).toEqual({ controls: false, readout: false });
  });

  it("is quiet whatever else it carries", () => {
    const el = figure({ "data-scene": "/scenes/demo.mjs", id: "kg-guide-1", "data-theme": "dark" });
    expect(figureChrome(el)).toEqual({ controls: false, readout: false });
  });
});

describe('a figure that opts in with data-instrument="true"', () => {
  it("defers to the scene rather than forcing chrome on", () => {
    // `"auto"`, not `true`: opting in asks Kineglyph to show what the scene justifies. A still
    // diagram marked as an instrument still gets no transport — that half of the rule is the
    // library's, and this is the assertion that pagina hands the decision over rather than
    // pre-empting it.
    expect(figureChrome(figure({ "data-instrument": "true" }))).toEqual({
      controls: "auto",
      readout: "auto",
    });
  });

  it("treats any other value as not opting in", () => {
    for (const value of ["false", "", "1", "yes", "TRUE"])
      expect(figureChrome(figure({ "data-instrument": value }))).toEqual({
        controls: false,
        readout: false,
      });
  });
});

describe("a figure that was explicit stays exactly as it was", () => {
  it("declines to have an opinion about a key the author already wrote", () => {
    // An absent key is pagina *not answering*, which leaves Kineglyph's own `data-controls`
    // parsing standing. Returning `false` here instead would silently overwrite the author.
    expect(figureChrome(figure({ "data-controls": "false", "data-readout": "false" }))).toEqual({});
    expect(figureChrome(figure({ "data-controls": "true", "data-readout": "true" }))).toEqual({});
  });

  it("answers only the half that was left open", () => {
    expect(figureChrome(figure({ "data-controls": "true" }))).toEqual({ readout: false });
    expect(figureChrome(figure({ "data-readout": "false" }))).toEqual({ controls: false });
  });

  it("lets an explicit attribute win over data-instrument", () => {
    const el = figure({ "data-instrument": "true", "data-controls": "false" });
    expect(figureChrome(el)).toEqual({ readout: "auto" });
  });
});
