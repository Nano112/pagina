/**
 * `pack` and `unpack`: an article folder to one portable file, and back.
 *
 * The two halves are not symmetrical, and deliberately so. `pack` is a **build with diagnostics**
 * — it runs the same render a publish does, walks what the pages actually reference, and refuses
 * rather than guessing when a reference does not resolve. `unpack` is a **trust boundary** — the
 * archive came from somewhere else, so every structural claim it makes is checked before a single
 * byte is written, and a failure leaves the destination exactly as it was found.
 */
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type MarkdownIt from "markdown-it";
import {
  BUNDLE_MANIFEST_PATH, BundleError, DEFAULT_BUNDLE_LIMITS, buildBundleContents, inlineArticleFigures,
  parseArticleConfig, parseBundleManifest, renderArticle, verifyBundleEntries,
  type BundleEntry, type BundleLimits, type BundleManifest, type Diagnostic, type RenderedOutput,
} from "@pagina/core";
import { NodeContentFs } from "./node-fs.js";
import { loadKineglyphThemes, prerenderFigures } from "./prerender.js";
import { readZip, writeZip } from "./zip.js";
import { paginaTempRoot } from "./tmp.js";

/** The version stamped into every bundle this build produces. */
export const PAGINA_VERSION = "0.1.0";

/** The conventional extension. A bundle is a ZIP, but not every ZIP is a bundle. */
export const BUNDLE_EXTENSION = ".pgz";

export interface PackOptions {
  /** The article folder — the one holding `article.yaml`. */
  readonly folder: string;
  /** Where to write the archive. */
  readonly out: string;
  /** The site base the `.rendered/` output is rendered at. Default `"/"`. */
  readonly base?: string;
  readonly md?: MarkdownIt;
  /**
   * The `created` stamp, injectable so a reproducible build can pin it.
   *
   * With the same value, packing one folder twice produces identical bytes — entry order, the
   * archive's timestamps and the descriptor's field order are all fixed. Default: now.
   */
  readonly created?: string;
  /** Report rather than refuse. Default `false`. */
  readonly strict?: boolean;
}

export interface PackResult {
  readonly manifest: BundleManifest;
  readonly diagnostics: readonly Diagnostic[];
  /** The archive's size on disk, in bytes. */
  readonly size: number;
}

/**
 * Renders an article folder and writes it out as a bundle.
 *
 * The render is the *same* one `buildStatic` runs — `renderArticle`, then Kineglyph pre-render,
 * then the figures inlined into the pages — so the `.rendered/` output a host serves without
 * running Node is byte-for-byte what a build here would have produced.
 */
/**
 * Refuses a folder that reaches out of itself through a symlink.
 *
 * `ContentFs` reads through links without noticing, so a `media/logo.png` pointing at
 * `~/.ssh/id_rsa` would be dutifully copied into the bundle and handed to whoever it is sent to.
 * That is not a path traversal at *import* time — the bundle it produces is perfectly well-formed
 * — which is exactly why it has to be caught here, at the only moment anyone can still see that
 * the file was a link.
 */
async function refuseEscapingSymlinks(folder: string): Promise<void> {
  const root = await realpath(folder);
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = await realpath(path);
        } catch {
          throw new BundleError("bundle-symlink", `${path} is a symlink to nothing`);
        }
        if (target !== root && !target.startsWith(root + sep))
          throw new BundleError("bundle-symlink", `${path} is a symlink to ${target}, which is outside the article folder`);
        continue;
      }
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(root);
}

export async function packBundle(o: PackOptions): Promise<PackResult> {
  const base = o.base ?? "/";
  await refuseEscapingSymlinks(o.folder);
  const fs = new NodeContentFs(o.folder);
  const articleYaml = await fs.read("article.yaml");
  const config = parseArticleConfig(articleYaml);
  const article = await renderArticle({ fs, strict: true, base, ...(o.md === undefined ? {} : { md: o.md }) });
  const themes = await loadKineglyphThemes(o.folder, config);
  const prerendered = await prerenderFigures(article, o.folder, themes, config.kineglyph?.width, base);
  // A figure that cannot be drawn is a figure the importing host would show as an empty frame, so
  // it stops the pack the same way it stops a build.
  if (prerendered.diagnostics.some((d) => d.severity === "error"))
    throw new BundleError("bundle-format", prerendered.diagnostics.map((d) => `[${d.code}] ${d.page ?? ""}: ${d.message}`).join("\n"));
  const inlined = inlineArticleFigures(article, (id) => {
    const first = prerendered.figures.get(id)?.[0];
    return first === undefined ? undefined : { svg: first.inlineSvg, needsRuntime: first.needsRuntime };
  });
  const rendered: RenderedOutput = {
    manifest: article.manifest,
    pages: Object.fromEntries(Object.entries(inlined.article.pages).map(([href, page]) => [href, page.html])),
    figures: Object.fromEntries(
      [...prerendered.figures].map(([id, results]) => [id, Object.fromEntries(results.map((r) => [r.theme, r.svg]))]),
    ),
  };
  const built = await buildBundleContents({
    fs, config, articleYaml, base, rendered,
    article: inlined.article,
    pagina: PAGINA_VERSION,
    created: o.created ?? new Date().toISOString(),
    ...(o.strict === undefined ? {} : { strict: o.strict }),
  });
  const archive = writeZip(built.entries);
  await mkdir(dirname(resolve(o.out)), { recursive: true });
  await writeFile(o.out, archive);
  return {
    manifest: built.manifest,
    diagnostics: [...article.diagnostics, ...prerendered.diagnostics, ...inlined.diagnostics, ...built.diagnostics],
    size: archive.byteLength,
  };
}

// ---------------------------------------------------------------------------------------------

export interface UnpackOptions {
  /** The `.pgz` file. */
  readonly file: string;
  /** Where the folder goes. Created only once every check has passed. */
  readonly dir: string;
  /**
   * Write into a destination that already has something in it.
   *
   * Default `false`: importing over an existing article is a decision, and a default that
   * overwrites is a default that loses someone's work the first time two articles share a slug.
   */
  readonly force?: boolean;
  readonly limits?: BundleLimits;
}

export interface UnpackResult {
  readonly manifest: BundleManifest;
  readonly dir: string;
  /** Every path written, bundle-relative and sorted. */
  readonly files: readonly string[];
}

/**
 * Reads a bundle, verifies it completely, and only then writes it.
 *
 * "Only then" is the whole design. Every member is decoded into memory, the names are checked
 * against the path policy, the archive's contents are reconciled with `bundle.json` in both
 * directions, the sizes and the ratio are checked, and every checksum is verified — before
 * `mkdir` is called once. The write itself goes to a temporary directory and is renamed into
 * place, so a failure partway through leaves the destination as it was rather than half an
 * article.
 */
export async function unpackBundle(o: UnpackOptions): Promise<UnpackResult> {
  const limits = o.limits ?? DEFAULT_BUNDLE_LIMITS;
  const archive = await readFile(o.file);
  const entries = readZip(new Uint8Array(archive), limits);

  const descriptor = entries.find((e) => e.path === BUNDLE_MANIFEST_PATH);
  if (descriptor === undefined)
    throw new BundleError("bundle-manifest", `${o.file} has no ${BUNDLE_MANIFEST_PATH}; it is a ZIP, not a bundle`);
  const manifest = parseBundleManifest(new TextDecoder().decode(descriptor.data));
  const files = entries.filter((e) => e.path !== BUNDLE_MANIFEST_PATH);
  await verifyBundleEntries({ manifest, entries: files, archiveSize: archive.byteLength, limits });

  const dir = resolve(o.dir);
  if (existsSync(dir)) {
    if ((await stat(dir)).isDirectory()) {
      if ((await readdir(dir)).length > 0 && o.force !== true)
        throw new BundleError("bundle-destination", `${dir} is not empty; pass --force to import over it`);
    } else {
      throw new BundleError("bundle-destination", `${dir} exists and is not a directory`);
    }
  }

  // A sibling of the destination would be tidier, but the destination's parent may not exist yet
  // and may not be writable; the OS temp directory always is, and the rename falls back to a copy
  // across devices anyway.
  //
  // `paginaTempRoot()` rather than `tmpdir()` because the latter is only as absolute as `$TMPDIR`
  // is, and staging that resolves relatively would put a half-verified archive in whatever
  // directory the caller ran `pagina unpack` from.
  const staging = await mkdtemp(join(paginaTempRoot(), "pagina-unpack-"));
  try {
    for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      const target = join(staging, ...entry.path.split("/"));
      // Belt and braces. `assertSafeBundlePath` has already refused everything that could get
      // here, and this is the check that would have caught it if it had not.
      if (target !== staging && !target.startsWith(staging + sep))
        throw new BundleError("bundle-path", `${entry.path} resolves outside the destination`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.data);
    }
    await mkdir(dirname(dir), { recursive: true });
    // Every check has passed by now, so replacing an empty (or explicitly forced) destination is
    // safe — and `rename` onto an existing directory is not portable.
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
    try {
      await rename(staging, dir);
    } catch (error) {
      // The temp directory and the destination can be on different filesystems, which is not a
      // failure, just a rename that has to be a copy.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await cp(staging, dir, { recursive: true });
      await rm(staging, { recursive: true, force: true });
    }
    // `mkdtemp` makes a private directory — right for staging, wrong for the article folder that
    // comes out of it, which a web server has to be able to read. Everything *inside* was created
    // by `mkdir` under the process umask and is already fine; only the root inherited 0700.
    await chmod(dir, 0o755);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { manifest, dir, files: [...entries.map((e) => e.path)].sort() };
}

/** Reads a bundle and verifies it, without writing anything. What a host calls before importing. */
export async function verifyBundleFile(file: string, limits: BundleLimits = DEFAULT_BUNDLE_LIMITS): Promise<{ manifest: BundleManifest; entries: readonly BundleEntry[] }> {
  const archive = await readFile(file);
  const entries = readZip(new Uint8Array(archive), limits);
  const descriptor = entries.find((e) => e.path === BUNDLE_MANIFEST_PATH);
  if (descriptor === undefined)
    throw new BundleError("bundle-manifest", `${file} has no ${BUNDLE_MANIFEST_PATH}; it is a ZIP, not a bundle`);
  const manifest = parseBundleManifest(new TextDecoder().decode(descriptor.data));
  await verifyBundleEntries({ manifest, entries: entries.filter((e) => e.path !== BUNDLE_MANIFEST_PATH), archiveSize: archive.byteLength, limits });
  return { manifest, entries };
}
