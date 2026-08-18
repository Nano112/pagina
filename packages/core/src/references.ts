/**
 * What an article actually reaches.
 *
 * The bundle writer has always walked references rather than copying a folder, because a bundle
 * has to be portable — it carries what the pages need and nothing else. The static build copied
 * the folder instead, so the two disagreed about what an article *is*, and the disagreement was
 * load-bearing: building Nucleation's docs as a bundle omitted its gitignored internal notes, and
 * building the same folder as a site would have published them.
 *
 * So the walk lives here, once, and both use it: the bundle to decide what to carry, the build to
 * decide what to *report* — a file in the folder that this walk never reaches is either dead
 * weight or something the author did not mean to publish, and either way they should be told.
 */
import type { ArticleConfig, ContentFs, Manifest, RenderedArticle } from "./types.js";
import { resolveRelative } from "./links.js";
import { SNIPPET_DIRECTIVE, joinPosix } from "./plugins/snippets.js";

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const EXTERNAL_REF = /\b(?:href|src|data-scene|data-static)="((?:https?:)?\/\/[^"]*)"/g;
/** `import x from "…"`, `import "…"`, `export … from "…"`, `import("…")` — enough for a scene. */
const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/** Site-absolute URL (which includes `base`) → folder-relative path, or `undefined` if it is not one. */
export function toFolderPath(url: string, base: string): string | undefined {
  if (ABSOLUTE_URL.test(url)) return undefined;
  const b = base.replace(/\/$/, "");
  const inBase = b === "" || url === b || url.startsWith(`${b}/`);
  if (!inBase) return undefined;
  const rest = (b === "" ? url : url.slice(b.length)).replace(/^\/+/, "");
  const path = rest.split("#")[0]!.split("?")[0]!;
  // A page href ends in `/`; an asset never does.
  return path === "" || path.endsWith("/") ? undefined : path;
}

export interface WalkReferencesOptions {
  readonly fs: ContentFs;
  readonly article: RenderedArticle["pages"];
  readonly manifest: Manifest;
  readonly config: ArticleConfig;
  readonly base: string;
  /**
   * Paths the caller has already dealt with and does not want walked into.
   *
   * The bundle has by this point added its pages with their snippet directives rewritten, and
   * re-reading them here would offer the raw bytes for the same path.
   */
  readonly skip?: (path: string) => boolean;
  /**
   * What counts as "inside the folder". Defaults to a plain no-`..`, no-dot-segment test; the
   * bundle passes its own stricter path policy, because a path this walk calls fine and the
   * bundle writer then refuses is a build that fails after doing all of the work.
   */
  readonly isInside?: (path: string) => boolean;
}

export interface ReferenceWalk {
  /** Folder-relative path → what asked for it. Includes transitively imported modules. */
  readonly wanted: ReadonlyMap<string, string>;
  /** The bytes of every wanted path that exists inside the folder, read once. */
  readonly bytes: ReadonlyMap<string, Uint8Array>;
  /** Wanted, inside the folder, but not there. Path → what asked for it. */
  readonly missing: ReadonlyMap<string, string>;
  /** Wanted but outside the folder — `../secrets` and friends. Path → what asked for it. */
  readonly outside: ReadonlyMap<string, string>;
  /** Absolute URLs the pages point at, which no local file can satisfy. */
  readonly external: ReadonlySet<string>;
  /**
   * Files a page pulls in with `--8<--`, resolved against the declared snippet roots.
   *
   * Kept apart from {@link wanted} because these are *not* references a consumer follows: the
   * text is inlined into the page at render time, and the bundle relocates the file under
   * `snippets/` while rewriting the directive. A caller asking "is this file reached?" must count
   * them; a caller asking "what must travel with the pages?" already handled them itself. Paths
   * are as the roots resolved them, so a root of `..` yields a path outside the folder.
   */
  readonly snippets: ReadonlySet<string>;
}

/** True for a path that stays inside the folder: no `..`, no absolute root, no dot-segment. */
function inside(path: string): boolean {
  if (path === "" || path.startsWith("/")) return false;
  return !path.split("/").some((s) => s === "" || s === "." || s === "..");
}

/**
 * Every file the article reaches, from the nav outwards.
 *
 * The reachable set is: the assets its pages link to, the scene module and static image behind
 * each figure, the covers the manifest resolved, the Kineglyph theme module, and — transitively —
 * whatever those scene modules import, because a figure whose module is present but whose import
 * is not fails to hydrate on the importing host.
 *
 * Pages themselves are not in the result: they are the *roots* of the walk, and every caller
 * knows them already.
 */
export async function walkReferences(o: WalkReferencesOptions): Promise<ReferenceWalk> {
  const skip = o.skip ?? ((): boolean => false);
  const isInside = o.isInside ?? inside;
  const wanted = new Map<string, string>();
  const external = new Set<string>();
  const want = (path: string | undefined, why: string): void => {
    if (path === undefined || path === "") return;
    if (!wanted.has(path)) wanted.set(path, why);
  };
  for (const page of Object.values(o.article)) {
    for (const link of page.links) {
      if (link.resolved === undefined || link.resolved.startsWith("#")) continue;
      want(toFolderPath(link.resolved, o.base), page.path);
    }
    for (const figure of page.figures) {
      if (figure.scene !== undefined) want(toFolderPath(figure.scene, o.base), page.path);
      if (figure.static !== undefined && !ABSOLUTE_URL.test(figure.static)) want(resolveRelative(page.path, figure.static), page.path);
    }
    for (const m of page.html.matchAll(EXTERNAL_REF)) external.add(m[1]!);
  }
  want(toFolderPath(o.manifest.article.cover ?? "", o.base), "article.yaml (cover)");
  for (const [href, meta] of Object.entries(o.manifest.pages))
    want(toFolderPath(meta.cover ?? "", o.base), `${href} (cover)`);
  if (o.config.kineglyph?.theme !== undefined) want(joinPosix(o.config.kineglyph.theme), "article.yaml (kineglyph.theme)");
  for (const url of [o.manifest.article.cover, ...Object.values(o.manifest.pages).map((p) => p.cover)])
    if (url !== undefined && ABSOLUTE_URL.test(url)) external.add(url);

  // Snippets are resolved from the page *source*, not from the rendered HTML: by the time a page
  // is HTML the directive has become the quoted text, and the file it came from is invisible.
  const roots = o.config.snippets.roots.map((r) => joinPosix(r));
  const snippets = new Set<string>();
  for (const page of Object.values(o.article)) {
    const source = await o.fs.read(page.path);
    for (const line of source.split(/\r?\n/)) {
      const m = SNIPPET_DIRECTIVE.exec(line);
      if (m === null) continue;
      const ref = (m as unknown as [string, string, string])[2];
      const refPath = ref.includes(":") ? ref.slice(0, ref.indexOf(":")) : ref;
      for (const root of roots) {
        const candidate = joinPosix(root, refPath);
        if (await o.fs.exists(candidate)) { snippets.add(candidate); break; }
      }
    }
  }

  const bytes = new Map<string, Uint8Array>();
  const missing = new Map<string, string>();
  const outside = new Map<string, string>();
  const queue = [...wanted.keys()];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (bytes.has(path) || skip(path)) continue;
    if (path.endsWith(".md")) continue;                            // a page, already a root
    if (!isInside(path)) { outside.set(path, wanted.get(path) ?? "the article"); continue; }
    if (!(await o.fs.exists(path))) { missing.set(path, wanted.get(path) ?? "the article"); continue; }
    const data = await o.fs.readBinary(path);
    bytes.set(path, data);
    if (!/\.(?:mjs|js)$/i.test(path)) continue;
    const text = new TextDecoder().decode(data);
    for (const m of text.matchAll(MODULE_SPECIFIER)) {
      const specifier = m[1]!;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const resolved = resolveRelative(path, specifier);
      if (!wanted.has(resolved)) { wanted.set(resolved, path); queue.push(resolved); }
    }
  }
  return { wanted, bytes, missing, outside, external, snippets };
}
