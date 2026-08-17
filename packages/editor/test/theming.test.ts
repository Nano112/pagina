/**
 * The editor is a second surface on the *same* token contract, not a second theme — and, since
 * the host-integration fix, on the same *reading* layer too.
 *
 * These assertions are what keeps that true: they fail the moment someone reintroduces an
 * editor-local colour, or lets the editor stop carrying the shell's tokens and reading layers,
 * or narrows the layer declaration back to the two layers the editor itself uses. That last one
 * is the subtle one: with only `@layer pagina.tokens, pagina.editor;`, a host that links
 * `editor.css` before `pagina.css` registers `pagina.editor` *ahead* of `pagina.reading`, and
 * the reading layer starts winning arguments the editor should win.
 *
 * The layer parser below is a deliberate copy of the one in `@pagina/shell-static`'s suite
 * (`test/css-layers.ts`) rather than an import: each package's `tsconfig` roots at its own
 * directory, and loosening that for one test helper would cost more than fifteen lines do. The
 * *contract* the two share is asserted directly.
 */
import { existsSync, readFileSync } from "node:fs";
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
/** The complete order every pagina sheet declares, `pagina.editor` last. */
const DECLARATION = "@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome, pagina.editor;";

describe("the editor stylesheet", () => {
  it("declares the whole pagina layer order first, so link order cannot change the cascade", () => {
    const first = (/^\s*([^{;]*[;{])/.exec(stripComments(themeCss))?.[1] ?? "").trim();
    expect(first).toBe(DECLARATION);
  });

  it("imports the shell's tokens and reading layers rather than restating them", () => {
    // Copying them was the old arrangement, and a test had to hold the copies byte-identical.
    // Importing is the arrangement that cannot drift at all — and it is what makes `editor.css`
    // self-sufficient: a host that links only the editor's sheet still gets a preview whose
    // `.pg-content` typography matches the published page.
    const imports = [...stripComments(themeCss).matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(imports).toEqual([
      "@pagina/shell-static/client/tokens.css",
      "@pagina/shell-static/client/reading.css",
    ]);
    // Bare specifiers, so they resolve for a published consumer too — and therefore a real
    // dependency, not a monorepo-only relative path.
    const pkg = JSON.parse(read("../package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@pagina/shell-static"]).toBeDefined();
    for (const spec of imports) {
      const rel = spec.replace("@pagina/shell-static/", "../../shell-static/");
      expect(existsSync(fileURLToPath(new URL(rel, import.meta.url))), spec).toBe(true);
    }
  });

  it("leaves no rule outside a layer", () => {
    // Everything outside the one top-level block must be the declaration and the two imports.
    const rest = stripComments(themeCss)
      .replace(/^@layer[^;]*;/m, "")
      .replace(/^@import[^;]*;$/gm, "")
      .replace(`@layer pagina.editor {${tool}}`, "");
    expect(rest.trim()).toBe("");
  });

  it("no longer keeps a second copy of the token defaults", () => {
    expect(() => layerBody(themeCss, "pagina.tokens")).toThrow();
    expect(tokensCss).toContain("--pg-accent");
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

  it("consumes only tokens the shell's contract defines, or ones it defines itself", () => {
    const contract = new Set(
      [...layerBody(tokensCss, "pagina.tokens").matchAll(/(?:^|[{;\s])(--pg-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
    );
    // `--pg-adm-*` is the admonition's *local* indirection — one block sets the three, every rule
    // in the block reads them, and `reading.css` does the identical thing for the published page.
    // It is not a second palette: each one resolves to a contract token or to another local.
    const local = new Set([...tool.matchAll(/(?:^|[{;\s])(--pg-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    for (const m of tool.matchAll(/var\((--pg-[a-z0-9-]+)/g)) {
      expect(contract.has(m[1]!) || local.has(m[1]!), `${m[1]} is used but not defined`).toBe(true);
    }
    for (const name of local) expect(name, "a local may only be an admonition indirection").toMatch(/^--pg-adm-/);
  });

  /**
   * The editor draws the *same* admonition the page publishes, from the same three tokens.
   *
   * The old node view was a grey bar with a browser `<select>` on it; nothing about it tracked
   * the kind but a border colour, and two of the seven kinds had no colour of their own at all.
   */
  it("draws every admonition kind from the shell's per-kind tokens", () => {
    for (const kind of ["note", "tip", "info", "warning", "danger", "example", "quote"]) {
      for (const suffix of ["", "-surface", "-fg"]) {
        expect(tool, `--pg-${kind}${suffix} reaches the editor`).toContain(`var(--pg-${kind}${suffix})`);
      }
    }
  });
});

/**
 * What a host actually links. The source is three files; `dist/editor.css` must be one, and must
 * establish the whole cascade on its own.
 *
 * Skipped without a build, because `npx vitest run` on a fresh clone has no `dist/`; the e2e
 * `bundle` project asserts the same thing in a browser, where it cannot be skipped.
 */
describe("the built editor.css", () => {
  const dist = fileURLToPath(new URL("../dist/editor.css", import.meta.url));
  const built = existsSync(dist) ? readFileSync(dist, "utf8") : undefined;

  it.skipIf(built === undefined)("carries the reading layer, in cascade order, with no import", () => {
    expect(built).not.toContain("@import");
    // Minified, so the leading declaration may be gone: lightningcss drops it when it can prove
    // the order by sorting the blocks instead, and reserves a bare `@layer x;` for the slots it
    // has no block for. Read the order the way the cascade reads it.
    const order: string[] = [];
    for (const m of built!.matchAll(/@layer\s+([a-z.,\s]+?)\s*[;{]/g)) {
      for (const name of m[1]!.split(",").map((s) => s.trim())) if (!order.includes(name)) order.push(name);
    }
    expect(order).toEqual(["pagina.reset", "pagina.tokens", "pagina.reading", "pagina.chrome", "pagina.editor"]);
    // The rule whose absence made an unstyled preview under a host reset.
    expect(built).toMatch(/\.pg-content h1\s*\{[^}]*font-size/);
    expect(built).toContain("--pg-accent");
  });
});
