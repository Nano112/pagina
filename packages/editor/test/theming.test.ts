/**
 * The editor is a second surface on the *same* token contract, not a second theme.
 *
 * These assertions are what keeps that true: they fail the moment someone reintroduces an
 * editor-local colour, or lets the editor's copy of the token defaults drift from the shell's.
 *
 * The layer parser below is a deliberate copy of the one in `@pagina/shell-static`'s suite
 * (`test/css-layers.ts`) rather than an import: each package's `tsconfig` roots at its own
 * directory, and loosening that for one test helper would cost more than fifteen lines do. The
 * *contract* the two share is asserted directly — `pagina.tokens` here must equal `pagina.tokens`
 * there, byte for byte.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Body of the `@layer <name> { … }` block, found by brace matching. */
function layerBody(css: string, name: string): string {
  const src = stripComments(css);
  const open = new RegExp(`@layer\\s+${name.replace(".", "\\.")}\\s*\\{`).exec(src);
  if (open === null) throw new Error(`no @layer ${name}`);
  let depth = 1;
  let i = open.index + open[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return src.slice(start, i - 1);
}

const themeCss = read("../src/ui/theme.css");
const tokensCss = read("../../shell-static/client/tokens.css");
const tool = layerBody(themeCss, "pagina.editor");

describe("the editor stylesheet", () => {
  it("declares its two layers first, tokens before tool", () => {
    const first = (/^\s*([^{;]*[;{])/.exec(stripComments(themeCss))?.[1] ?? "").trim();
    expect(first).toBe("@layer pagina.tokens, pagina.editor;");
  });

  it("leaves no rule outside a layer", () => {
    // Everything between the two top-level blocks must be whitespace: the declaration, the
    // tokens block, the editor block, nothing else.
    const rest = stripComments(themeCss)
      .replace(/^@layer[^;]*;/m, "")
      .replace(`@layer pagina.tokens {${layerBody(themeCss, "pagina.tokens")}}`, "")
      .replace(`@layer pagina.editor {${tool}}`, "");
    expect(rest.trim()).toBe("");
  });

  it("carries the shell's token defaults verbatim, so a bare host page still looks deliberate", () => {
    expect(layerBody(themeCss, "pagina.tokens")).toBe(layerBody(tokensCss, "pagina.tokens"));
  });

  it("keeps only genuinely tool-specific properties as --pge-*", () => {
    const defined = [...tool.matchAll(/(?:^|[{;\s])(--pge-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!);
    // The 8px grid and the two pane measurements. Anything else is a colour or a font, and those
    // belong to the shared `--pg-*` contract.
    expect([...new Set(defined)].sort()).toEqual(["--pge-1", "--pge-2", "--pge-sidebar", "--pge-split"]);
  });

  it("reads colour, type and radius straight from the contract, with no local fallbacks", () => {
    for (const name of ["--pg-bg", "--pg-fg", "--pg-line", "--pg-accent", "--pg-font", "--pg-font-mono", "--pg-radius"]) {
      expect(tool, `${name} is used`).toContain(`var(${name})`);
    }
    // A fallback here would be a second palette in disguise: the tokens layer above already
    // defines every one of them.
    expect(tool).not.toMatch(/var\(--pg-[a-z0-9-]+\s*,/);
    // Only shadows and scrims may name a colour literally.
    for (const m of tool.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
      expect(m[0], `literal colour ${m[0]}`).toMatch(/^rgba?\(0 0 0 \/ \d+%\)$/);
    }
  });

  it("defines every token it consumes", () => {
    const defined = new Set(
      [...layerBody(themeCss, "pagina.tokens").matchAll(/(?:^|[{;\s])(--pg-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    );
    for (const m of tool.matchAll(/var\((--pg-[a-z0-9-]+)/g)) {
      expect(defined.has(m[1]!), `${m[1]} is used but not defined`).toBe(true);
    }
  });
});
