/**
 * @vitest-environment jsdom
 *
 * The theming contract (`docs/theming.md`): the cascade layers, the token list, and the promise
 * that a host's plain rule beats pagina's.
 *
 * jsdom 29 implements cascade layers properly — the "layered loses to unlayered" case below is
 * checked against a control that proves jsdom is really running the cascade (a *more* specific
 * layered rule still loses to a *less* specific unlayered one, while the same pair unlayered
 * goes the other way). If that control ever stops holding, the assertion under it is worthless
 * and the failure will say so.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAGINA_LAYERS, PAGINA_LAYER_DECLARATION, declaredLayers, definedTokens, effectiveLayerOrder,
  filePath, layerBody, outsideLayers, read, stripComments,
} from "./css-layers.js";

const paginaCss = read("../client/pagina.css");
const tokensCss = read("../client/tokens.css");
const readingCss = read("../client/reading.css");
const docs = read("../../../docs/theming.md");
/** The three source files, in the order `pagina.css` composes them. */
const sheets = { "pagina.css": paginaCss, "tokens.css": tokensCss, "reading.css": readingCss };

/** Injects a stylesheet, with `@import` removed: jsdom does not fetch them. */
function style(css: string): void {
  const el = document.createElement("style");
  el.textContent = css.replace(/^@import[^;]*;$/gm, "");
  document.head.append(el);
}

describe("cascade layers", () => {
  it("declares the same five layers, first, in every sheet", () => {
    // The declaration fixes the order; a layer first *used* later would sort itself after the
    // ones named here, so this line has to come before any rule. Repeating the *complete* order
    // in every sheet is what makes a host's link order irrelevant: whichever pagina sheet lands
    // first, `pagina.editor` ends up last and `pagina.reading` ends up third.
    for (const [name, css] of Object.entries(sheets)) {
      expect(declaredLayers(css), name).toEqual([...PAGINA_LAYERS]);
      expect(firstLine(css), name).toBe(PAGINA_LAYER_DECLARATION);
    }
  });

  it("leaves no rule outside a layer", () => {
    for (const [name, css] of Object.entries(sheets)) {
      const stray = outsideLayers(css)
        .replace(/^@layer[^;]*;$/gm, "")
        .replace(/^@import[^;]*;$/gm, "")
        .trim();
      expect(stray, name).toBe("");
    }
  });

  it("puts each rule in the layer that owns it", () => {
    const reading = layerBody(readingCss, "pagina.reading")!;
    const chrome = layerBody(paginaCss, "pagina.chrome")!;
    for (const sel of [".pg-content", ".pg-admonition", ".pg-tabs", ".pg-copy", "figure.kg", ".shiki"]) {
      expect(reading, `${sel} belongs to the reading layer`).toContain(sel);
      expect(chrome, `${sel} does not belong to the chrome layer`).not.toContain(sel);
    }
    for (const sel of [".pg-header", ".pg-shell", ".pg-nav", ".pg-toc", ".pg-pager", ".pg-theme-toggle"]) {
      expect(chrome, `${sel} belongs to the chrome layer`).toContain(sel);
      expect(reading, `${sel} does not belong to the reading layer`).not.toContain(sel);
    }
    // Reset is box-sizing and body basics only.
    expect(layerBody(tokensCss, "pagina.reset")!).toContain("box-sizing");
    expect(layerBody(tokensCss, "pagina.reset")!).toContain("body");
  });
});

/**
 * The artefacts a host links, as opposed to the sources we edit.
 *
 * `client/*.css` is three files held together by `@import`; `dist/*.css` is what ships. The
 * difference is not cosmetic: an imported sheet has no URL of its own for a host's cache-busting
 * to stamp, so a tokens-only edit would leave the importing sheet's hash unchanged and every
 * browser would keep the stale tokens. These assertions are the reason a host may cache-bust by
 * content and stop there.
 */
describe("the built stylesheets", () => {
  it("inline every import, keep the layer order, and name what the docs tell hosts to link", async () => {
    const dist = await mkdtemp(join(tmpdir(), "pagina-shell-css-"));
    // The build step itself, run the way `npm run build` runs it.
    execFileSync(process.execPath, [filePath("../scripts/build-css.mjs"), dist]);
    const written = ["pagina.css", "pagina.tokens.css", "pagina.reading.css"];

    const built = Object.fromEntries(
      await Promise.all(written.map(async (f) => [f, await readFile(join(dist, f), "utf8")] as const)),
    ) as Record<string, string>;

    for (const [name, css] of Object.entries(built)) {
      // One file, one request, one hash.
      expect(stripComments(css), `${name} still imports`).not.toContain("@import");
      // Exactly one declaration survives the inlining, and it is still the first statement.
      expect(firstLine(css), name).toBe(PAGINA_LAYER_DECLARATION);
      expect(stripComments(css).match(/@layer\s+pagina\.[a-z]+\s*,/g), `${name} declarations`).toHaveLength(1);
    }

    // The full sheet really is the sum of the parts, in cascade order.
    expect(effectiveLayerOrder(built["pagina.css"]!)).toEqual([...PAGINA_LAYERS]);
    for (const layer of ["pagina.reset", "pagina.tokens", "pagina.reading", "pagina.chrome"]) {
      expect(layerBody(built["pagina.css"]!, layer), `${layer} block`).toBeDefined();
    }
    // …and the two partial sheets carry exactly their own layers.
    expect(layerBody(built["pagina.tokens.css"]!, "pagina.reading")).toBeUndefined();
    expect(layerBody(built["pagina.reading.css"]!, "pagina.chrome")).toBeUndefined();
    expect(built["pagina.tokens.css"]).toContain("--pg-accent");
    expect(built["pagina.reading.css"]).toContain(".pg-content h1");
  });

  it("is what `docs/theming.md` tells a host to link", () => {
    // The names are a published surface; a rename that misses the docs is the defect this catches.
    for (const name of ["pagina.css", "pagina.tokens.css"]) expect(docs).toContain(name);
  });
});

describe("an unlayered host rule", () => {
  it("beats pagina's, at lower specificity, with no !important", () => {
    style(tokensCss);
    style(readingCss);
    style(paginaCss);
    style(`.pg-content h2 { color: rgb(1, 2, 3); }`);
    document.body.innerHTML = `<article class="pg-content"><h2 id="h">Heading</h2></article>`;
    expect(getComputedStyle(document.getElementById("h")!).color).toBe("rgb(1, 2, 3)");
  });

  it("(control) the same pair without layers goes the other way", () => {
    // Proof that jsdom is running the real cascade rather than just taking the last rule: here
    // the *more specific* first rule wins, which is exactly what the layer inverts above.
    document.head.innerHTML = "";
    style(`article.pg-content h2 { color: rgb(9, 9, 9); }`);
    style(`.pg-content h2 { color: rgb(1, 2, 3); }`);
    document.body.innerHTML = `<article class="pg-content"><h2 id="h">Heading</h2></article>`;
    expect(getComputedStyle(document.getElementById("h")!).color).toBe("rgb(9, 9, 9)");
  });

  it("also wins over a *more* specific pagina rule", () => {
    document.head.innerHTML = "";
    style(`@layer pagina.chrome;@layer pagina.chrome { article.pg-content h2 { color: rgb(9, 9, 9); } }`);
    style(`.pg-content h2 { color: rgb(1, 2, 3); }`);
    document.body.innerHTML = `<article class="pg-content"><h2 id="h">Heading</h2></article>`;
    expect(getComputedStyle(document.getElementById("h")!).color).toBe("rgb(1, 2, 3)");
  });
});

describe("the token contract", () => {
  const light = definedTokens(layerBody(tokensCss, "pagina.tokens")!.split('[data-theme="dark"]')[0]!);
  /** Token names the documented table in `docs/theming.md` publishes. */
  const documented = [...docs.matchAll(/^\| `(--pg-[a-z0-9-]+)` \| ([^|]+)\|/gm)]
    .map((m) => ({ name: m[1]!, def: m[2]!.trim() }));

  it("documents a non-trivial number of tokens", () => {
    expect(documented.length).toBeGreaterThan(15);
  });

  it("defines every documented token in the tokens layer, at the documented default", () => {
    for (const { name, def } of documented) {
      expect(light.has(name), `${name} is documented but never defined`).toBe(true);
      const literal = /^`([^`]+)`$/.exec(def)?.[1];
      if (literal !== undefined) expect(light.get(name), `${name} default`).toBe(literal);
    }
  });

  it("documents every token it defines", () => {
    const names = documented.map((d) => d.name);
    for (const name of light.keys()) {
      expect(names, `${name} is defined but undocumented`).toContain(name);
    }
  });

  /**
   * Figures are the one place pagina publishes a vocabulary it does not own: `--kg-color-*` is
   * Kineglyph's, and `tokens.css` only maps `--pg-*` onto it. The mapping is what makes a host
   * that themed pagina find its diagrams themed too, so it is worth the same drift guard the
   * `--pg-*` table gets — in both directions.
   */
  const kgDefined = [...stripComments(tokensCss).matchAll(/(--kg-color-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
  const kgDocumented = [...docs.matchAll(/^\| `(--kg-color-[a-z0-9-]+)`[^|]*\|/gm)].map((m) => m[1]!);

  it("maps and documents the same set of figure colour roles", () => {
    expect(kgDefined.length).toBeGreaterThan(15);
    for (const name of kgDefined) {
      // `chart1 … chart6` are documented as one row, so allow the range row to stand for them.
      const documented = kgDocumented.includes(name) || (/^--kg-color-chart[1-6]$/.test(name) && kgDocumented.includes("--kg-color-chart1"));
      expect(documented, `${name} is mapped but undocumented`).toBe(true);
    }
    for (const name of kgDocumented) expect(kgDefined, `${name} is documented but never mapped`).toContain(name);
  });

  it("maps every figure role onto a token rather than a literal", () => {
    // A literal here would be a second palette to keep in step with the first, and it would not
    // follow `[data-theme="dark"]` — which is the whole reason the mapping exists.
    for (const m of stripComments(tokensCss).matchAll(/--kg-color-[a-z0-9-]+\s*:\s*([^;]+);/g))
      expect(m[1]!.trim(), m[0]).toMatch(/^var\(--pg-[a-z0-9-]+\)$/);
  });

  it("leaves type and geometry out of the figure contract", () => {
    // Geometry is decided when a figure is rendered — its text is measured once and frozen with
    // `textLength` — so offering a host a font or a radius here would break the picture.
    expect(stripComments(tokensCss)).not.toMatch(/--kg-(font|radius)/);
  });

  it("uses tokens rather than literals for colour, type and radius", () => {
    const rules = [layerBody(readingCss, "pagina.reading")!, layerBody(paginaCss, "pagina.chrome")!].join("\n");
    // Shadows and the pill toggle are geometry, not palette; nothing here may name a colour.
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(/);
    expect(rules).not.toMatch(/font-family:(?!\s*var\()/);
  });

  /**
   * The seven admonition kinds, three tokens each, light *and* dark.
   *
   * Before this there were four hues for seven kinds — `info` borrowed `note`'s and `example`
   * borrowed `tip`'s — and no ground or ink of their own at all, so a host could not retint a
   * callout without overriding a rule, which is the one thing the contract promises it never has
   * to do. The reading layer must reach every one of them, or the token is decorative.
   */
  it("gives every admonition kind a hue, a surface and an ink, in both schemes", () => {
    const dark = definedTokens(`[data-theme="dark"]${layerBody(tokensCss, "pagina.tokens")!.split('[data-theme="dark"]')[1]!}`);
    const rules = layerBody(readingCss, "pagina.reading")!;
    const documented = new Set(docs.match(/`--pg-[a-z0-9-]+`/g)?.map((s) => s.slice(1, -1)) ?? []);
    for (const kind of ["note", "tip", "info", "warning", "danger", "example", "quote"]) {
      for (const name of [`--pg-${kind}`, `--pg-${kind}-surface`, `--pg-${kind}-fg`]) {
        expect(light.has(name), `${name} has a light default`).toBe(true);
        expect(dark.has(name), `${name} has a dark default`).toBe(true);
        expect(documented.has(name), `${name} is in the theming table`).toBe(true);
        expect(rules, `${name} is actually drawn with`).toContain(`var(${name})`);
      }
    }
  });

  it("defines the same tokens for dark as for light, colours only", () => {
    const dark = definedTokens(`[data-theme="dark"]${layerBody(tokensCss, "pagina.tokens")!.split('[data-theme="dark"]')[1]!}`);
    for (const name of dark.keys()) expect(light.has(name)).toBe(true);
    // Geometry, type and measure are scheme-independent and must not be restated.
    for (const name of ["--pg-radius", "--pg-radius-lg", "--pg-font", "--pg-font-mono", "--pg-font-display", "--pg-measure"]) {
      expect(dark.has(name), `${name} must not be redefined for dark`).toBe(false);
    }
  });
});

/** First non-comment, non-blank line. */
function firstLine(css: string): string {
  return stripComments(css).split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
}
