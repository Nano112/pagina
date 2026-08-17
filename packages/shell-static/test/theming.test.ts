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
import { describe, expect, it } from "vitest";
import {
  PAGINA_LAYERS, declaredLayers, definedTokens, layerBody, outsideLayers, read, stripComments,
} from "./css-layers.js";

const paginaCss = read("../client/pagina.css");
const tokensCss = read("../client/tokens.css");
const docs = read("../../../docs/theming.md");

/** Injects a stylesheet, with `@import` removed: jsdom does not fetch them. */
function style(css: string): void {
  const el = document.createElement("style");
  el.textContent = css.replace(/^@import[^;]*;$/gm, "");
  document.head.append(el);
}

describe("cascade layers", () => {
  it("declares exactly the four designed layers, as the first statement of the sheet", () => {
    // The declaration fixes the order; a layer first *used* later would sort itself after the
    // ones named here, so this line has to come before any rule.
    expect(declaredLayers(paginaCss)).toEqual([...PAGINA_LAYERS]);
    expect(firstLine(paginaCss)).toBe("@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome;");
    // The tokens-only sheet declares the same four, so linking it alone still fixes the order.
    expect(declaredLayers(tokensCss)).toEqual([...PAGINA_LAYERS]);
  });

  it("leaves no rule outside a layer", () => {
    const stray = outsideLayers(paginaCss)
      .replace(/^@layer[^;]*;$/gm, "")
      .replace(/^@import[^;]*;$/gm, "")
      .trim();
    expect(stray).toBe("");
    expect(outsideLayers(tokensCss).replace(/^@layer[^;]*;$/gm, "").trim()).toBe("");
  });

  it("puts each rule in the layer that owns it", () => {
    const reading = layerBody(paginaCss, "pagina.reading")!;
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

describe("an unlayered host rule", () => {
  it("beats pagina's, at lower specificity, with no !important", () => {
    style(tokensCss);
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

  it("uses tokens rather than literals for colour, type and radius", () => {
    const rules = [layerBody(paginaCss, "pagina.reading")!, layerBody(paginaCss, "pagina.chrome")!].join("\n");
    // Shadows and the pill toggle are geometry, not palette; nothing here may name a colour.
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(/);
    expect(rules).not.toMatch(/font-family:(?!\s*var\()/);
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
