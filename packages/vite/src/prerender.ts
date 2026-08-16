import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultTheme, type ThemeTokens } from "@kineglyph/core";
import { prerender } from "@kineglyph/export";
import type { ArticleConfig, RenderedArticle } from "@pagina/core";

export interface KineglyphThemes { readonly light: ThemeTokens; readonly dark: ThemeTokens }

/**
 * Loads the `{ light, dark }` token pair named by `article.yaml`'s `kineglyph.theme`
 * (a module path relative to the folder). Falls back to Kineglyph's default theme.
 */
export async function loadKineglyphThemes(folder: string, config: ArticleConfig): Promise<KineglyphThemes> {
  const rel = config.kineglyph?.theme;
  if (rel === undefined) return { light: defaultTheme, dark: defaultTheme };
  const url = `${pathToFileURL(resolve(folder, rel)).href}?t=${Date.now()}`;
  const mod = (await import(url)) as { default?: Partial<KineglyphThemes>; light?: ThemeTokens; dark?: ThemeTokens };
  const light = mod.light ?? mod.default?.light ?? defaultTheme;
  const dark = mod.dark ?? mod.default?.dark ?? light;
  return { light, dark };
}

/** Site-absolute URL (which includes `base`) → folder-relative path. */
function toFolderRelative(url: string, base: string): string {
  return (url.startsWith(base) ? url.slice(base.length) : url).replace(/^\/+/, "");
}

/**
 * Pre-renders every inline and module figure of an article to one SVG per theme.
 * Static figures are skipped. Keyed by figure id.
 */
export async function prerenderFigures(
  article: RenderedArticle,
  folder: string,
  themes: KineglyphThemes,
  width = 960,
  base = "/",
): Promise<Map<string, { theme: string; svg: string }[]>> {
  const out = new Map<string, { theme: string; svg: string }[]>();
  const themeList = [{ name: "light", tokens: themes.light }, { name: "dark", tokens: themes.dark }];
  for (const page of Object.values(article.pages)) {
    for (const fig of page.figures) {
      if (fig.kind === "static") continue;
      let source: string;
      let baseUrl: string;
      if (fig.kind === "inline") {
        source = fig.source ?? "";
        baseUrl = pathToFileURL(resolve(folder, page.path)).href;
      } else {
        const abs = resolve(folder, toFolderRelative(fig.scene ?? "", base));
        source = await readFile(abs, "utf8");
        baseUrl = pathToFileURL(abs).href;
      }
      const results = await prerender(source, { themes: themeList, width, baseUrl, idPrefix: fig.id });
      out.set(fig.id, results.map((r) => ({ theme: r.theme, svg: r.svg })));
    }
  }
  return out;
}
