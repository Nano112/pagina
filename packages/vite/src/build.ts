import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type MarkdownIt from "markdown-it";
import { build as viteBuild } from "vite";
import { LLMS_JSON_PATH, LLMS_TXT_PATH, PaginaBuildError, SEARCH_INDEX_PATH, buildSearchIndex, deploymentDiagnostics, inlineArticleFigures, llmsJson, llmsTxt, parseArticleConfig, renderArticle, robotsPlacement, serializeLlmsJson, serializeSearchIndex, sha256Hex, sitemapXml, walkReferences, type ArticleConfig, type Diagnostic, type RenderedArticle, type RobotsPlacement, type Shell, type ThemeLevel } from "@pagina/core";
import { NodeContentFs } from "./node-fs.js";
import { gitIgnoredPaths } from "./gitignore.js";
import { resolveKineglyphBundle } from "./kineglyph.js";
import { drawnFigure, figureWidths, loadKineglyphThemes, prerenderFigures, widestPerTheme } from "./prerender.js";

// `Shell`/`ShellContext` are defined in `@pagina/core` so a shell package can type itself
// against the contract without depending on this builder; re-exported here for compatibility.
export type { Shell, ShellContext, ThemeLevel } from "@pagina/core";

export interface BuildOptions {
  readonly folder: string;
  readonly outDir: string;
  readonly base?: string;
  readonly strict?: boolean;
  readonly shell: Shell;
  readonly md?: MarkdownIt;
  /** How much pagina CSS the pages link: `"full"` (default), `"tokens"` or `"none"`. */
  readonly theme?: ThemeLevel;
  /** Render pagina's own header row. Default `true`; `false` when a host supplies chrome. */
  readonly chrome?: boolean;
  /**
   * Absolute origin the built site will be served from, overriding `article.yaml`'s `site_url`.
   *
   * Without one — here or in the folder — `link rel=canonical`, `og:url` and `og:image` are
   * omitted and no `sitemap.xml` is written, because a relative canonical indexes nothing and a
   * relative `og:image` is a guaranteed 404 on every consumer's origin. The build warns per page.
   */
  readonly siteUrl?: string;
  /**
   * Absolute URL, path included, of the deployment this build is a **copy of**.
   *
   * A static mirror of an article that is also published elsewhere is two public copies of one
   * document, and search engines have to be told which one counts. Set, every page's canonical and
   * `og:url` address the primary's URL for that page, and no `sitemap.xml` is written — this build
   * asks to be read and not to be ranked.
   */
  readonly mirrorOf?: string;
  /**
   * Turn the unreferenced-file report into errors. Default `false`.
   *
   * The report names every file the build copied that no page, cover, figure or module import
   * reaches — dead weight at best, and at worst something the author did not mean to publish. It
   * is a **warning** by default because a real folder legitimately contains files this walk cannot
   * see: an image a scene module builds a URL for at runtime, a font a stylesheet pulls in, a
   * `.well-known` file a host serves. Failing those builds would teach authors to widen `exclude`
   * until it stops complaining, which is the opposite of containment.
   *
   * `true` for the build that publishes something you would mind leaking: it refuses to write a
   * site containing a file nobody asked for, and the fix is to name it in `exclude` or delete it.
   */
  readonly strictAssets?: boolean;
  /**
   * Write `_pagina/search.json` and let the shell offer search. Default `true`.
   *
   * Off is for a host that indexes the article itself — one search box over a whole site is better
   * than one per article, and two boxes on one page is worse than either.
   */
  readonly search?: boolean;
}

export interface BuildResult {
  readonly files: string[];
  readonly diagnostics: Diagnostic[];
  /**
   * What became of `robots.txt` — written at the output root, or, for a sub-path deployment, not
   * written at all, with {@link RobotsPlacement.reason} saying why and what to do instead. Handed
   * back rather than logged so the CLI, a CI script and a host all say the same thing.
   */
  readonly robots: RobotsPlacement;
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

/**
 * Everything this folder excludes beyond the built-in defaults and its own `exclude` list — which
 * today means whatever git ignores — and what to tell the author about it.
 *
 * Reported rather than applied silently. Honouring `.gitignore` is the right default (it is where
 * "not for publication" is already written, and it is what would have kept a directory of internal
 * notes off the public web), but a default that removes files without saying so is exactly the
 * kind of quiet behaviour this work exists to remove. So every build that drops something names
 * how much and, up to a readable number, which.
 */
async function folderExclusions(
  folder: string,
  fs: NodeContentFs,
  config: ArticleConfig,
): Promise<{ exclude: string[]; gitIgnored: Set<string>; diagnostics: Diagnostic[] }> {
  const none = { exclude: [], gitIgnored: new Set<string>(), diagnostics: [] };
  if (!config.excludeGitignore) return none;
  const all = await fs.list(".");
  const ignored = await gitIgnoredPaths(folder, all);
  if (ignored === undefined || ignored.size === 0) return none;
  const named = [...ignored].sort();
  const shown = named.slice(0, 10);
  return {
    // As literal paths, not as patterns: git already decided, and re-expressing its answer as a
    // glob is a second matcher that can disagree with the first.
    exclude: named,
    gitIgnored: ignored,
    diagnostics: [{
      severity: "warning",
      code: "gitignored-excluded",
      message: `git ignores ${String(ignored.size)} file(s) in this folder, so they were not published: ${shown.join(", ")}${named.length > shown.length ? `, and ${String(named.length - shown.length)} more` : ""}. Set \`exclude_gitignore: false\` in article.yaml to publish them anyway.`,
    }],
  };
}

/** The codes {@link unreferencedReport} raises, and the only ones it may fail a build on. */
const CONTAINMENT_CODES = new Set(["unreferenced-file", "gitignored-but-referenced"]);

/**
 * The files the build copied that nothing reaches.
 *
 * A folder is not a manifest. Everything in it that is not a page gets copied to the public web,
 * and the only evidence an author has that a file *belongs* there is that something links to it.
 * So the same walk the bundle uses to decide what to carry is run over the built site to decide
 * what to *mention*: an asset no page links, no figure draws, no cover names and no scene module
 * imports is either dead weight or a mistake, and both are worth a line of output.
 *
 * One case is escalated regardless of `strict`: a file git ignores that a page nevertheless
 * references. Honouring `.gitignore` would drop it and leave a broken image on a published page,
 * which is the one outcome worse than either alternative, so the build stops and says so.
 */
async function unreferencedReport(o: {
  fs: NodeContentFs;
  article: RenderedArticle;
  config: ArticleConfig;
  base: string;
  gitIgnored: ReadonlySet<string>;
  strict: boolean;
}): Promise<Diagnostic[]> {
  const walk = await walkReferences({
    fs: o.fs, article: o.article.pages, manifest: o.article.manifest, config: o.config, base: o.base,
  });
  const diagnostics: Diagnostic[] = [];
  for (const path of walk.wanted.keys()) {
    if (!o.gitIgnored.has(path)) continue;
    diagnostics.push({
      severity: "error",
      code: "gitignored-but-referenced",
      message: `${walk.wanted.get(path) ?? "the article"} references ${path}, which git ignores — publishing would leave a dead link. Commit it, or stop referencing it.`,
    });
  }
  const unreferenced = o.article.manifest.assets.filter((a) => !walk.bytes.has(a) && !walk.wanted.has(a) && !walk.snippets.has(a));
  for (const path of unreferenced)
    diagnostics.push({
      severity: o.strict ? "error" : "warning",
      code: "unreferenced-file",
      message: `${path} was copied into the site but nothing in the article references it. Add it to \`exclude\` in article.yaml if it is not meant to be published.`,
    });
  return diagnostics;
}

const KINEGLYPH_ENTRY = "_pagina/.kineglyph-entry.ts";

/**
 * Hex characters of a file's SHA-256 that go into its name.
 *
 * Eight is 32 bits: with a few artefacts per build and a handful of builds a day, a collision is
 * not a thing that happens, and a name a person can read out over a call is worth more than the
 * remaining bits. This is a cache key, not a signature — `bundle.ts`'s integrity hashes are the
 * full digest and stay that way.
 */
export const ASSET_HASH_CHARS = 8;

/** A name this build produced — so a rebuild into the same directory can clear the last one's. */
const HASHED_ASSET = /^(?:pagina|pagina\.tokens|kineglyph)\.[0-9a-f]{8}\.(?:js|css)$/;

/** `pagina.js` + a digest → `pagina.a1b2c3d4.js`. The extension stays last, so servers still type it. */
function hashedName(name: string, hash: string): string {
  const dot = name.lastIndexOf(".");
  return `${name.slice(0, dot)}.${hash.slice(0, ASSET_HASH_CHARS)}${name.slice(dot)}`;
}

/**
 * Renames `name` in `dir` to carry a hash of its own bytes, and answers what it is now called.
 *
 * A file that is not there is answered with the name it would have had, unchanged: `bundleClient`
 * is called with a third-party shell's entry too, and a shell that imports no CSS emits no
 * stylesheet. Returning the plain name keeps that case exactly as it was.
 */
async function hashInPlace(dir: string, name: string, digest?: string): Promise<string> {
  const from = join(dir, name);
  if (!existsSync(from)) return name;
  const hash = digest ?? await sha256Hex(await readFile(from));
  const to = hashedName(name, hash);
  if (to !== name) await rename(from, join(dir, to));
  return to;
}

/**
 * Bundles the client + a kineglyph runtime entry into `_pagina/`. Returns their site URLs.
 *
 * ## Why the names carry a hash
 *
 * `_pagina/pagina.js` under a ten-minute `max-age` means that for ten minutes after every deploy a
 * returning reader runs **this** build's HTML against the **last** build's JavaScript. That is not
 * a slow cache, it is a version skew, and it has already produced one false bug report about
 * figures and one wrong answer about a keyboard shortcut. A name that contains the content cannot
 * skew: the HTML this build writes names the assets this build wrote, and a stale HTML document
 * names the stale assets it was written against, which are still on the server. Both pairs are
 * internally consistent, which is the only property that matters.
 *
 * Every URL travels through {@link ShellContext}, so a shell never spells one of these names —
 * that is what makes this change invisible above this function.
 *
 * ## One hash for the two stylesheets
 *
 * `pagina.tokens.css` takes `pagina.css`'s digest rather than its own. The full sheet **inlines**
 * the tokens sheet at build time, so any edit to the tokens changes the full sheet's bytes too:
 * one digest already covers both, and sharing it keeps `pagina.<h>.css` ⇄ `pagina.tokens.<h>.css`
 * derivable by name, which is what the theme showcase and `theme: "tokens"` fall back to when a
 * caller passes only one of the two. The cost is that a chrome-only edit also renames the tokens
 * sheet: one extra download, once, for a file almost nobody links.
 *
 * ## What this is *not*
 *
 * It is not a second cache-busting scheme next to the `?v=<hash>` a host stamps on its published
 * copy of `dist/pagina.css` (`Assets::url()` in the Laravel package). The two never describe the
 * same file. This one is for artefacts **pagina emits together with the HTML that names them**,
 * where the build controls both halves and can therefore put the version in the name. That one is
 * for artefacts a host **copies out** under names it chose, where a query stamp is the only handle
 * it has. See `docs/theming.md`.
 */
export async function bundleClient(
  outDir: string,
  base: string,
  clientEntry: string,
): Promise<{ clientUrl: string; cssUrl: string; tokensCssUrl?: string; kineglyphRuntimeUrl: string }> {
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
  // The tokens-only sheet is the *same file* the full sheet `@import`s, copied verbatim rather
  // than re-derived, so `theme: "tokens"` can never drift from `theme: "full"`. A third-party
  // shell without one simply doesn't get the tokens level.
  const tokensSrc = resolve(clientEntry, "../tokens.css");
  const assets = join(outDir, "_pagina");
  const hasTokens = existsSync(tokensSrc);
  if (hasTokens) await cp(tokensSrc, join(assets, "pagina.tokens.css"));
  // Last build's names, cleared before this build's are minted. `emptyOutDir` is off (the figures
  // and the manifest live here too), so without this a directory rebuilt in place would keep every
  // version of the client it has ever had — and the unreferenced-file report cannot see `_pagina/`.
  for (const entry of await readdir(assets)) {
    if (HASHED_ASSET.test(entry)) await rm(join(assets, entry), { force: true });
  }
  const cssPath = join(assets, "pagina.css");
  const cssDigest = existsSync(cssPath) ? await sha256Hex(await readFile(cssPath)) : undefined;
  const client = await hashInPlace(assets, "pagina.js");
  const css = await hashInPlace(assets, "pagina.css", cssDigest);
  // Deliberately the *full* sheet's digest — see the note above `bundleClient`.
  const tokens = await hashInPlace(assets, "pagina.tokens.css", cssDigest);
  const kineglyph = await hashInPlace(assets, "kineglyph.js");
  const b = base.replace(/\/$/, "");
  return {
    clientUrl: `${b}/_pagina/${client}`,
    cssUrl: `${b}/_pagina/${css}`,
    ...(hasTokens ? { tokensCssUrl: `${b}/_pagina/${tokens}` } : {}),
    kineglyphRuntimeUrl: `${b}/_pagina/${kineglyph}`,
  };
}

/**
 * Renders an article folder into a static site under `outDir`, which is the directory
 * served at `base`: page HTML at `<href>index.html`, assets 1:1, pre-rendered figures at
 * `_pagina/figures/<page-slug>/<id>.<theme>.svg`, the manifest and the client bundle in
 * `_pagina/`.
 */
export async function buildStatic(o: BuildOptions): Promise<BuildResult> {
  const base = o.base ?? "/";
  const strict = o.strict ?? true;
  const fs = new NodeContentFs(o.folder);
  const config = parseArticleConfig(await fs.read("article.yaml"));
  // What the folder says is not for publication, before anything is read as content. `.gitignore`
  // is asked first because it is the answer that already exists — see `gitignore.ts`.
  const containment = await folderExclusions(o.folder, fs, config);
  const article = await renderArticle({
    fs, strict, base,
    ...(containment.exclude.length === 0 ? {} : { exclude: containment.exclude }),
    ...(o.md === undefined ? {} : { md: o.md }),
    ...(o.siteUrl === undefined ? {} : { siteUrl: o.siteUrl }),
  });
  await mkdir(o.outDir, { recursive: true });
  const files: string[] = [];

  const themes = await loadKineglyphThemes(o.folder, config);
  const prerendered = await prerenderFigures(article, o.folder, themes, figureWidths(config), base);
  const diagnostics: Diagnostic[] = [...article.diagnostics, ...prerendered.diagnostics, ...containment.diagnostics];
  // What was copied but never reached. Computed before anything is written, so a `strictAssets`
  // build refuses instead of publishing and apologising.
  diagnostics.push(...await unreferencedReport({
    fs, article, config, base,
    gitIgnored: containment.gitIgnored,
    strict: o.strictAssets === true,
  }));
  // `strictAssets` promotes the unreferenced report to errors; `gitignored-but-referenced` is one
  // regardless, because the alternative is a published page with a dead image on it. Checked
  // before a byte is written, and scoped to this report's own codes so the figure lane below
  // keeps reporting *every* broken figure rather than stopping at whatever came first.
  if (strict && diagnostics.some((d) => CONTAINMENT_CODES.has(d.code) && d.severity === "error"))
    throw new PaginaBuildError(diagnostics);
  for (const [id, results] of prerendered.figures) {
    const meta = article.manifest.figures[id];
    if (meta === undefined) continue;
    for (const r of widestPerTheme(results)) {
      const rel = `${stripBase(meta.staticBase, base)}.${r.theme}.svg`;
      await write(o.outDir, rel, r.svg);
      files.push(rel);
    }
  }
  // Every figure was attempted first, so this reports all of them, not just the first.
  if (strict && prerendered.diagnostics.some((d) => d.severity === "error")) throw new PaginaBuildError(diagnostics);
  // Inline the figures into the pages before the shell renders them. That is what makes a diagram
  // part of the document instead of a subresource: an `<img>` is a separate document, and no host
  // CSS — nor any screen reader — crosses that boundary.
  const inlined = inlineArticleFigures(article, (id) => {
    return drawnFigure(prerendered.figures.get(id));
  });
  diagnostics.push(...inlined.diagnostics);
  for (const asset of article.manifest.assets) {
    await mkdir(dirname(join(o.outDir, asset)), { recursive: true });
    await cp(resolve(o.folder, asset), join(o.outDir, asset));
    files.push(asset);
  }
  const urls = await bundleClient(o.outDir, base, o.shell.clientEntry);
  // Built from the *inlined* article, so the figures' `<title>`/`<desc>` are in the HTML by the
  // time it is read — a diagram's description is indexable only in this window, between inlining
  // and the shell turning the article into files.
  let searchUrl: string | undefined;
  if (o.search !== false) {
    await write(o.outDir, SEARCH_INDEX_PATH, serializeSearchIndex(buildSearchIndex(inlined.article)));
    files.push(SEARCH_INDEX_PATH);
    searchUrl = `${base.replace(/\/$/, "")}/${SEARCH_INDEX_PATH}`;
  }
  const pages = await o.shell.render(inlined.article, {
    base, ...urls, dev: false,
    ...(searchUrl === undefined ? {} : { searchUrl }),
    ...(o.theme === undefined ? {} : { theme: o.theme }),
    ...(o.chrome === undefined ? {} : { chrome: o.chrome }),
    ...(o.siteUrl === undefined ? {} : { siteUrl: o.siteUrl }),
    ...(o.mirrorOf === undefined ? {} : { mirrorOf: o.mirrorOf }),
  });
  for (const [rel, data] of Object.entries(pages)) {
    await write(o.outDir, rel, data);
    files.push(rel);
  }
  // The two files a standalone static site needs and a hosted one does not: a host that mounts
  // pagina inside its own site serves its own robots and folds these pages into its own sitemap.
  const siteUrl = o.siteUrl ?? article.manifest.article.siteUrl;
  const seoOpts = {
    base,
    ...(o.siteUrl === undefined ? {} : { siteUrl: o.siteUrl }),
    ...(o.mirrorOf === undefined ? {} : { mirrorOf: o.mirrorOf }),
  };
  // A deployment's URL and its base have to agree, and only this layer knows both. Checked once
  // for the build: it is a fact about where the site is going, not about any one page.
  diagnostics.push(...deploymentDiagnostics(siteUrl, base));
  const sitemap = sitemapXml(article.manifest, seoOpts);
  // A mirror having no sitemap is the intended outcome of `mirrorOf`, not something that went
  // wrong, so it is not reported — a warning a build cannot act on trains people to ignore warnings.
  if (sitemap === undefined && o.mirrorOf === undefined) {
    diagnostics.push({
      severity: "warning",
      code: "sitemap-skipped",
      message: article.manifest.article.status === "published"
        ? "no site_url is configured, so no sitemap.xml was written; set `site_url` in article.yaml or pass --site-url"
        : "the article is a draft, so no sitemap.xml was written and robots.txt disallows everything",
    });
  } else if (sitemap !== undefined) {
    await write(o.outDir, "sitemap.xml", sitemap);
    files.push("sitemap.xml");
  }
  const robots = robotsPlacement(article.manifest, seoOpts);
  if (robots.outPath !== undefined) {
    await write(o.outDir, robots.outPath, robots.content);
    files.push(robots.outPath);
  }
  await write(o.outDir, "_pagina/manifest.json", JSON.stringify(article.manifest, null, 2));
  files.push("_pagina/manifest.json");
  // The front door for a reader that is a program: `llms.txt` at the site root by convention, and
  // the same walk with the sections kept next to the manifest it is projected from. Both are
  // derived from data three files above already wrote, and neither is in `sitemap.xml` — they are
  // for something that was handed the address, not for something crawling towards it.
  const llmsOpts = { ...seoOpts, search: o.search !== false };
  await write(o.outDir, LLMS_TXT_PATH, llmsTxt(article.manifest, llmsOpts));
  files.push(LLMS_TXT_PATH);
  await write(o.outDir, LLMS_JSON_PATH, serializeLlmsJson(llmsJson(article.manifest, llmsOpts)));
  files.push(LLMS_JSON_PATH);
  return { files, diagnostics, robots };
}
