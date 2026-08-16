import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type MarkdownIt from "markdown-it";
import { build as viteBuild } from "vite";
import { parseArticleConfig, renderArticle, type Diagnostic, type RenderedArticle } from "@pagina/core";
import { NodeContentFs } from "./node-fs.js";
import { resolveKineglyphBundle } from "./kineglyph.js";
import { loadKineglyphThemes, prerenderFigures } from "./prerender.js";

/** Context a shell gets for one render pass. All URLs are site URLs (they include `base`). */
export interface ShellContext {
  readonly base: string;
  readonly kineglyphRuntimeUrl: string;
  readonly clientUrl: string;
  readonly cssUrl: string;
  readonly dev: boolean;
}
/** A page shell: turns a rendered article into files (`out path` → contents). */
export interface Shell {
  readonly clientEntry: string;
  render(article: RenderedArticle, ctx: ShellContext): Promise<Record<string, string | Uint8Array>>;
}
export interface BuildOptions {
  readonly folder: string;
  readonly outDir: string;
  readonly base?: string;
  readonly strict?: boolean;
  readonly shell: Shell;
  readonly md?: MarkdownIt;
}

async function write(outDir: string, rel: string, data: string | Uint8Array): Promise<void> {
  const f = join(outDir, rel);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, data);
}

/** Site-absolute URL (which includes `base`) → path relative to `outDir`. */
function stripBase(url: string, base: string): string {
  const b = base.replace(/\/$/, "");
  return (b !== "" && url.startsWith(b) ? url.slice(b.length) : url).replace(/^\/+/, "");
}

const KINEGLYPH_ENTRY = "_pagina/.kineglyph-entry.ts";

/** Bundles the client + a kineglyph runtime entry into `_pagina/`. Returns their site URLs. */
export async function bundleClient(
  outDir: string,
  base: string,
  clientEntry: string,
): Promise<{ clientUrl: string; cssUrl: string; kineglyphRuntimeUrl: string }> {
  const tmpEntry = join(outDir, KINEGLYPH_ENTRY);
  await write(outDir, KINEGLYPH_ENTRY, `export * from "@kineglyph/web/bundle";\n`);
  try {
    await viteBuild({
      logLevel: "warn",
      configFile: false,
      root: dirname(clientEntry),
      build: {
        outDir: join(outDir, "_pagina"),
        emptyOutDir: false,
        cssCodeSplit: false,
        lib: { entry: { pagina: clientEntry, kineglyph: tmpEntry }, formats: ["es"], fileName: (_f, name) => `${name}.js` },
        rollupOptions: { external: [], output: { assetFileNames: "pagina.[ext]" } },
      },
      // The kineglyph entry lives in `outDir`, outside any node_modules tree, so the bare
      // specifier has to be aliased rather than resolved from the importer's directory.
      resolve: { conditions: ["production"], alias: { "@kineglyph/web/bundle": resolveKineglyphBundle("import") } },
    });
  } finally {
    await rm(tmpEntry, { force: true });
  }
  const b = base.replace(/\/$/, "");
  return { clientUrl: `${b}/_pagina/pagina.js`, cssUrl: `${b}/_pagina/pagina.css`, kineglyphRuntimeUrl: `${b}/_pagina/kineglyph.js` };
}

/**
 * Renders an article folder into a static site under `outDir`, which is the directory
 * served at `base`: page HTML at `<href>index.html`, assets 1:1, pre-rendered figures at
 * `_pagina/figures/<page-slug>/<id>.<theme>.svg`, the manifest and the client bundle in
 * `_pagina/`.
 */
export async function buildStatic(o: BuildOptions): Promise<{ files: string[]; diagnostics: Diagnostic[] }> {
  const base = o.base ?? "/";
  const fs = new NodeContentFs(o.folder);
  const article = await renderArticle({ fs, strict: o.strict ?? true, base, ...(o.md === undefined ? {} : { md: o.md }) });
  await mkdir(o.outDir, { recursive: true });
  const files: string[] = [];

  const config = parseArticleConfig(await fs.read("article.yaml"));
  const themes = await loadKineglyphThemes(o.folder, config);
  const figures = await prerenderFigures(article, o.folder, themes, config.kineglyph?.width, base);
  for (const [id, results] of figures) {
    const meta = article.manifest.figures[id];
    if (meta === undefined) continue;
    for (const r of results) {
      const rel = `${stripBase(meta.staticBase, base)}.${r.theme}.svg`;
      await write(o.outDir, rel, r.svg);
      files.push(rel);
    }
  }
  for (const asset of article.manifest.assets) {
    await mkdir(dirname(join(o.outDir, asset)), { recursive: true });
    await cp(resolve(o.folder, asset), join(o.outDir, asset));
    files.push(asset);
  }
  const urls = await bundleClient(o.outDir, base, o.shell.clientEntry);
  const pages = await o.shell.render(article, { base, ...urls, dev: false });
  for (const [rel, data] of Object.entries(pages)) {
    await write(o.outDir, rel, data);
    files.push(rel);
  }
  await write(o.outDir, "_pagina/manifest.json", JSON.stringify(article.manifest, null, 2));
  files.push("_pagina/manifest.json");
  return { files, diagnostics: [...article.diagnostics] };
}
