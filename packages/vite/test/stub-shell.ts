import type { Shell } from "../src/index.js";

/** A minimal shell: enough of a page to assert the import map and the rendered article HTML. */
export const stubShell: Shell = {
  clientEntry: new URL("./stub-client.ts", import.meta.url).pathname,
  render: async (article, ctx) =>
    Object.fromEntries(
      Object.values(article.pages).map((p) => [
        p.href === "/" ? "index.html" : `${p.href.replace(/^\/|\/$/g, "")}/index.html`,
        `<!doctype html><script type="importmap">{"imports":{"kineglyph":"${ctx.kineglyphRuntimeUrl}"}}</script>${p.html}`,
      ]),
    ),
};
