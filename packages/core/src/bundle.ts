/**
 * The article bundle format: what goes in one, and what a host must check before trusting one.
 *
 * A bundle is an article folder made portable — one file, everything the pages actually reference
 * inside it, importable into any pagina host without the machine that built it. It is **built, not
 * zipped**: `--8<--` includes reach outside the folder by design, a docs directory holds plenty
 * that is not part of the article, and pages reference a fraction of `media/`. So the pack step
 * resolves rather than copies, and what comes out has no way to reach outside itself.
 *
 * This module is the half that is pure: the layout, `bundle.json`'s schema, the path policy, the
 * size limits, and the verification a host runs on an archive it did not build. The archive codec
 * and the filesystem live in `@pagina/vite`, so a host can validate a bundle it decoded itself
 * without pulling in a builder.
 */
import { parseDocument } from "yaml";
import type { ArticleConfig, ContentFs, Diagnostic, Manifest, RenderedArticle } from "./types.js";
import { pageSlug } from "./render-page.js";
import { SNIPPET_DIRECTIVE, joinPosix } from "./plugins/snippets.js";
import { walkReferences } from "./references.js";

/**
 * The bundle format version.
 *
 * Bumped when an importer that understands version N would get a *wrong* article out of a
 * version N+1 bundle. A host refuses a format it does not know rather than guessing.
 */
export const BUNDLE_FORMAT = 1;

/** The name of the descriptor every bundle carries, at its root. */
export const BUNDLE_MANIFEST_PATH = "bundle.json";

/** Where the pre-rendered output travels, so a host can serve the article without running Node. */
export const BUNDLE_RENDERED_DIR = ".rendered";

/** One file in a bundle, and the two facts that let an importer prove it arrived intact. */
export interface BundleFileRecord {
  /** Bundle-relative posix path. Never absolute, never containing `..`. */
  readonly path: string;
  /** Size in bytes of the file's contents. */
  readonly size: number;
  /** Lowercase hex SHA-256 of the file's contents. */
  readonly sha256: string;
}

/**
 * `bundle.json` — the descriptor at the root of every bundle.
 *
 * `created` is deliberately **not** covered by any checksum: it is the one field that changes when
 * nothing else did, and a bundle whose bytes differ run to run cannot be diffed or cached. `pack`
 * takes it as an option so a reproducible build can pin it.
 */
export interface BundleManifest {
  readonly format: number;
  /** The version of pagina that packed this bundle, for a host that needs to reason about it. */
  readonly pagina: string;
  /** ISO-8601 instant the bundle was packed. Injectable; not part of any checksum. */
  readonly created: string;
  /** The article's slug, from `article.yaml` — what a host imports it as. */
  readonly slug: string;
  readonly title: string;
  /** The site base the `.rendered/` output was rendered at. */
  readonly base: string;
  /** The sum of every record's `size`. Checked against the archive, so a lie is a refusal. */
  readonly totalSize: number;
  /** Every file in the bundle except `bundle.json` itself, sorted by path. */
  readonly files: readonly BundleFileRecord[];
  /**
   * Absolute `http(s)` references the pages make.
   *
   * A bundle cannot inline the internet, so these are left alone — but they are reported, so an
   * author knows exactly which parts of their article will not survive an air gap.
   */
  readonly external: readonly string[];
}

/** One decoded archive member, before anything has been written to disk. */
export interface BundleEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

/**
 * The caps an importer applies to an archive from elsewhere.
 *
 * Every one of them is checked against what the archive *declares* before a byte is decompressed,
 * and again against what it actually produced. A bundle that lies about its size is refused for
 * lying, not for being big.
 */
export interface BundleLimits {
  readonly maxEntries: number;
  readonly maxFileSize: number;
  readonly maxTotalSize: number;
  /** Uncompressed bytes per archive byte. Above this, the archive is a bomb, not a bundle. */
  readonly maxRatio: number;
}

export const DEFAULT_BUNDLE_LIMITS: BundleLimits = {
  maxEntries: 5_000,
  maxFileSize: 64 * 1024 * 1024,
  maxTotalSize: 256 * 1024 * 1024,
  maxRatio: 200,
};

/** Every way a bundle can be refused, as a machine-readable code. */
export type BundleErrorCode =
  | "bundle-format"          // not a bundle, or a format version this pagina does not know
  | "bundle-manifest"        // `bundle.json` missing or malformed
  | "bundle-path"            // an entry name that traverses, is absolute, or is otherwise unsafe
  | "bundle-symlink"         // an entry that is not a regular file
  | "bundle-entry-count"     // more members than the limit allows
  | "bundle-size"            // a file, or the whole bundle, over the cap — or not the declared size
  | "bundle-ratio"           // compression ratio above the cap
  | "bundle-checksum"        // a file whose contents do not match its record
  | "bundle-extra-entry"     // a member `bundle.json` does not account for
  | "bundle-missing-entry"   // a record with no member
  | "bundle-destination";    // the destination is occupied and no explicit choice was made

/** A refusal. Carries a code so a host can tell "not a bundle" from "a bundle that lied". */
export class BundleError extends Error {
  constructor(readonly code: BundleErrorCode, message: string) {
    super(`pagina bundle: ${message}`);
    this.name = "BundleError";
  }
}

// ---------------------------------------------------------------------------------------------
// The path policy
// ---------------------------------------------------------------------------------------------

/**
 * Segments Windows refuses to have a file named after, in any case and with any extension.
 *
 * A bundle packed on macOS and unpacked on a Linux server is the common case, but a bundle
 * unpacked on Windows must not fail halfway through writing, so a name that cannot exist there
 * is refused at the boundary rather than discovered at file 40 of 60.
 */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
// eslint-disable-next-line no-control-regex -- refusing control characters is exactly the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DRIVE_LETTER = /^[a-z]:/i;

/**
 * Is this a name a bundle may contain, and a destination may be given?
 *
 * The rule is deliberately narrow: a relative posix path, no `.` or `..` segments, no backslashes
 * (which are a path separator on the machine this may be unpacked on, and a legal filename
 * character on the one that packed it), no drive letters, no control characters, no trailing
 * slash. Anything outside that is refused — the *whole bundle*, not the entry, because an archive
 * carrying one traversing name is not an archive with a bad file in it, it is an attack.
 */
export function isSafeBundlePath(path: string): boolean {
  if (path === "" || path.length > 1024) return false;
  if (path.includes("\\")) return false;
  if (CONTROL_CHARS.test(path)) return false;
  if (path.startsWith("/")) return false;
  if (DRIVE_LETTER.test(path)) return false;
  if (path.endsWith("/")) return false;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return false;
    if (WINDOWS_RESERVED.test(segment)) return false;
    // A trailing dot or space is stripped by Windows, which turns two distinct entries into one
    // silent overwrite.
    if (segment.endsWith(".") || segment.endsWith(" ")) return false;
  }
  return true;
}

/** {@link isSafeBundlePath}, as a refusal. */
export function assertSafeBundlePath(path: string, what = "entry"): void {
  if (!isSafeBundlePath(path))
    throw new BundleError("bundle-path", `${what} "${path}" is not a safe bundle path`);
}

// ---------------------------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------------------------

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Lowercase hex SHA-256, over Web Crypto so this module stays environment-agnostic. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  // A fresh copy: `crypto.subtle` wants an `ArrayBuffer`, and a view into a larger pool would
  // otherwise hash its neighbours.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  let out = "";
  for (const byte of new Uint8Array(digest)) out += HEX[byte];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading a descriptor
// ---------------------------------------------------------------------------------------------

function need(condition: boolean, message: string): void {
  if (!condition) throw new BundleError("bundle-manifest", message);
}

const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Parses and validates `bundle.json`.
 *
 * Every field is checked, because this object is the only thing standing between an importer and
 * an archive that told it what to believe.
 */
export function parseBundleManifest(text: string): BundleManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BundleError("bundle-manifest", "bundle.json is not valid JSON");
  }
  need(raw !== null && typeof raw === "object" && !Array.isArray(raw), "bundle.json must be an object");
  const o = raw as Record<string, unknown>;
  if (typeof o["format"] !== "number" || !Number.isInteger(o["format"]))
    throw new BundleError("bundle-format", "bundle.json has no integer `format`");
  if (o["format"] !== BUNDLE_FORMAT)
    throw new BundleError("bundle-format", `format ${String(o["format"])} is not supported (this pagina reads ${String(BUNDLE_FORMAT)})`);
  for (const key of ["pagina", "created", "slug", "title", "base"])
    need(typeof o[key] === "string" && o[key] !== "", `bundle.json \`${key}\` must be a non-empty string`);
  need(typeof o["totalSize"] === "number" && Number.isInteger(o["totalSize"]) && o["totalSize"] >= 0, "bundle.json `totalSize` must be a non-negative integer");
  need(Array.isArray(o["files"]), "bundle.json `files` must be an array");
  need(Array.isArray(o["external"]), "bundle.json `external` must be an array");
  const seen = new Set<string>();
  const files = (o["files"] as unknown[]).map((entry, i) => {
    need(entry !== null && typeof entry === "object" && !Array.isArray(entry), `bundle.json files[${String(i)}] must be an object`);
    const f = entry as Record<string, unknown>;
    need(typeof f["path"] === "string", `bundle.json files[${String(i)}].path must be a string`);
    const path = f["path"] as string;
    assertSafeBundlePath(path, `bundle.json files[${String(i)}].path`);
    need(path !== BUNDLE_MANIFEST_PATH, "bundle.json may not list itself");
    need(!seen.has(path), `bundle.json lists ${path} twice`);
    seen.add(path);
    need(typeof f["size"] === "number" && Number.isInteger(f["size"]) && f["size"] >= 0, `bundle.json files[${String(i)}].size must be a non-negative integer`);
    need(typeof f["sha256"] === "string" && SHA256_RE.test(f["sha256"] as string), `bundle.json files[${String(i)}].sha256 must be a hex SHA-256`);
    return { path, size: f["size"] as number, sha256: f["sha256"] as string };
  });
  const external = (o["external"] as unknown[]).map((u, i) => {
    need(typeof u === "string", `bundle.json external[${String(i)}] must be a string`);
    return u as string;
  });
  return {
    format: BUNDLE_FORMAT,
    pagina: o["pagina"] as string,
    created: o["created"] as string,
    slug: o["slug"] as string,
    title: o["title"] as string,
    base: o["base"] as string,
    totalSize: o["totalSize"] as number,
    files,
    external,
  };
}

// ---------------------------------------------------------------------------------------------
// Verifying an archive
// ---------------------------------------------------------------------------------------------

export interface VerifyBundleOptions {
  readonly manifest: BundleManifest;
  /** Every decoded member except `bundle.json`. */
  readonly entries: readonly BundleEntry[];
  /** Size of the archive on disk, for the ratio check. */
  readonly archiveSize: number;
  readonly limits?: BundleLimits;
}

/**
 * Everything an importer must be satisfied of before it writes a single byte.
 *
 * Order matters: the cheap structural checks run before the checksums, so a bomb is refused
 * without hashing 256 MB of it, and the entry set is reconciled in *both* directions — a member
 * `bundle.json` does not account for is as much of a problem as a record with no member, because
 * the unaccounted one is the one nobody checksummed.
 */
export async function verifyBundleEntries(o: VerifyBundleOptions): Promise<void> {
  const limits = o.limits ?? DEFAULT_BUNDLE_LIMITS;
  if (o.entries.length > limits.maxEntries)
    throw new BundleError("bundle-entry-count", `${String(o.entries.length)} entries exceeds the limit of ${String(limits.maxEntries)}`);

  const byPath = new Map<string, BundleEntry>();
  for (const entry of o.entries) {
    assertSafeBundlePath(entry.path);
    if (byPath.has(entry.path)) throw new BundleError("bundle-path", `two entries named ${entry.path}`);
    byPath.set(entry.path, entry);
  }
  const recorded = new Set(o.manifest.files.map((f) => f.path));
  for (const path of byPath.keys())
    if (!recorded.has(path)) throw new BundleError("bundle-extra-entry", `${path} is in the archive but not in bundle.json`);
  for (const path of recorded)
    if (!byPath.has(path)) throw new BundleError("bundle-missing-entry", `bundle.json lists ${path}, which the archive does not contain`);

  let total = 0;
  for (const record of o.manifest.files) {
    if (record.size > limits.maxFileSize)
      throw new BundleError("bundle-size", `${record.path} declares ${String(record.size)} bytes, over the ${String(limits.maxFileSize)}-byte file limit`);
    total += record.size;
  }
  if (total !== o.manifest.totalSize)
    throw new BundleError("bundle-size", `bundle.json declares totalSize ${String(o.manifest.totalSize)} but its records sum to ${String(total)}`);
  if (total > limits.maxTotalSize)
    throw new BundleError("bundle-size", `${String(total)} uncompressed bytes exceeds the limit of ${String(limits.maxTotalSize)}`);
  // Prose and SVG compress three- to eightfold; 200:1 is not a well-packed article, it is a file
  // of zeros with a manifest on top.
  if (o.archiveSize > 0 && total / o.archiveSize > limits.maxRatio)
    throw new BundleError("bundle-ratio", `compression ratio ${(total / o.archiveSize).toFixed(1)}:1 exceeds the limit of ${String(limits.maxRatio)}:1`);

  for (const record of o.manifest.files) {
    const entry = byPath.get(record.path)!;
    if (entry.data.byteLength !== record.size)
      throw new BundleError("bundle-size", `${record.path} is ${String(entry.data.byteLength)} bytes but bundle.json declares ${String(record.size)}`);
    const actual = await sha256Hex(entry.data);
    if (actual !== record.sha256)
      throw new BundleError("bundle-checksum", `${record.path} has checksum ${actual}, but bundle.json declares ${record.sha256}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Building a bundle's contents
// ---------------------------------------------------------------------------------------------

/** The pre-rendered output that travels with the source, keyed the way `publish` already keys it. */
export interface RenderedOutput {
  readonly manifest: Manifest;
  /** Page href → the page's HTML fragment, figures already inlined. */
  readonly pages: Readonly<Record<string, string>>;
  /** Figure id → theme name → the standalone SVG. */
  readonly figures: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface BuildBundleOptions {
  /** Rooted at the article folder. Snippet roots may reach outside it; nothing else may. */
  readonly fs: ContentFs;
  readonly article: RenderedArticle;
  readonly config: ArticleConfig;
  /** `article.yaml` as written, so its comments and key order survive the rewrite. */
  readonly articleYaml: string;
  readonly rendered: RenderedOutput;
  readonly base: string;
  readonly pagina: string;
  readonly created: string;
  /** Report rather than throw. Default `false`: pack refuses rather than guesses. */
  readonly strict?: boolean;
}

export interface BuiltBundle {
  /** Every file of the bundle, `bundle.json` last, sorted by path. */
  readonly entries: readonly BundleEntry[];
  readonly manifest: BundleManifest;
  readonly diagnostics: readonly Diagnostic[];
}


const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);


/** The declared snippet roots, normalised to folder-relative posix paths (`"."` becomes `""`). */
function normaliseRoots(roots: readonly string[]): string[] {
  return roots.map((r) => joinPosix(r));
}

/**
 * Which declared root a resolved snippet lives under — the deepest one, so that a folder listed
 * alongside its parent wins and the copied path stays short.
 */
function containingRoot(candidate: string, roots: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    const inside = root === "" ? !candidate.startsWith("../") : candidate === root || candidate.startsWith(`${root}/`);
    if (!inside) continue;
    if (best === undefined || root.length > best.length) best = root;
  }
  return best;
}

/**
 * Resolves an article folder into the exact set of files a bundle carries.
 *
 * The walk starts at the nav, because the nav is the page list, and reaches only what those pages
 * actually reference: their assets, their figures' scene modules and whatever those import, the
 * covers the manifest resolved, and the snippets the pages include — wherever those live. A
 * reference that cannot be resolved is an error, not a pruned entry, because a bundle that
 * imports cleanly and renders wrong is worse than one that fails to build.
 */
export async function buildBundleContents(o: BuildBundleOptions): Promise<BuiltBundle> {
  const strict = o.strict ?? true;
  const diagnostics: Diagnostic[] = [];
  /** Bundle path → the bytes that go there. */
  const files = new Map<string, Uint8Array>();
  const external = new Set<string>();

  const add = (path: string, data: Uint8Array, what: string): void => {
    assertSafeBundlePath(path, what);
    const existing = files.get(path);
    if (existing !== undefined && (existing.byteLength !== data.byteLength || !existing.every((b, i) => b === data[i]))) {
      diagnostics.push({ severity: "error", code: "bundle-collision", message: `two different files both want to be ${path} in the bundle` });
      return;
    }
    files.set(path, data);
  };

  // ---- 1. the pages, with their snippet directives pointed inside the bundle ------------------
  const roots = normaliseRoots(o.config.snippets.roots);
  for (const page of Object.values(o.article.pages)) {
    assertSafeBundlePath(page.path, "page");
    const source = await o.fs.read(page.path);
    const lines = source.split(/\r?\n/);
    const rewritten: string[] = [];
    for (const line of lines) {
      const m = SNIPPET_DIRECTIVE.exec(line);
      if (m === null) { rewritten.push(line); continue; }
      const [, indent, ref] = m as unknown as [string, string, string];
      const cut = ref.indexOf(":");
      const refPath = cut === -1 ? ref : ref.slice(0, cut);
      const section = cut === -1 ? "" : ref.slice(cut);
      let found: string | undefined;
      for (const root of roots) {
        const candidate = joinPosix(root, refPath);
        if (await o.fs.exists(candidate)) { found = candidate; break; }
      }
      if (found === undefined) {
        diagnostics.push({ severity: "error", code: "bundle-snippet-missing", message: `--8<-- "${ref}" is not in roots [${o.config.snippets.roots.join(", ")}]`, page: page.path });
        rewritten.push(line);
        continue;
      }
      // Found is not the same as allowed: `joinPosix(".", "../secrets")` resolves, and the
      // declared roots are exactly the fence that says it must not.
      const root = containingRoot(found, roots);
      if (root === undefined) {
        diagnostics.push({ severity: "error", code: "bundle-snippet-outside-roots", message: `--8<-- "${ref}" resolves to ${found}, which is outside the declared roots [${o.config.snippets.roots.join(", ")}]`, page: page.path });
        rewritten.push(line);
        continue;
      }
      // Inside the folder it keeps its path; from outside it is copied under `snippets/`, named
      // relative to the root that contained it, so two roots cannot silently rename one file.
      const target = root === "" ? found : joinPosix("snippets", found.slice(root.length + 1));
      add(target, bytes(await o.fs.read(found)), `snippet "${ref}"`);
      rewritten.push(`${indent}--8<-- "${target}${section}"`);
    }
    add(page.path, bytes(rewritten.join("\n")), "page");
  }

  // ---- 2. article.yaml, with its snippet roots collapsed --------------------------------------
  // Only when it would change something: re-serialising a YAML document normalises whitespace the
  // author chose, and a bundle of a folder that already resolves its snippets inside itself should
  // carry that folder's `article.yaml` byte for byte.
  const collapsed = roots.length === 1 && roots[0] === "";
  let yaml = o.articleYaml;
  if (!collapsed) {
    const doc = parseDocument(o.articleYaml);
    doc.setIn(["snippets", "roots"], ["."]);
    yaml = doc.toString();
  }
  add("article.yaml", bytes(yaml), "article.yaml");

  // ---- 3. everything the pages reference -------------------------------------------------------
  // The walk itself is `references.ts`, shared with the static build. It used to live here, and
  // the static build had no walk at all — it copied the folder — so the two disagreed about what
  // an article contains, and the bundle's containment was an accident of portability rather than
  // a property either of them promised.
  const walk = await walkReferences({
    fs: o.fs,
    article: o.article.pages,
    manifest: o.rendered.manifest,
    config: o.config,
    base: o.base,
    // Already added above, with their snippet directives rewritten; re-reading a page here would
    // offer different bytes for a path the bundle already holds.
    skip: (path) => files.has(path),
    isInside: isSafeBundlePath,
  });
  for (const url of walk.external) external.add(url);
  for (const [path, why] of walk.outside)
    diagnostics.push({ severity: "error", code: "bundle-asset-outside", message: `${why} references ${path}, which is outside the folder` });
  for (const [path, why] of walk.missing)
    diagnostics.push({ severity: "error", code: "bundle-asset-missing", message: `${why} references ${path}, which does not exist` });
  for (const [path, data] of walk.bytes) add(path, data, "asset");

  // ---- 4. the pre-rendered output ---------------------------------------------------------------
  // `assets` is re-derived from what the bundle actually holds rather than carried over from the
  // folder's own render. The manifest a host serves must describe the bundle it is serving: the
  // source folder's list names files that were left behind, and misses the snippets that were
  // pulled in. Re-deriving it by the same rule the renderer uses is also what makes packing
  // idempotent — pack, unpack, pack again, and the bytes match.
  const isAsset = (p: string): boolean => !/\.md$/i.test(p) && p !== "article.yaml" && !p.split("/").some((s) => s.startsWith("."));
  const manifestJson: Manifest = { ...o.rendered.manifest, assets: [...files.keys()].filter(isAsset).sort() };
  add(`${BUNDLE_RENDERED_DIR}/manifest.json`, bytes(`${JSON.stringify(manifestJson, null, 2)}\n`), "rendered manifest");
  for (const [href, html] of Object.entries(o.rendered.pages))
    add(`${BUNDLE_RENDERED_DIR}/pages/${pageSlug(href)}.html`, bytes(html), "rendered page");
  for (const [id, themes] of Object.entries(o.rendered.figures))
    for (const [theme, svg] of Object.entries(themes))
      add(`${BUNDLE_RENDERED_DIR}/figures/${id}.${theme}.svg`, bytes(svg), "rendered figure");

  for (const url of external)
    diagnostics.push({ severity: "warning", code: "bundle-external-ref", message: `${url} is outside the bundle and will not survive an air gap` });

  if (strict && diagnostics.some((d) => d.severity === "error")) throw new BundleError("bundle-format", diagnostics.filter((d) => d.severity === "error").map((d) => `[${d.code}] ${d.page ?? ""}: ${d.message}`).join("\n"));

  // Sorted, so that two packs of one folder produce one byte sequence and a bundle can be diffed.
  const sorted = [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const records: BundleFileRecord[] = [];
  for (const [path, data] of sorted) records.push({ path, size: data.byteLength, sha256: await sha256Hex(data) });
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    pagina: o.pagina,
    created: o.created,
    slug: o.config.slug,
    title: o.config.title,
    base: o.base,
    totalSize: records.reduce((n, r) => n + r.size, 0),
    files: records,
    external: [...external].sort(),
  };
  const entries: BundleEntry[] = sorted.map(([path, data]) => ({ path, data }));
  entries.push({ path: BUNDLE_MANIFEST_PATH, data: bytes(`${JSON.stringify(manifest, null, 2)}\n`) });
  return { entries, manifest, diagnostics };
}
