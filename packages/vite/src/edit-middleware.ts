/**
 * The server half of the editor's HTTP contract
 * (`docs/design/2026-08-17-editor-connectivity-laravel.md`), over a plain article folder.
 *
 * ```
 * GET    {base}/files                        → { files: [{ path, size, version, mtime,
 *                                                          lastEditedBy?, lastEditedAt? }] }
 * GET    {base}/files/{path}                 → text or binary; ETag = version
 * PUT    {base}/files/{path} (If-Match: v)   → { version, lastEditedBy, lastEditedAt }
 *                                              409 → { theirs, version, by?, at? }
 *                            (If-Match: *)   → the file must already exist; 412 when it does not
 * DELETE {base}/files/{path}                 → 204
 * POST   {base}/upload  (multipart file,path?) → { path, url, version, lastEditedBy, lastEditedAt }
 * POST   {base}/rename  { from, to }         → { version, lastEditedBy, lastEditedAt }
 * POST   {base}/publish { manifest, pages, figures } → { publishedAt, publishedBy }
 * GET    {base}/history?path&limit           → { edits: [{ path, action, at, by, version, from? }] }
 * GET    {base}/events  (SSE)                → { type, path, version, by?, at? } frames
 * ```
 *
 * `@pagina/editor`'s `HttpBackend` is the reference client; nothing here may drift from it.
 * Versions are the sha1 of the file's bytes, so two servers handing out the same version for the
 * same content is a feature (a no-op write is not a conflict) and mtime jitter is not.
 *
 * **The author is never read from the request.** Not from the body, not from a header, not from the
 * query string — there is no code path here that looks. Every write is attributed to the identity
 * this middleware was constructed with, which is the security property the whole feature rests on:
 * a caller that names itself is making a claim, and a docs tool that believed it would let anyone
 * write as anyone. See {@link EditMiddlewareOptions.identity}.
 */
import { createHash, randomBytes } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename as renameFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Author } from "@pagina/core";
import {
  appendEditLog, attributionFor, latestByPath, osIdentity, readEditLog,
  type EditAction, type LoggedEdit,
} from "./edit-log.js";

/** A connect-style middleware, which is what `vite.middlewares.use` takes. */
export type EditMiddleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/**
 * The slice of chokidar's `FSWatcher` the SSE endpoint needs. `dev.ts` hands over Vite's own
 * watcher so the folder is not watched twice; standalone callers get an `fs.watch` fallback.
 */
export interface EditWatcher {
  on(event: "all", listener: (event: string, path: string) => void): unknown;
  off?(event: "all", listener: (event: string, path: string) => void): unknown;
}

export interface EditMiddlewareOptions {
  /** URL prefix the contract is mounted at. */
  readonly base?: string;
  /** Site base, used to turn an uploaded file's folder path into the URL a page can link to. */
  readonly siteBase?: string;
  /** Watcher to source SSE events from. Omitted → the middleware starts its own on first client. */
  readonly watcher?: EditWatcher;
  /**
   * Who every write through this middleware is attributed to.
   *
   * Configured here — by the person starting the server — rather than taken from the request,
   * because the request comes from a browser and a browser's claim about who is using it is worth
   * nothing. Defaults to the OS user; see {@link osIdentity}.
   *
   * A single-user dev server recording one name is the honest limit of what this can know. It has
   * no authentication, so it cannot tell two callers apart; what it can do is say who it *is*, and
   * that is enough to make the conflict banner name somebody.
   */
  readonly identity?: Author;
  /**
   * Keep the append-only edit log at `.pagina/edits.jsonl`, and serve `GET {base}/history` from it.
   * Default `true`.
   *
   * Turn it off and attribution goes with it: the log is where the listing's `lastEditedBy` comes
   * from, so a server with no log reports no authors and the editor's history panel disappears —
   * which is the documented way to run this without leaving a record on disk.
   */
  readonly history?: boolean;
}

/** Everything the editor writes that is not content lives here, and is never editable content. */
const PRIVATE_DIR = ".pagina";

/**
 * `GET /history` defaults and ceiling, matching `@pagina/editor`'s `historyLimit`.
 *
 * The ceiling is not a courtesy: the endpoint is reachable from a browser, and an unbounded `limit`
 * on a long-running server is a way to ask it to serialise its whole log into one response.
 */
const HISTORY_DEFAULT = 50;
const HISTORY_MAX = 500;

/** Request body caps. A `.md` page is kilobytes; the ceilings only stop a runaway or a prank. */
const LIMIT_TEXT = 5 * 1024 * 1024;
const LIMIT_JSON = 5 * 1024 * 1024;
const LIMIT_UPLOAD = 50 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".pdf": "application/pdf", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm",
  ".json": "application/json", ".zip": "application/zip",
};

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".yaml", ".yml", ".json", ".js", ".mjs", ".cjs", ".ts", ".css", ".html",
  ".txt", ".py", ".rs", ".toml", ".svg", ".xml", ".sh", ".php",
]);

const sha1 = (bytes: Uint8Array | string): string => createHash("sha1").update(bytes).digest("hex");

/** `"v"`, `W/"v"` and a bare `v` all mean version `v`; `*` means "any existing version". */
const unquoteETag = (raw: string): string => raw.trim().replace(/^W\//, "").replace(/^"|"$/g, "");

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * Turns the `{path}` part of a request into a folder-relative posix path, or throws.
 *
 * Segments are decoded individually (matching `HttpBackend`'s `encodePath`) and then checked
 * *after* decoding, so `..%2Fx` — which survives URL normalisation as a single segment — cannot
 * smuggle a traversal through. A decoded segment may never be `.`, `..`, empty, or contain a
 * separator or NUL. This is a *lexical* check only; symlinks are caught by the realpath
 * containment check in {@link viteEditMiddleware}.
 */
function toRelPath(raw: string, opts: { decode: boolean }): string {
  const segments: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "") continue;
    let seg: string;
    if (opts.decode) {
      try { seg = decodeURIComponent(part); } catch { throw new HttpError(400, `malformed path: ${raw}`); }
    } else { seg = part; }
    if (seg === "" || seg === "." || seg === ".." || /[/\\\0]/.test(seg)) {
      throw new HttpError(400, `illegal path: ${raw}`);
    }
    segments.push(seg);
  }
  if (segments.length === 0) throw new HttpError(400, "empty path");
  const rel = segments.join("/");
  if (isAbsolute(rel)) throw new HttpError(400, `illegal path: ${raw}`);
  return rel;
}

/** Dotfiles are not article content — not `.pagina/`, not `.git/`, not `.env`. */
function dotSegment(rel: string): string | undefined {
  return rel.split("/").find((seg) => seg.startsWith("."));
}

/**
 * The realpath of the deepest existing ancestor of `path`, with the not-yet-existing tail joined
 * back on. Resolving the *ancestor* rather than the path itself is what makes this usable for
 * writes: `media/new.png` does not exist yet, but `media/` may well be a symlink out of the folder.
 */
async function realAncestor(path: string): Promise<string> {
  const tail: string[] = [];
  let current = path;
  for (;;) {
    try { return join(await realpath(current), ...tail); } catch { /* keep walking up */ }
    const parent = dirname(current);
    if (parent === current) return path; // nothing on the chain exists; lexical answer is the best one
    tail.unshift(basename(current));
    current = parent;
  }
}

/** Filenames the editor invents (from an upload) are reduced to a safe, predictable shape. */
function sanitiseName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "");
  return cleaned === "" ? "upload.bin" : cleaned;
}

interface MultipartPart { readonly name: string; readonly filename?: string; readonly data: Buffer }

/**
 * A deliberately small `multipart/form-data` reader: the editor only ever sends one small file
 * and one short text field, so buffering the body and slicing on the boundary beats taking a
 * streaming parser as a dependency of every `pagina dev`.
 */
function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") break; // closing delimiter
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    // Skip the CRLF after the delimiter and drop the CRLF before the next one.
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    index = next;
    if (split === -1) continue;
    const headers = chunk.subarray(0, split).toString("utf8");
    const disposition = /^content-disposition:.*$/im.exec(headers)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) continue;
    parts.push({ name, data: chunk.subarray(split + 4), ...(filename === undefined ? {} : { filename }) });
  }
  return parts;
}

/** Buffers the request body, refusing anything over `limit` (both by header and while reading). */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, `request body of ${declared} bytes exceeds the ${limit}-byte limit`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, `request body exceeds the ${limit}-byte limit`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

/**
 * `viteEditMiddleware(folder)` — the HTTP contract above, served over `folder` with Node's fs.
 *
 * Three rules guard every path, in one place:
 *
 * 1. **Lexical**: {@link toRelPath} rejects `..`, absolute paths and separator smuggling.
 * 2. **Real**: the target's deepest existing ancestor is `realpath`'d and must sit inside the
 *    folder's own realpath — so a symlink *inside* the folder pointing out of it is not a way
 *    to read or write the rest of the disk.
 * 3. **Content**: no write, rename, upload or delete may touch a dotfile segment. That covers
 *    `.pagina/` (the editor's own publish output — a writable one would let the editor forge a
 *    publish), `.git/`, `.env`, and anything else the listing already refuses to show. Reads of
 *    dotfiles 404 for the same reason: if the client cannot discover it, it cannot address it.
 *
 * Writes are atomic: content goes to a sibling `.tmp` file and is `rename`d over the target, so a
 * crashed or truncated write can never leave a half-written page behind.
 */
export function viteEditMiddleware(folder: string, opts: EditMiddlewareOptions = {}): EditMiddleware {
  const root = resolve(folder);
  const base = (opts.base ?? "/__pagina/edit").replace(/\/+$/, "");
  const siteBase = (opts.siteBase ?? "/").replace(/\/+$/, "");
  // Resolved once, here, from configuration. There is deliberately no per-request equivalent.
  const identity = opts.identity ?? osIdentity();
  const keepHistory = opts.history !== false;

  /**
   * The log, re-read from disk on every question rather than cached.
   *
   * A cache read once at startup would be faster and would be wrong: this middleware is not
   * necessarily the only writer. Two `pagina dev --edit --as …` servers over one folder is exactly
   * how two people appear in one article, and each would have answered from its own half of the
   * log — reporting "unknown" for everything the other wrote, which is the one case the conflict
   * banner exists for. The file is small and the listing beside it already reads and hashes every
   * file in the folder, so this costs nothing worth keeping stale state for.
   */
  const log = (): Promise<LoggedEdit[]> => readEditLog(root);

  const record = async (entry: {
    path: string; action: EditAction; version: string; from?: string;
  }): Promise<{ lastEditedBy: Author; lastEditedAt: string } | undefined> => {
    if (!keepHistory) return undefined;
    const logged: LoggedEdit = {
      path: entry.path, action: entry.action, version: entry.version,
      at: new Date().toISOString(), by: identity,
      ...(entry.from === undefined ? {} : { from: entry.from }),
    };
    await appendEditLog(root, logged);
    return { lastEditedBy: logged.by, lastEditedAt: logged.at };
  };

  /** What the listing and the SSE frames report for a path, given the bytes currently on disk. */
  const attributionOf = async (path: string, version: string): Promise<
    { lastEditedBy: Author; lastEditedAt: string } | undefined
  > => {
    if (!keepHistory) return undefined;
    return attributionFor(latestByPath(await log()), path, version);
  };

  // The folder itself is often reached through a symlink (`/tmp` → `/private/tmp` on macOS), so
  // containment has to compare real path against real path or every request would look like an
  // escape. Resolved once, lazily, because the constructor is synchronous.
  let realRootOnce: Promise<string> | undefined;
  const realRoot = (): Promise<string> => (realRootOnce ??= realpath(root).catch(() => root));

  /** Lexically-safe absolute path (rule 1). */
  const abs = (rel: string): string => {
    const path = resolve(root, rel);
    const back = relative(root, path);
    if (back === "" || back.startsWith("..") || isAbsolute(back)) throw new HttpError(400, `illegal path: ${rel}`);
    return path;
  };

  /** Lexically safe *and* really inside the folder (rules 1 + 2). */
  const inside = async (rel: string): Promise<string> => {
    const path = abs(rel);
    const back = relative(await realRoot(), await realAncestor(path));
    if (back === "" || back.startsWith("..") || isAbsolute(back)) {
      throw new HttpError(403, `path escapes the article folder: ${rel}`);
    }
    return path;
  };

  /** Rule 3, for anything that mutates. */
  const assertWritable = (rel: string): void => {
    const dot = dotSegment(rel);
    if (dot === undefined) return;
    throw new HttpError(403, dot === PRIVATE_DIR
      ? `${PRIVATE_DIR}/ is written by publish, not by hand`
      : `dotfiles are not article content: ${rel}`);
  };

  /** Rule 3, for reads: a dotfile is never listed, so it is never addressable either. */
  const assertReadable = (rel: string): void => {
    if (dotSegment(rel) !== undefined) throw new HttpError(404, `no such file: ${rel}`);
  };

  /** Write-then-rename, so a reader never observes a partial file and an error leaves no debris. */
  const atomicWrite = async (path: string, data: Uint8Array | string): Promise<string> => {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temp, data, { flag: "wx" });
      await renameFile(temp, path); // atomic on POSIX; replaces the target in one step
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return sha1(data);
  };

  const writeContent = async (rel: string, data: Uint8Array | string): Promise<string> => {
    assertWritable(rel);
    return atomicWrite(await inside(rel), data);
  };

  /** Bytes of a content file, or `undefined` when it is absent. Escapes and dotfiles still throw. */
  const readContent = async (rel: string): Promise<Buffer | undefined> => {
    assertReadable(rel);
    const path = await inside(rel);
    try { return await readFile(path); } catch { return undefined; }
  };

  interface ListedFile {
    path: string; size: number; version: string; mtime: string;
    lastEditedBy?: Author; lastEditedAt?: string;
  }

  const listFiles = async (): Promise<ListedFile[]> => {
    const latest = keepHistory ? latestByPath(await log()) : undefined;
    const out: ListedFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        // Dotfiles (`.pagina/`, `.git/`, …) and `node_modules` are not article content.
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const path = join(dir, entry.name);
        // Dirents are lstat-shaped, so a symlink is neither `isFile` nor `isDirectory`: symlinks
        // are skipped outright rather than followed, which is the same answer the containment
        // check gives for a read of one, and avoids cycles into the bargain.
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.isFile()) continue;
        const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
        const rel = relative(root, path).split("\\").join("/");
        const version = sha1(bytes);
        out.push({
          path: rel,
          size: info.size,
          version,
          mtime: info.mtime.toISOString(),
          ...(latest === undefined ? {} : attributionFor(latest, rel, version) ?? {}),
        });
      }
    };
    await walk(root);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  };

  // ---- SSE ----------------------------------------------------------------------------------
  const clients = new Set<ServerResponse>();
  let ownWatcher: FSWatcher | undefined;
  let subscribed = false;

  const broadcast = async (rel: string, kind: "changed" | "deleted"): Promise<void> => {
    if (clients.size === 0) return;
    if (rel.split("/").some((s) => s.startsWith(".") || s === "node_modules")) return;
    const bytes = kind === "changed" ? await readContent(rel).catch(() => undefined) : undefined;
    const version = bytes === undefined ? undefined : sha1(bytes);
    // Attribution goes on the frame, not just on the listing, because the conflict an author
    // actually meets — a second tab saving under them — arrives here rather than as a 409. The
    // version gate in `attributionFor` still applies, so a change made by something other than
    // this middleware arrives anonymous, which is what it is.
    const whose = version === undefined ? undefined : await attributionOf(rel, version);
    const frame = `data: ${JSON.stringify({
      type: bytes === undefined && kind === "changed" ? "deleted" : kind,
      path: rel,
      ...(version === undefined ? {} : { version }),
      ...(whose === undefined ? {} : { by: whose.lastEditedBy, at: whose.lastEditedAt }),
    })}\n\n`;
    for (const client of clients) client.write(frame);
  };

  const relOf = (file: string): string | undefined => {
    const rel = relative(root, resolve(file));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
    return rel.split("\\").join("/");
  };

  const subscribe = (): void => {
    if (subscribed) return;
    subscribed = true;
    if (opts.watcher !== undefined) {
      opts.watcher.on("all", (event, file) => {
        const rel = relOf(file);
        if (rel === undefined) return;
        void broadcast(rel, event === "unlink" || event === "unlinkDir" ? "deleted" : "changed");
      });
      return;
    }
    try {
      ownWatcher = watch(root, { recursive: true }, (_event, file) => {
        if (file === null) return;
        void broadcast(String(file).split("\\").join("/"), "changed");
      });
      ownWatcher.unref();
    } catch { /* no watcher available: SSE stays open but silent, and the store polls nothing */ }
  };

  // ---- routes -------------------------------------------------------------------------------
  const handle = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const rest = url.pathname.slice(base.length);
    const method = req.method ?? "GET";

    if (rest === "/files" && (method === "GET" || method === "HEAD")) {
      sendJson(res, 200, { files: await listFiles() });
      return;
    }

    if (rest.startsWith("/files/")) {
      const rel = toRelPath(rest.slice("/files/".length), { decode: true });

      if (method === "GET" || method === "HEAD") {
        const bytes = await readContent(rel);
        if (bytes === undefined) throw new HttpError(404, `no such file: ${rel}`);
        const wantsText = url.searchParams.get("responseType") === "text"
          || (url.searchParams.get("responseType") !== "binary"
            && ((req.headers.accept ?? "").includes("text/plain") || TEXT_EXTENSIONS.has(extname(rel).toLowerCase())));
        res.statusCode = 200;
        res.setHeader("etag", `"${sha1(bytes)}"`);
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-type", wantsText
          ? "text/plain; charset=utf-8"
          : CONTENT_TYPES[extname(rel).toLowerCase()] ?? "application/octet-stream");
        if (method === "HEAD") res.end(); else res.end(bytes);
        return;
      }

      if (method === "PUT") {
        assertWritable(rel);
        const path = await inside(rel);
        const text = (await readBody(req, LIMIT_TEXT)).toString("utf8");
        let current: Buffer | undefined;
        try { current = await readFile(path); } catch { current = undefined; }
        const ifMatch = req.headers["if-match"];
        const expected = typeof ifMatch === "string" ? unquoteETag(ifMatch) : "";
        if (expected === "*") {
          // RFC 9110: `*` is "any current representation", i.e. the file must exist. When it does
          // not there is no `theirs` and no `version` to hand back, so a 409 conflict body would
          // be a lie about what the server holds — a 412 with a message is the honest answer, and
          // it is what the Laravel implementation of this contract returns.
          if (current === undefined) {
            sendJson(res, 412, { message: `${rel} does not exist` });
            return;
          }
        } else if (expected !== "" && (current === undefined || sha1(current) !== expected)) {
          const theirVersion = current === undefined ? "" : sha1(current);
          // Who they were, when we know: this is what turns "index.md changed on the server" into
          // "Alice changed index.md two minutes ago" in the editor's banner.
          const whose = current === undefined ? undefined : await attributionOf(rel, theirVersion);
          sendJson(res, 409, {
            theirs: current === undefined ? "" : current.toString("utf8"),
            version: theirVersion,
            message: `${rel} changed on the server`,
            ...(whose === undefined ? {} : { by: whose.lastEditedBy, at: whose.lastEditedAt }),
          });
          return;
        }
        const version = await atomicWrite(path, text);
        // Recorded *after* the write lands, so the log never claims an edit that did not happen.
        // The identity is the middleware's, and nothing in `req` was consulted to choose it.
        const attribution = await record({ path: rel, action: "write", version });
        res.setHeader("etag", `"${version}"`);
        sendJson(res, 200, { version, ...attribution });
        return;
      }

      if (method === "DELETE") {
        assertWritable(rel);
        const path = await inside(rel);
        try { await stat(path); } catch { throw new HttpError(404, `no such file: ${rel}`); }
        await rm(path, { recursive: true, force: true });
        await record({ path: rel, action: "delete", version: "" });
        res.statusCode = 204;
        res.end();
        return;
      }

      throw new HttpError(405, `${method} not allowed on ${rest}`);
    }

    if (rest === "/rename" && method === "POST") {
      const body = JSON.parse((await readBody(req, LIMIT_JSON)).toString("utf8") || "{}") as { from?: unknown; to?: unknown };
      if (typeof body.from !== "string" || typeof body.to !== "string") throw new HttpError(400, "rename needs { from, to }");
      const from = toRelPath(body.from, { decode: false });
      const to = toRelPath(body.to, { decode: false });
      assertWritable(from);
      assertWritable(to);
      const source = await inside(from);
      const target = await inside(to);
      try { await stat(source); } catch { throw new HttpError(404, `no such file: ${from}`); }
      await mkdir(dirname(target), { recursive: true });
      await renameFile(source, target);
      const version = sha1((await readContent(to)) ?? Buffer.alloc(0));
      const attribution = await record({ path: to, action: "rename", version, from });
      sendJson(res, 200, { version, ...attribution });
      return;
    }

    if (rest === "/upload" && method === "POST") {
      const type = req.headers["content-type"] ?? "";
      const boundary = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(type);
      if (boundary === null) throw new HttpError(400, "upload expects multipart/form-data");
      const parts = parseMultipart(await readBody(req, LIMIT_UPLOAD), boundary[1] ?? boundary[2] ?? "");
      const file = parts.find((p) => p.name === "file");
      if (file === undefined) throw new HttpError(400, "upload expects a `file` part");
      const given = parts.find((p) => p.name === "path")?.data.toString("utf8").trim();
      const rel = given === undefined || given === ""
        ? `media/${sanitiseName(file.filename ?? "upload.bin")}`
        : toRelPath(given, { decode: false });
      const version = await writeContent(rel, file.data);
      const attribution = await record({ path: rel, action: "upload", version });
      sendJson(res, 200, { path: rel, url: `${siteBase}/${rel}`, version, ...attribution });
      return;
    }

    if (rest === "/publish" && method === "POST") {
      const payload = JSON.parse((await readBody(req, LIMIT_JSON)).toString("utf8") || "{}") as {
        manifest?: unknown;
        pages?: Record<string, string>;
        figures?: Record<string, Record<string, string>>;
      };
      // The only writer allowed into `.pagina/`, and still containment-checked: a symlinked
      // `.pagina` would otherwise be a way to scatter files across the disk.
      const privateDir = await inside(PRIVATE_DIR);
      const out = join(privateDir, "rendered");
      await mkdir(join(out, "pages"), { recursive: true });
      await mkdir(join(out, "figures"), { recursive: true });
      await atomicWrite(join(out, "manifest.json"), JSON.stringify(payload.manifest ?? {}, null, 2));
      for (const [href, html] of Object.entries(payload.pages ?? {})) {
        // `/guide/tabs/` → `guide-tabs.html`, `/` → `index.html`: one flat, collision-free file
        // per page, which is all the Blade/`.pagina` consumer needs to look one up by href.
        const slug = href.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "index";
        await atomicWrite(join(out, "pages", `${sanitiseName(slug)}.html`), String(html));
      }
      for (const [id, themes] of Object.entries(payload.figures ?? {})) {
        for (const [theme, svg] of Object.entries(themes)) {
          await atomicWrite(join(out, "figures", `${sanitiseName(id)}.${sanitiseName(theme)}.svg`), String(svg));
        }
      }
      // Publishing is an edit too, and it is the one a reader's page is attributed to — so it goes
      // into `published.json` beside the timestamp, and into the log beside everything else.
      const record_: { publishedAt: string; publishedBy?: Author } = {
        publishedAt: new Date().toISOString(),
        ...(keepHistory ? { publishedBy: identity } : {}),
      };
      await atomicWrite(join(privateDir, "published.json"), JSON.stringify(record_, null, 2));
      const slug = (payload.manifest as { article?: { slug?: unknown } } | undefined)?.article?.slug;
      await record({
        path: typeof slug === "string" && slug !== "" ? slug : "article",
        action: "publish", version: "",
      });
      sendJson(res, 200, record_);
      return;
    }

    if (rest === "/history" && (method === "GET" || method === "HEAD")) {
      // Absent, not empty. A server that keeps no log must not answer as though it kept one and
      // nothing had happened — the editor decides whether the panel exists from this.
      if (!keepHistory) throw new HttpError(404, "this server keeps no edit history");
      const wanted = url.searchParams.get("path") ?? undefined;
      const asked = Number(url.searchParams.get("limit") ?? NaN);
      const limit = Number.isFinite(asked) ? Math.max(0, Math.min(HISTORY_MAX, Math.floor(asked))) : HISTORY_DEFAULT;
      const all = await log();
      const matching = wanted === undefined
        ? all
        : all.filter((e) => e.path === wanted || e.from === wanted);
      sendJson(res, 200, { edits: matching.slice(Math.max(0, matching.length - limit)).reverse() });
      return;
    }

    if (rest === "/events" && method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Nginx and friends buffer unknown streams into uselessness without this.
        "x-accel-buffering": "no",
      });
      res.write(": pagina edit events\n\nretry: 2000\n\n");
      clients.add(res);
      subscribe();
      req.on("close", () => { clients.delete(res); });
      return;
    }

    throw new HttpError(404, `no such endpoint: ${rest || "/"}`);
  };

  return (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) { next(); return; }
    void handle(req, res, url).catch((error: unknown) => {
      // Answering before the body is drained resets the connection, and the client sees a
      // transport error instead of the 413 that explains it. Discard the rest, then reply.
      if (!req.readableEnded) req.resume();
      if (res.headersSent) { res.end(); return; }
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, { message: error instanceof Error ? error.message : String(error) });
    });
  };
}
