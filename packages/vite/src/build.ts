import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type MarkdownIt from "markdown-it";
import { build as viteBuild } from "vite";
import { PaginaBuildError, parseArticleConfig, renderArticle, type Diagnostic, type Shell } from "@pagina/core";
import { NodeContentFs } from "./node-fs.js";
import { resolveKineglyphBundle } from "./kineglyph.js";
import { loadKineglyphThemes, prerenderFigures } from "./prerender.js";

// `Shell`/`ShellContext` are defined in `@pagina/core` so a shell package can type itself
// against the contract without depending on this builder; re-exported here for compatibility.
export type { Shell, ShellContext } from "@pagina/core";

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
  // Only strip at a path-segment boundary: base `/docs` must not eat `/docsearch/...`.
  const inBase = b !== "" && (url === b || url.startsWith(`${b}/`));
  return (inBase ? url.slice(b.length) : url).replace(/^\/+/, "");
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
        // `kineglyph` stays a bare import in the client bundle: the page's import map points
        // it at `_pagina/kineglyph.js`, so the runtime is loaded once and shared with the
        // scene modules. Everything else is bundled in.
        rollupOptions: { external: ["kineglyph"], output: { assetFileNames: "pagina.[ext]" } },
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
  const strict = o.strict ?? true;
  const fs = new NodeContentFs(o.folder);
  const article = await renderArticle({ fs, strict, base, ...(o.md === undefined ? {} : { md: o.md }) });
  await mkdir(o.outDir, { recursive: true });
  const files: string[] = [];

  const config = parseArticleConfig(await fs.read("article.yaml"));
  const themes = await loadKineglyphThemes(o.folder, config);
  const prerendered = await prerenderFigures(article, o.folder, themes, config.kineglyph?.width, base);
  const diagnostics: Diagnostic[] = [...article.diagnostics, ...prerendered.diagnostics];
  for (const [id, results] of prerendered.figures) {
    const meta = article.manifest.figures[id];
    if (meta === undefined) continue;
    for (const r of results) {
      const rel = `${stripBase(meta.staticBase, base)}.${r.theme}.svg`;
      await write(o.outDir, rel, r.svg);
      files.push(rel);
    }
  }
  // Every figure was attempted first, so this reports all of them, not just the first.
  if (strict && prerendered.diagnostics.some((d) => d.severity === "error")) throw new PaginaBuildError(diagnostics);
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
  return { files, diagnostics };
}
