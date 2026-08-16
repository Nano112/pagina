/**
 * The server half of the editor's HTTP contract
 * (`docs/design/2026-08-17-editor-connectivity-laravel.md`), over a plain article folder.
 *
 * ```
 * GET    {base}/files                        → { files: [{ path, size, version, mtime }] }
 * GET    {base}/files/{path}                 → text or binary; ETag = version
 * PUT    {base}/files/{path} (If-Match: v)   → { version }        409 → { theirs, version }
 * DELETE {base}/files/{path}                 → 204
 * POST   {base}/upload  (multipart file,path?) → { path, url, version }
 * POST   {base}/rename  { from, to }         → { version }
 * POST   {base}/publish { manifest, pages, figures } → { publishedAt }
 * GET    {base}/events  (SSE)                → { type, path, version } frames
 * ```
 *
 * `@pagina/editor`'s `HttpBackend` is the reference client; nothing here may drift from it.
 * Versions are the sha1 of the file's bytes, so two servers handing out the same version for the
 * same content is a feature (a no-op write is not a conflict) and mtime jitter is not.
 */
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, rename as renameFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

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
}

/** Everything the editor writes that is not content lives here, and is never editable content. */
const PRIVATE_DIR = ".pagina";

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
 * separator or NUL.
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

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
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
 * Path safety is enforced in one place ({@link toRelPath} plus a final containment check), and
 * writes into `.pagina/` are refused: that directory is the editor's own output (published
 * renders), not content, and letting a `PUT` reach it would let the editor forge a publish.
 */
export function viteEditMiddleware(folder: string, opts: EditMiddlewareOptions = {}): EditMiddleware {
  const root = resolve(folder);
  const base = (opts.base ?? "/__pagina/edit").replace(/\/+$/, "");
  const siteBase = (opts.siteBase ?? "/").replace(/\/+$/, "");

  /** The absolute path of a folder-relative path, refusing anything that escapes the folder. */
  const abs = (rel: string): string => {
    const path = resolve(root, rel);
    const back = relative(root, path);
    if (back === "" || back.startsWith("..") || isAbsolute(back)) throw new HttpError(400, `illegal path: ${rel}`);
    return path;
  };

  const assertWritable = (rel: string): void => {
    if (rel === PRIVATE_DIR || rel.startsWith(`${PRIVATE_DIR}/`)) {
      throw new HttpError(403, `${PRIVATE_DIR}/ is written by publish, not by hand`);
    }
  };

  const readBytes = async (rel: string): Promise<Buffer | undefined> => {
    try { return await readFile(abs(rel)); } catch { return undefined; }
  };

  const listFiles = async (): Promise<{ path: string; size: number; version: string; mtime: string }[]> => {
    const out: { path: string; size: number; version: string; mtime: string }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        // Dotfiles (`.pagina/`, `.git/`, …) and `node_modules` are not article content.
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.isFile()) continue;
        const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
        out.push({
          path: relative(root, path).split("\\").join("/"),
          size: info.size,
          version: sha1(bytes),
          mtime: info.mtime.toISOString(),
        });
      }
    };
    await walk(root);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  };

  const writeThrough = async (rel: string, data: Uint8Array | string): Promise<string> => {
    const path = abs(rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return sha1(data);
  };

  // ---- SSE ----------------------------------------------------------------------------------
  const clients = new Set<ServerResponse>();
  let ownWatcher: FSWatcher | undefined;
  let subscribed = false;

  const broadcast = async (rel: string, kind: "changed" | "deleted"): Promise<void> => {
    if (clients.size === 0) return;
    if (rel.split("/").some((s) => s.startsWith(".") || s === "node_modules")) return;
    const bytes = kind === "changed" ? await readBytes(rel) : undefined;
    const frame = `data: ${JSON.stringify({
      type: bytes === undefined && kind === "changed" ? "deleted" : kind,
      path: rel,
      ...(bytes === undefined ? {} : { version: sha1(bytes) }),
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
        const bytes = await readBytes(rel);
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
        const text = (await readBody(req)).toString("utf8");
        const current = await readBytes(rel);
        const ifMatch = req.headers["if-match"];
        const expected = typeof ifMatch === "string" ? unquoteETag(ifMatch) : "";
        if (expected !== "" && expected !== "*") {
          const theirs = current === undefined ? "" : current.toString("utf8");
          const version = current === undefined ? "" : sha1(current);
          if (version !== expected) {
            sendJson(res, 409, { theirs, version, message: `${rel} changed on the server` });
            return;
          }
        }
        const version = await writeThrough(rel, text);
        res.setHeader("etag", `"${version}"`);
        sendJson(res, 200, { version });
        return;
      }

      if (method === "DELETE") {
        assertWritable(rel);
        const path = abs(rel);
        try { await stat(path); } catch { throw new HttpError(404, `no such file: ${rel}`); }
        await rm(path, { recursive: true, force: true });
        res.statusCode = 204;
        res.end();
        return;
      }

      throw new HttpError(405, `${method} not allowed on ${rest}`);
    }

    if (rest === "/rename" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as { from?: unknown; to?: unknown };
      if (typeof body.from !== "string" || typeof body.to !== "string") throw new HttpError(400, "rename needs { from, to }");
      const from = toRelPath(body.from, { decode: false });
      const to = toRelPath(body.to, { decode: false });
      assertWritable(from);
      assertWritable(to);
      const source = abs(from);
      const target = abs(to);
      try { await stat(source); } catch { throw new HttpError(404, `no such file: ${from}`); }
      await mkdir(dirname(target), { recursive: true });
      await renameFile(source, target);
      sendJson(res, 200, { version: sha1((await readBytes(to)) ?? Buffer.alloc(0)) });
      return;
    }

    if (rest === "/upload" && method === "POST") {
      const type = req.headers["content-type"] ?? "";
      const boundary = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(type);
      if (boundary === null) throw new HttpError(400, "upload expects multipart/form-data");
      const parts = parseMultipart(await readBody(req), boundary[1] ?? boundary[2] ?? "");
      const file = parts.find((p) => p.name === "file");
      if (file === undefined) throw new HttpError(400, "upload expects a `file` part");
      const given = parts.find((p) => p.name === "path")?.data.toString("utf8").trim();
      const rel = given === undefined || given === ""
        ? `media/${sanitiseName(file.filename ?? "upload.bin")}`
        : toRelPath(given, { decode: false });
      assertWritable(rel);
      const version = await writeThrough(rel, file.data);
      sendJson(res, 200, { path: rel, url: `${siteBase}/${rel}`, version });
      return;
    }

    if (rest === "/publish" && method === "POST") {
      const payload = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
        manifest?: unknown;
        pages?: Record<string, string>;
        figures?: Record<string, Record<string, string>>;
      };
      const out = join(root, PRIVATE_DIR, "rendered");
      await mkdir(join(out, "pages"), { recursive: true });
      await mkdir(join(out, "figures"), { recursive: true });
      await writeFile(join(out, "manifest.json"), JSON.stringify(payload.manifest ?? {}, null, 2));
      for (const [href, html] of Object.entries(payload.pages ?? {})) {
        // `/guide/tabs/` → `guide-tabs.html`, `/` → `index.html`: one flat, collision-free file
        // per page, which is all the Blade/`.pagina` consumer needs to look one up by href.
        const slug = href.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "index";
        await writeFile(join(out, "pages", `${sanitiseName(slug)}.html`), String(html));
      }
      for (const [id, themes] of Object.entries(payload.figures ?? {})) {
        for (const [theme, svg] of Object.entries(themes)) {
          await writeFile(join(out, "figures", `${sanitiseName(id)}.${sanitiseName(theme)}.svg`), String(svg));
        }
      }
      const publishedAt = new Date().toISOString();
      await writeFile(join(root, PRIVATE_DIR, "published.json"), JSON.stringify({ publishedAt }, null, 2));
      sendJson(res, 200, { publishedAt });
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
      if (res.headersSent) { res.end(); return; }
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, { message: error instanceof Error ? error.message : String(error) });
    });
  };
}
