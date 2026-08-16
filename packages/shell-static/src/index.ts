import { fileURLToPath } from "node:url";
import type { RenderedArticle, Shell, ShellContext } from "@pagina/core";
import { renderPageHtml, type ShellCtx } from "./template.js";

export { renderPageHtml, type ShellCtx } from "./template.js";
export { createHighlightedMarkdown } from "./highlight.js";

/** The default static-site shell: page template + default theme + client runtime. */
export const staticShell: Shell = {
  clientEntry: fileURLToPath(new URL("../client/pagina.ts", import.meta.url)),
  async render(article: RenderedArticle, ctx: ShellContext) {
    const kgTheme = article.manifest.article.kineglyph?.theme;
    const full: ShellCtx = { ...ctx, ...(kgTheme === undefined ? {} : { kineglyphThemeUrl: `${ctx.base.replace(/\/$/, "")}/${kgTheme}` }) };
    return Object.fromEntries(
      Object.keys(article.pages).map((href) => [
        href === "/" ? "index.html" : `${href.replace(/^\/|\/$/g, "")}/index.html`,
        renderPageHtml(article, href, full),
      ]),
    );
  },
};
