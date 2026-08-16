import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArticleConfig } from "@pagina/core";
import { loadKineglyphThemes } from "../src/index.js";

describe("loadKineglyphThemes", () => {
  it("resolves the bare \"kineglyph\" specifier in an article's theme module", async () => {
    const folder = await mkdtemp(join(tmpdir(), "pagina-theme-"));
    await mkdir(join(folder, "theme"), { recursive: true });
    await writeFile(
      join(folder, "theme/t.mjs"),
      `import { defaultTheme } from "kineglyph";\n` +
        `export const light = { ...defaultTheme };\n` +
        `export const dark = { ...defaultTheme };\n`,
    );
    const config = { kineglyph: { theme: "theme/t.mjs" } } as unknown as ArticleConfig;

    // Before the fix this threw ERR_MODULE_NOT_FOUND: the theme loader did a plain Node
    // `import()` with no specifier rewriting, unlike scene figures (which go through
    // `@kineglyph/export`'s `prerender()`).
    const themes = await loadKineglyphThemes(folder, config);

    expect(themes.light).toBeTypeOf("object");
    expect(themes.dark).toBeTypeOf("object");
    expect(themes.light).not.toBeNull();
    expect(themes.dark).not.toBeNull();
  });
});
