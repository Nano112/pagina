/**
 * The pagina editor's HTTP contract, implemented as a Cloudflare Worker over R2.
 *
 * ```
 * GET    {base}/{slug}/files                       → { files: [{ path, size, version, mtime,
 *                                                                lastEditedBy?, lastEditedAt? }] }
 * GET    {base}/{slug}/files/{path}                → bytes; ETag = version
 * PUT    {base}/{slug}/files/{path} (If-Match: v)  → { version, lastEditedBy, lastEditedAt }
 *                                                    409 → { theirs, version, by, at }
 *                                  (If-Match: *)   → 412 when the file is not there
 * DELETE {base}/{slug}/files/{path}                → 204
 * POST   {base}/{slug}/upload   (multipart)        → { path, url, version, lastEditedBy, lastEditedAt }
 * POST   {base}/{slug}/rename   { from, to }       → { version, lastEditedBy, lastEditedAt }
 * POST   {base}/{slug}/publish  { manifest, pages, figures } → { publishedAt, publishedBy }
 * GET    {base}/{slug}/history?path&limit          → { edits: [{ path, action, at, by, version, from? }] }
 * GET    {base}/{slug}/events                      → SSE frames
 *
 * GET    /rendered/{slug}/{path}                   → published bytes, public, no token
 * ```
 *
 * The contract is specified in `docs/design/2026-08-17-editor-connectivity-laravel.md`;
 * `@pagina/editor`'s `HttpBackend` is the reference client and nothing here may drift from it.
 *
 * **Why a Worker can do this at all.** Publishing renders in the browser: the editor loads
 * `@pagina/core`, renders every page and figure, and POSTs the result. Nothing on this side parses
 * markdown, runs a build, or needs Node. It stores bytes and hands them back.
 *
 * **The author is never read from the request.** Not from the body, not from a query parameter,
 * not from an `X-Author` header — there is no code path here that looks. Every write is attributed
 * to the identity the presented token maps to, which is the security property the whole feature
 * rests on: a caller that names itself is making a claim, and a claim is forgeable.
 */
import { ArticleEvents } from "./events.js";
import type {
  Author, Env, R2BucketLike, R2ListOptions, R2ObjectLike,
} from "./bindings.js";

export { ArticleEvents };

/** Request body caps. A page is kilobytes; these only stop a runaway or a prank. */
const LIMIT_TEXT = 5 * 1024 * 1024;
const LIMIT_JSON = 8 * 1024 * 1024;
const LIMIT_UPLOAD = 25 * 1024 * 1024;

/** `GET /history` defaults and ceiling, matching `@pagina/editor`'s `historyLimit`. */
const HISTORY_DEFAULT = 50;
const HISTORY_MAX = 500;

/**
 * How many logged edits a `?path=`-filtered history will look through before giving up.
 *
 * R2 has no index but the key, so filtering by path is a scan. Bounding it is what stops one
 * request from paging an article's entire history into a Worker's 128 MB.
 */
const HISTORY_SCAN = 2000;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  pdf: "application/pdf", glb: "model/gltf-binary", gltf: "model/gltf+json",
  woff: "font/woff", woff2: "font/woff2", mp4: "video/mp4", webm: "video/webm",
  json: "application/json", zip: "application/zip", html: "text/html; charset=utf-8",
};

const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "yaml", "yml", "json", "js", "mjs", "cjs", "ts", "css", "html",
  "txt", "py", "rs", "toml", "svg", "xml", "sh", "php",
]);

type EditAction = "write" | "upload" | "delete" | "rename" | "publish";

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// --- paths --------------------------------------------------------------------------------------

/**
 * The `{path}` part of a request as a folder-relative posix path, or a 400.
 *
 * Segments are decoded individually — matching `HttpBackend`'s `encodePath` — and checked *after*
 * decoding, so `..%2Fx`, which survives URL normalisation as one segment, cannot smuggle a
 * traversal through. R2 has no directories and no symlinks, so this lexical check is the whole of
 * it: there is no second, filesystem-shaped way for a key to escape its prefix.
 */
function toRelPath(raw: string, decode: boolean): string {
  const segments: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "") continue;
    let seg = part;
    if (decode) {
      try { seg = decodeURIComponent(part); } catch { throw new HttpError(400, `malformed path: ${raw}`); }
    }
    // `/` is in the set on purpose. The split above ran on the *encoded* string, so a segment that
    // contains a separator can only have grown one by being decoded — which is `..%2F..%2Fx`,
    // the traversal that survives URL normalisation as a single segment.
    if (seg === "." || seg === ".." || /[/\\\0]/.test(seg)) throw new HttpError(400, `illegal path: ${raw}`);
    segments.push(seg);
  }
  if (segments.length === 0) throw new HttpError(400, "empty path");
  return segments.join("/");
}

/** Dotfiles are not article content — not `.pagina/`, not `.git/`, not `.env`. */
function dotSegment(rel: string): string | undefined {
  return rel.split("/").find((seg) => seg.startsWith("."));
}

function assertWritable(rel: string): void {
  const dot = dotSegment(rel);
  if (dot !== undefined) throw new HttpError(403, `dotfiles are not article content: ${rel}`);
}

/** A name the editor invented, reduced to a predictable shape. */
function sanitiseName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "");
  return cleaned === "" ? "upload.bin" : cleaned;
}

const extensionOf = (rel: string): string => (rel.includes(".") ? rel.split(".").pop() ?? "" : "").toLowerCase();

/** `"v"`, `W/"v"` and a bare `v` all mean version `v`; `*` means "any existing version". */
const unquoteETag = (raw: string): string => raw.trim().replace(/^W\//, "").replace(/^"|"$/g, "");

// --- identity -----------------------------------------------------------------------------------

/** `{ id, name, … }` out of the `EDITORS` secret, or `undefined` when it is not one. */
function parseAuthor(raw: unknown): Author | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o["id"] !== "string" || o["id"] === "") return undefined;
  if (typeof o["name"] !== "string" || o["name"] === "") return undefined;
  return {
    id: o["id"], name: o["name"],
    ...(typeof o["email"] === "string" ? { email: o["email"] } : {}),
    ...(typeof o["avatarUrl"] === "string" ? { avatarUrl: o["avatarUrl"] } : {}),
  };
}

function editorsOf(env: Env): Map<string, Author> {
  const out = new Map<string, Author>();
  if (env.EDITORS === undefined || env.EDITORS.trim() === "") return out;
  let parsed: unknown;
  try { parsed = JSON.parse(env.EDITORS); } catch { throw new HttpError(500, "EDITORS is not valid JSON"); }
  if (parsed === null || typeof parsed !== "object") throw new HttpError(500, "EDITORS must be a JSON object");
  for (const [token, value] of Object.entries(parsed as Record<string, unknown>)) {
    const author = parseAuthor(value);
    if (author !== undefined && token !== "") out.set(token, author);
  }
  return out;
}

/**
 * The token this request presents, from `Authorization: Bearer …` or a `pagina_token` cookie.
 *
 * The cookie is not redundant. `EventSource` sends no custom headers — the browser API has no
 * argument for them — so `GET {base}/events` can only ever be authenticated by something the
 * browser attaches on its own. That is a cookie, and in production it is Cloudflare Access's
 * cookie rather than this one.
 */
function tokenOf(request: Request): string | undefined {
  const header = request.headers.get("Authorization");
  if (header !== null && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "pagina_token") return rest.join("=").trim();
  }
  return undefined;
}

/**
 * Who is calling, derived from the request's own credential and from nothing else.
 *
 * This is the one function allowed to answer the question. Everything downstream takes the
 * {@link Author} it returns; nothing downstream reads the request again.
 */
// --8<-- [start:identity]
function identify(request: Request, env: Env): Author {
  const editors = editorsOf(env);
  if (editors.size === 0) {
    throw new HttpError(500, "no EDITORS are configured, so this Worker cannot attribute a write to anybody");
  }
  const token = tokenOf(request);
  const author = token === undefined ? undefined : editors.get(token);
  if (author === undefined) throw new HttpError(401, "a valid editor token is required");
  return author;
}
// --8<-- [end:identity]

// --- R2 layout ----------------------------------------------------------------------------------

/**
 * One article folder in one bucket:
 *
 * ```
 * {slug}/files/{path}        the folder, byte for byte
 * {slug}/rendered/…          what the browser rendered and published
 * {slug}/published.json      when, and by whom
 * {slug}/edits/{key}         the log: zero bytes each, the row in custom metadata
 * ```
 */
const fileKey = (slug: string, rel: string): string => `${slug}/files/${rel}`;

/**
 * Edit-log keys sort **newest first** on their own.
 *
 * R2 lists keys ascending and offers no other order, so an ordinary timestamp would mean reading
 * the whole log to answer "the last 50". Subtracting the clock from a constant inverts it, and
 * `limit` then means what it says on the first page.
 */
const EPOCH_CEILING = 10_000_000_000_000;
function editKey(slug: string, at: number): string {
  const inverted = String(EPOCH_CEILING - at).padStart(14, "0");
  const salt = Math.random().toString(36).slice(2, 8);
  return `${slug}/edits/${inverted}-${salt}`;
}

interface Attribution { lastEditedBy: Author; lastEditedAt: string }

/** Attribution as R2 custom metadata: one row per object, overwritten by every write. */
function metadataFor(by: Author, at: string): Record<string, string> {
  return { by: JSON.stringify(by), at };
}

function attributionOf(object: R2ObjectLike | null): Attribution | undefined {
  const meta = object?.customMetadata;
  if (meta === undefined) return undefined;
  const by = parseAuthor(((): unknown => {
    try { return JSON.parse(meta["by"] ?? "null"); } catch { return null; }
  })());
  const at = meta["at"];
  if (by === undefined || at === undefined) return undefined;
  return { lastEditedBy: by, lastEditedAt: at };
}

/** Every object under a prefix, following R2's cursor. */
async function listAll(bucket: R2BucketLike, options: R2ListOptions): Promise<R2ObjectLike[]> {
  const out: R2ObjectLike[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ ...options, ...(cursor === undefined ? {} : { cursor }) });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return out;
}

// --- responses ----------------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function bodyText(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, `request body of ${String(declared)} bytes exceeds the ${String(limit)}-byte limit`);
  }
  const text = await request.text();
  // Checked again after reading: `Content-Length` is the sender's claim, and a chunked body has none.
  if (text.length > limit) throw new HttpError(413, `request body exceeds the ${String(limit)}-byte limit`);
  return text;
}

// --- the article ---------------------------------------------------------------------------------

/**
 * Where a change is announced. One function, so the Durable Object stays behind it.
 *
 * This is the only genuinely Cloudflare-shaped requirement in the file, and it is not a
 * requirement of the *contract*: `GET {base}/events` is optional, and a host that drops it gets an
 * editor that no longer notices a second tab and works otherwise. A port to another runtime
 * supplies a Redis publish, a Postgres `NOTIFY`, or `async () => {}`.
 */
export type Broadcast = (frame: unknown) => Promise<void>;

/**
 * The article folder, as operations on a byte store.
 *
 * Nothing below this line is Cloudflare-specific. `R2BucketLike` is seven methods that S3, GCS,
 * Azure Blob and a table of blobs can all provide; {@link Broadcast} is one function. That is the
 * whole platform surface, and it is the reason this file is worth reading if you are implementing
 * the same contract somewhere else.
 */
class Article {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly broadcast: Broadcast,
    private readonly slug: string,
    /** Resolved once, by {@link identify}. There is deliberately no way to override it per call. */
    private readonly who: Author,
    private readonly siteBase: string,
  ) {}

  /**
   * Appends to the log and tells every open stream.
   *
   * Both happen *after* the bytes land, so the log can never claim an edit that did not happen,
   * and both are awaited rather than deferred to `waitUntil`, so a client that gets its 200 knows
   * the other tabs have been told.
   */
  async #record(entry: { path: string; action: EditAction; version: string; from?: string }, notify: "changed" | "deleted" | null): Promise<Attribution> {
    const at = new Date().toISOString();
    const row: Record<string, string> = {
      path: entry.path, action: entry.action, version: entry.version, at, by: JSON.stringify(this.who),
      ...(entry.from === undefined ? {} : { from: entry.from }),
    };
    await this.bucket.put(editKey(this.slug, Date.parse(at)), "", { customMetadata: row });
    if (notify !== null) {
      await this.broadcast({
        type: notify, path: entry.path,
        ...(entry.version === "" ? {} : { version: entry.version }),
        by: this.who, at,
      });
    }
    return { lastEditedBy: this.who, lastEditedAt: at };
  }

  async list(): Promise<Response> {
    const prefix = `${this.slug}/files/`;
    const objects = await listAll(this.bucket, { prefix, include: ["customMetadata"] });
    return json({
      files: objects.map((o) => {
        const path = o.key.slice(prefix.length);
        return {
          path, size: o.size, version: o.etag, mtime: o.uploaded.toISOString(),
          ...(dotSegment(path) === undefined ? attributionOf(o) ?? {} : {}),
        };
      }).filter((f) => dotSegment(f.path) === undefined),
    });
  }

  async read(rel: string, wantsText: boolean): Promise<Response> {
    if (dotSegment(rel) !== undefined) throw new HttpError(404, `no such file: ${rel}`);
    const object = await this.bucket.get(fileKey(this.slug, rel));
    if (object === null) throw new HttpError(404, `no such file: ${rel}`);
    const extension = extensionOf(rel);
    return new Response(await object.arrayBuffer(), {
      status: 200,
      headers: {
        etag: `"${object.etag}"`,
        "cache-control": "no-store",
        "content-type": wantsText || TEXT_EXTENSIONS.has(extension)
          ? "text/plain; charset=utf-8"
          : CONTENT_TYPES[extension] ?? "application/octet-stream",
      },
    });
  }

  /**
   * `PUT`, with `If-Match` as a compare-and-swap rather than a read followed by a write.
   *
   * The check and the store are one R2 operation (`onlyIf`), so two editors who both hold version
   * `v` cannot both succeed: the second gets `null` back and is answered with the 409 it earned.
   * A read-then-write would pass every test in the contract suite and lose an edit in production
   * about as often as two people save within the same few milliseconds.
   */
  async write(rel: string, text: string, ifMatch: string | null): Promise<Response> {
    assertWritable(rel);
    const key = fileKey(this.slug, rel);
    const expected = ifMatch === null ? "" : unquoteETag(ifMatch);
    const head = await this.bucket.head(key);

    if (expected === "*") {
      // RFC 9110: `*` is "any current representation", so the file must exist. When it does not,
      // there is no `theirs` and no `version` to hand back, and a 409 body would misdescribe what
      // this server holds. 412 with a message is the honest answer, and it is what the other two
      // implementations of this contract return.
      if (head === null) return json({ message: `${rel} does not exist` }, 412);
    } else if (expected !== "" && head !== null && head.etag !== expected) {
      return await this.#conflict(rel, key);
    }

    // --8<-- [start:cas]
    const stored = await this.bucket.put(key, text, {
      customMetadata: metadataFor(this.who, new Date().toISOString()),
      // Only when we saw something: a versioned write to a path that does not exist is a create,
      // which all three implementations of this contract agree on and the store relies on.
      ...(head === null ? {} : { onlyIf: { etagMatches: head.etag } }),
    });
    // Somebody wrote between the head and the put. Nothing was overwritten, which is the point.
    if (stored === null) return await this.#conflict(rel, key);
    // --8<-- [end:cas]

    const attribution = await this.#record({ path: rel, action: "write", version: stored.etag }, "changed");
    return new Response(JSON.stringify({ version: stored.etag, ...attribution }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", etag: `"${stored.etag}"`, "cache-control": "no-store" },
    });
  }

  /** The 409 body: the other side's text, its version, and who put it there. */
  async #conflict(rel: string, key: string): Promise<Response> {
    const theirs = await this.bucket.get(key);
    const whose = attributionOf(theirs);
    return json({
      theirs: theirs === null ? "" : await theirs.text(),
      version: theirs === null ? "" : theirs.etag,
      message: `${rel} changed on the server`,
      ...(whose === undefined ? {} : { by: whose.lastEditedBy, at: whose.lastEditedAt }),
    }, 409);
  }

  async delete(rel: string): Promise<Response> {
    assertWritable(rel);
    const key = fileKey(this.slug, rel);
    if (await this.bucket.head(key) === null) throw new HttpError(404, `no such file: ${rel}`);
    await this.bucket.delete(key);
    await this.#record({ path: rel, action: "delete", version: "" }, "deleted");
    return new Response(null, { status: 204 });
  }

  async rename(from: string, to: string): Promise<Response> {
    assertWritable(from);
    assertWritable(to);
    const source = await this.bucket.get(fileKey(this.slug, from));
    if (source === null) throw new HttpError(404, `no such file: ${from}`);
    // R2 has no move, so a rename is a copy and a delete. Not atomic: a Worker that dies between
    // the two leaves the file at both paths, which is the recoverable half of the two failures.
    const stored = await this.bucket.put(fileKey(this.slug, to), await source.arrayBuffer(), {
      customMetadata: metadataFor(this.who, new Date().toISOString()),
    });
    await this.bucket.delete(fileKey(this.slug, from));
    const version = stored?.etag ?? source.etag;
    const attribution = await this.#record({ path: to, action: "rename", version, from }, "changed");
    await this.broadcast({ type: "deleted", path: from, by: this.who, at: attribution.lastEditedAt });
    return json({ version, ...attribution });
  }

  async upload(request: Request): Promise<Response> {
    const declared = Number(request.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > LIMIT_UPLOAD) {
      throw new HttpError(413, `upload of ${String(declared)} bytes exceeds the ${String(LIMIT_UPLOAD)}-byte limit`);
    }
    let form: FormData;
    try { form = await request.formData(); } catch { throw new HttpError(400, "upload expects multipart/form-data"); }
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new HttpError(400, "upload expects a `file` part");
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > LIMIT_UPLOAD) throw new HttpError(413, `upload exceeds the ${String(LIMIT_UPLOAD)}-byte limit`);

    const given = form.get("path");
    const name = "name" in file && typeof (file as File).name === "string" ? (file as File).name : "upload.bin";
    const rel = typeof given === "string" && given.trim() !== ""
      ? toRelPath(given.trim(), false)
      : `media/${sanitiseName(name)}`;
    assertWritable(rel);

    const stored = await this.bucket.put(fileKey(this.slug, rel), bytes, {
      customMetadata: metadataFor(this.who, new Date().toISOString()),
    });
    const version = stored?.etag ?? "";
    const attribution = await this.#record({ path: rel, action: "upload", version }, "changed");
    return json({ path: rel, url: `${this.siteBase}/${rel}`, version, ...attribution });
  }

  /**
   * What the browser rendered, stored as files.
   *
   * Nothing here parses markdown or draws a figure. The editor did both, in the reader's own
   * browser, and this writes down the result — which is the reason an edge runtime with no Node in
   * it can host a pagina site at all.
   */
  async publish(request: Request): Promise<Response> {
    const payload = JSON.parse(await bodyText(request, LIMIT_JSON) || "{}") as {
      manifest?: unknown;
      pages?: Record<string, string>;
      figures?: Record<string, Record<string, string>>;
    };
    const at = `${this.slug}/rendered`;
    await this.bucket.put(`${at}/manifest.json`, JSON.stringify(payload.manifest ?? {}, null, 2));
    for (const [href, html] of Object.entries(payload.pages ?? {})) {
      // `/guide/tabs/` → `guide-tabs.html`, `/` → `index.html`: one flat, collision-free file per
      // page, which is all a consumer needs to look one up by href.
      const slug = href.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "index";
      await this.bucket.put(`${at}/pages/${sanitiseName(slug)}.html`, String(html));
    }
    for (const [id, themes] of Object.entries(payload.figures ?? {})) {
      for (const [theme, svg] of Object.entries(themes)) {
        await this.bucket.put(`${at}/figures/${sanitiseName(id)}.${sanitiseName(theme)}.svg`, String(svg));
      }
    }
    const record = { publishedAt: new Date().toISOString(), publishedBy: this.who };
    await this.bucket.put(`${this.slug}/published.json`, JSON.stringify(record, null, 2));
    const manifestSlug = (payload.manifest as { article?: { slug?: unknown } } | undefined)?.article?.slug;
    await this.#record({
      path: typeof manifestSlug === "string" && manifestSlug !== "" ? manifestSlug : this.slug,
      action: "publish", version: "",
    }, null);
    return json(record);
  }

  async history(wanted: string | undefined, limit: number): Promise<Response> {
    const prefix = `${this.slug}/edits/`;
    const edits: unknown[] = [];
    let cursor: string | undefined;
    let scanned = 0;
    // Keys are inverted timestamps, so ascending order *is* newest first and the first page is
    // usually the whole answer. The loop is for the filtered case.
    do {
      const page = await this.bucket.list({
        prefix, include: ["customMetadata"],
        limit: Math.min(1000, Math.max(limit, 100)),
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const object of page.objects) {
        scanned += 1;
        const meta = object.customMetadata;
        if (meta === undefined) continue;
        const by = parseAuthor(((): unknown => {
          try { return JSON.parse(meta["by"] ?? "null"); } catch { return null; }
        })());
        const path = meta["path"];
        const at = meta["at"];
        if (by === undefined || path === undefined || at === undefined) continue;
        if (wanted !== undefined && path !== wanted && meta["from"] !== wanted) continue;
        edits.push({
          path, action: meta["action"] ?? "write", at, by, version: meta["version"] ?? "",
          ...(meta["from"] === undefined ? {} : { from: meta["from"] }),
        });
        if (edits.length >= limit) break;
      }
      cursor = page.truncated && edits.length < limit && scanned < HISTORY_SCAN ? page.cursor : undefined;
    } while (cursor !== undefined);
    return json({ edits });
  }
}

// --- routing --------------------------------------------------------------------------------------

/** `GET /rendered/{slug}/{path}` — what publish stored, served to anybody, with no token. */
async function serveRendered(bucket: R2BucketLike, rest: string): Promise<Response> {
  const [slug, ...tail] = rest.split("/");
  if (slug === undefined || slug === "" || tail.length === 0) throw new HttpError(404, "no such published file");
  const rel = toRelPath(tail.join("/"), true);
  const object = await bucket.get(`${slug}/rendered/${rel}`);
  if (object === null) throw new HttpError(404, `no such published file: ${rel}`);
  return new Response(await object.arrayBuffer(), {
    status: 200,
    headers: {
      etag: `"${object.etag}"`,
      "content-type": CONTENT_TYPES[extensionOf(rel)] ?? "text/plain; charset=utf-8",
      // Named by content on the way in, so a reader's copy and the manifest that points at it can
      // never disagree for longer than this.
      "cache-control": "public, max-age=60",
    },
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname.startsWith("/rendered/")) {
    if (method !== "GET" && method !== "HEAD") throw new HttpError(405, `${method} not allowed`);
    return await serveRendered(env.ARTICLES, url.pathname.slice("/rendered/".length));
  }

  const base = (env.API_BASE ?? "/api/articles").replace(/\/+$/, "");
  if (!url.pathname.startsWith(`${base}/`)) throw new HttpError(404, `no such endpoint: ${url.pathname}`);
  const [slug, ...tail] = url.pathname.slice(base.length + 1).split("/");
  if (slug === undefined || slug === "") throw new HttpError(404, "no article slug in the path");
  const rest = `/${tail.join("/")}`;

  // Before anything else, and from the credential alone.
  const who = identify(request, env);

  if (rest === "/events" && method === "GET") {
    const stub = env.EVENTS.get(env.EVENTS.idFromName(slug));
    return await stub.fetch("https://events.invalid/subscribe");
  }

  // The one Cloudflare-shaped line, kept to one line on purpose.
  const broadcast: Broadcast = async (frame) => {
    await env.EVENTS.get(env.EVENTS.idFromName(slug))
      .fetch("https://events.invalid/broadcast", { method: "POST", body: JSON.stringify(frame) });
  };
  const article = new Article(env.ARTICLES, broadcast, slug, who, (env.SITE_BASE ?? "").replace(/\/+$/, ""));

  if (rest === "/files" && (method === "GET" || method === "HEAD")) return await article.list();

  if (rest.startsWith("/files/")) {
    const rel = toRelPath(rest.slice("/files/".length), true);
    if (method === "GET" || method === "HEAD") {
      const wantsText = url.searchParams.get("responseType") === "text"
        || (url.searchParams.get("responseType") !== "binary"
          && (request.headers.get("Accept") ?? "").includes("text/plain"));
      return await article.read(rel, wantsText);
    }
    if (method === "PUT") {
      return await article.write(rel, await bodyText(request, LIMIT_TEXT), request.headers.get("If-Match"));
    }
    if (method === "DELETE") return await article.delete(rel);
    throw new HttpError(405, `${method} not allowed on ${rest}`);
  }

  if (rest === "/rename" && method === "POST") {
    const body = JSON.parse(await bodyText(request, LIMIT_JSON) || "{}") as { from?: unknown; to?: unknown };
    if (typeof body.from !== "string" || typeof body.to !== "string") throw new HttpError(400, "rename needs { from, to }");
    return await article.rename(toRelPath(body.from, false), toRelPath(body.to, false));
  }

  if (rest === "/upload" && method === "POST") return await article.upload(request);
  if (rest === "/publish" && method === "POST") return await article.publish(request);

  if (rest === "/history" && (method === "GET" || method === "HEAD")) {
    const asked = Number(url.searchParams.get("limit") ?? NaN);
    const limit = Number.isFinite(asked) ? Math.max(0, Math.min(HISTORY_MAX, Math.floor(asked))) : HISTORY_DEFAULT;
    return await article.history(url.searchParams.get("path") ?? undefined, limit);
  }

  throw new HttpError(404, `no such endpoint: ${rest}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      return json({ message }, status);
    }
  },
};
