/**
 * The browser-side half of the HTTP contract in
 * `docs/design/2026-08-17-editor-connectivity-laravel.md`:
 *
 * ```
 * GET    {base}/files                        → { files: [{ path, size, version, mtime,
 *                                                          lastEditedBy?, lastEditedAt? }] }
 * GET    {base}/files/{path}                 → text or binary; ETag = version
 * PUT    {base}/files/{path} (If-Match: v)   → { version, lastEditedBy?, lastEditedAt? }
 *                                              409 → { theirs, version, by?, at? }
 * POST   {base}/upload  (multipart file,path?) → { path, url, version, lastEditedBy?, lastEditedAt? }
 * DELETE {base}/files/{path}                 → 204
 * POST   {base}/rename  { from, to }         → { version, lastEditedBy?, lastEditedAt? }
 * POST   {base}/publish { manifest, pages, figures } → { publishedAt, publishedBy? }
 * GET    {base}/history?path&limit (optional)→ { edits: [{ path, action, at, by, version, from? }] }
 * GET    {base}/events  (SSE, optional)      → file-changed events, optionally carrying `by`/`at`
 * ```
 *
 * `{base}` is `/api/articles/{slug}` in Laravel and `/__pagina/edit` in the Vite dev server. The
 * same server implements both, so nothing here may drift from that list.
 *
 * **This backend has no identity of its own.** It reports what the server reports and nothing else:
 * every author here arrives on a response, none is ever sent on a request. That is the whole point
 * — the browser says what it is editing, and the server says who is editing.
 */
import { parseAuthor, parseInstant } from "@pagina/core";
import type {
  ArticleBackend, Author, BackendChange, Edit, EditAction, FileEntry, HistoryOptions,
  PublishPayload, PublishRecord, UploadResult, WriteOptions, WriteRecord,
} from "./types.js";
import { BackendError, ConflictError } from "./types.js";
import { historyLimit } from "./attribution.js";

export interface HttpBackendOptions {
  /** e.g. `/api/articles/my-slug` or `/__pagina/edit`; a trailing slash is ignored. */
  readonly baseUrl: string;
  /** Sent on every request — CSRF tokens, `Authorization`, … */
  readonly headers?: Readonly<Record<string, string>>;
  /** Injectable for tests and for non-browser hosts. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Whether this server implements `GET {base}/history`. Default `false`.
   *
   * Declared by the host rather than discovered, because the editor decides whether the history
   * panel exists at all from whether the method is *there*, and that is a synchronous question. A
   * probe would mean either an panel that appears a moment late or one that appears and then 404s,
   * and both are worse than a host stating what it built. Set it when you implement the endpoint.
   */
  readonly history?: boolean;
}

const EDIT_ACTIONS = new Set<string>(["write", "upload", "delete", "rename", "publish"]);

/** One {@link Edit} out of a server's JSON, or `undefined` when the value is not one. */
function parseEdit(raw: unknown): Edit | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const by = parseAuthor(o["by"]);
  const at = parseInstant(o["at"]);
  if (by === undefined || at === undefined || typeof o["path"] !== "string") return undefined;
  const action = typeof o["action"] === "string" && EDIT_ACTIONS.has(o["action"]) ? o["action"] as EditAction : "write";
  return {
    path: o["path"], action, at, by,
    version: typeof o["version"] === "string" ? o["version"] : "",
    ...(typeof o["from"] === "string" ? { from: o["from"] } : {}),
  };
}

/** The two attribution fields of a listing entry or a write response, validated. */
function attributionOf(raw: unknown): { lastEditedBy?: Author; lastEditedAt?: string } {
  if (raw === null || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const by = parseAuthor(o["lastEditedBy"]);
  const at = parseInstant(o["lastEditedAt"]);
  return {
    ...(by === undefined ? {} : { lastEditedBy: by }),
    ...(at === undefined ? {} : { lastEditedAt: at }),
  };
}

/** Path segments are encoded individually so `/` keeps its meaning but spaces and `#` do not break. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** `"v1"` and `W/"v1"` both mean version `v1`. */
function parseETag(raw: string | null): string {
  if (raw === null) return "";
  return raw.replace(/^W\//, "").replace(/^"|"$/g, "");
}

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return undefined; }
}

export class HttpBackend implements ArticleBackend {
  readonly #base: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof globalThis.fetch;

  /**
   * Present only when the host said the server implements `GET {base}/history`.
   *
   * Assigned in the constructor rather than declared as a method, because `history` being *absent*
   * is how a backend says it cannot answer, and a method on the prototype is never absent.
   */
  history?: (path?: string, opts?: HistoryOptions) => Promise<Edit[]>;

  constructor(opts: HttpBackendOptions) {
    this.#base = opts.baseUrl.replace(/\/+$/, "");
    this.#headers = opts.headers ?? {};
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    if (opts.history === true) {
      this.history = async (path?: string, o?: HistoryOptions): Promise<Edit[]> => await this.#history(path, o);
    }
  }

  async #history(path?: string, opts?: HistoryOptions): Promise<Edit[]> {
    const query = new URLSearchParams({ limit: String(historyLimit(opts)) });
    if (path !== undefined) query.set("path", path);
    const body = await this.#json<{ edits?: unknown }>(`${this.#base}/history?${query.toString()}`, { method: "GET" });
    if (!Array.isArray(body.edits)) return [];
    // A malformed entry is dropped rather than failing the call: a panel missing one row is better
    // than a panel that is not there because one row was wrong.
    return body.edits.map(parseEdit).filter((e): e is Edit => e !== undefined);
  }

  async #send(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const headers = { ...this.#headers, ...init.headers };
    const res = await this.#fetch(url, { ...init, headers });
    if (!res.ok) throw await this.#error(res);
    return res;
  }

  async #error(res: Response): Promise<BackendError> {
    const body = await readJson(res);
    const message = typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : `${res.status} ${res.statusText || "request failed"}`;
    return new BackendError(message, res.status);
  }

  async #json<T>(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<T> {
    return await (await this.#send(url, init)).json() as T;
  }

  async list(): Promise<FileEntry[]> {
    const { files } = await this.#json<{ files: FileEntry[] }>(`${this.#base}/files`, { method: "GET" });
    // Attribution is re-derived rather than passed through: it comes off the wire, so a half-filled
    // author — `{ name: "" }`, an `avatarUrl` that is a number — must not reach the UI as one.
    return files.map((f) => ({
      path: f.path, version: f.version,
      ...(f.size === undefined ? {} : { size: f.size }),
      ...(f.mtime === undefined ? {} : { mtime: f.mtime }),
      ...attributionOf(f),
    }));
  }

  async read(path: string): Promise<{ text: string; version: string }> {
    const res = await this.#send(`${this.#base}/files/${encodePath(path)}?responseType=text`, {
      method: "GET", headers: { Accept: "text/plain, */*" },
    });
    return { text: await res.text(), version: parseETag(res.headers.get("ETag")) };
  }

  async readBinary(path: string): Promise<{ bytes: Uint8Array; version: string }> {
    const res = await this.#send(`${this.#base}/files/${encodePath(path)}?responseType=binary`, {
      method: "GET", headers: { Accept: "application/octet-stream, */*" },
    });
    return { bytes: new Uint8Array(await res.arrayBuffer()), version: parseETag(res.headers.get("ETag")) };
  }

  /**
   * The request body is the file's text and nothing else — no author, not even an optional one.
   *
   * This is the security property of the whole feature stated as code: there is no field here for a
   * caller to fill in, so the only identity that can reach the log is the one the server derives
   * from the session it authenticated.
   */
  async write(path: string, text: string, opts?: WriteOptions): Promise<WriteRecord> {
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
    if (opts?.version !== undefined && opts.version !== "") headers["If-Match"] = `"${opts.version}"`;
    const res = await this.#fetch(`${this.#base}/files/${encodePath(path)}`, {
      method: "PUT", headers: { ...this.#headers, ...headers }, body: text,
    });
    if (res.status === 409) {
      const body = await readJson(res) as Record<string, unknown> | undefined;
      const by = parseAuthor(body?.["by"]);
      const at = parseInstant(body?.["at"]);
      throw new ConflictError({
        path,
        theirs: typeof body?.["theirs"] === "string" ? body["theirs"] : "",
        version: typeof body?.["version"] === "string" ? body["version"] : "",
        ...(typeof body?.["message"] === "string" ? { message: body["message"] } : {}),
        ...(by === undefined ? {} : { by }),
        ...(at === undefined ? {} : { at }),
      });
    }
    if (!res.ok) throw await this.#error(res);
    const body = await res.json() as { version: string };
    return { version: body.version, ...attributionOf(body) };
  }

  async upload(file: Blob | File, path?: string): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file, "name" in file && typeof file.name === "string" ? file.name : "upload.bin");
    if (path !== undefined) form.append("path", path);
    // Deliberately no Content-Type: only the runtime knows the multipart boundary.
    const body = await this.#json<UploadResult>(`${this.#base}/upload`, { method: "POST", body: form });
    return { path: body.path, url: body.url, version: body.version, ...attributionOf(body) };
  }

  async delete(path: string): Promise<void> {
    await this.#send(`${this.#base}/files/${encodePath(path)}`, { method: "DELETE" });
  }

  async rename(from: string, to: string): Promise<WriteRecord> {
    const body = await this.#json<{ version: string }>(`${this.#base}/rename`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }),
    });
    return { version: body.version, ...attributionOf(body) };
  }

  /** The contract has no per-file metadata endpoint, so this reads the listing and picks `path` out. */
  async stat(path: string): Promise<FileEntry | null> {
    return (await this.list()).find((f) => f.path === path) ?? null;
  }

  async publish(payload: PublishPayload): Promise<PublishRecord> {
    const body = await this.#json<{ publishedAt: string; publishedBy?: unknown }>(`${this.#base}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const publishedBy = parseAuthor(body.publishedBy);
    return {
      publishedAt: body.publishedAt,
      ...(publishedBy === undefined ? {} : { publishedBy }),
    };
  }

  /** SSE where the runtime has it; a no-op unsubscribe where it does not (the store copes either way). */
  subscribe(cb: (ev: BackendChange) => void): () => void {
    const Source = (globalThis as { EventSource?: typeof EventSource }).EventSource;
    if (Source === undefined) return () => {};
    const source = new Source(`${this.#base}/events`);
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        const frame = JSON.parse(e.data) as Record<string, unknown>;
        if (frame["type"] !== "changed" && frame["type"] !== "deleted") return;
        if (typeof frame["path"] !== "string") return;
        const by = parseAuthor(frame["by"]);
        const at = parseInstant(frame["at"]);
        cb({
          type: frame["type"], path: frame["path"],
          ...(typeof frame["version"] === "string" ? { version: frame["version"] } : {}),
          ...(by === undefined ? {} : { by }),
          ...(at === undefined ? {} : { at }),
        });
      } catch { /* ignore malformed frames */ }
    };
    return () => { source.close(); };
  }
}
