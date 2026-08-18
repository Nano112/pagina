import { fileURLToPath } from "node:url";
import { kineglyphThemeHref, type RenderedArticle, type Shell, type ShellContext } from "@pagina/core";
import { renderPageHtml, type ShellCtx } from "./template.js";

export { DEFAULT_MODEL_VIEWER_URL, renderPageHtml, type ShellCtx } from "./template.js";
export { createHighlightedMarkdown } from "./highlight.js";

/** The default static-site shell: page template + default theme + client runtime. */
export const staticShell: Shell = {
  clientEntry: fileURLToPath(new URL("../client/pagina.ts", import.meta.url)),
  async render(article: RenderedArticle, ctx: ShellContext) {
    const kgThemeUrl = kineglyphThemeHref(article.manifest.article, ctx.base);
    // The manifest's own `site_url` is the fallback, so a folder that declares one is complete
    // without the builder having to be told again.
    const siteUrl = ctx.siteUrl ?? article.manifest.article.siteUrl;
    const full: ShellCtx = {
      ...ctx,
      ...(kgThemeUrl === undefined ? {} : { kineglyphThemeUrl: kgThemeUrl }),
      ...(ctx.kineglyphTheme === undefined ? {} : { kineglyphTheme: ctx.kineglyphTheme }),
      ...(siteUrl === undefined ? {} : { siteUrl }),
      ...(ctx.mirrorOf === undefined ? {} : { mirrorOf: ctx.mirrorOf }),
    };
    return Object.fromEntries(
      Object.keys(article.pages).map((href) => [
        href === "/" ? "index.html" : `${href.replace(/^\/|\/$/g, "")}/index.html`,
        renderPageHtml(article, href, full),
      ]),
    );
  },
};
