/**
 * The browser-side half of the HTTP contract in
 * `docs/design/2026-08-17-editor-connectivity-laravel.md`:
 *
 * ```
 * GET    {base}/files                        → { files: [{ path, size, version, mtime }] }
 * GET    {base}/files/{path}                 → text or binary; ETag = version
 * PUT    {base}/files/{path} (If-Match: v)   → { version }        409 → { theirs, version }
 * POST   {base}/upload  (multipart file,path?) → { path, url, version }
 * DELETE {base}/files/{path}                 → 204
 * POST   {base}/rename  { from, to }         → { version }
 * POST   {base}/publish { manifest, pages, figures } → { publishedAt }
 * GET    {base}/events  (SSE, optional)      → file-changed events
 * ```
 *
 * `{base}` is `/api/articles/{slug}` in Laravel and `/__pagina/edit` in the Vite dev server. The
 * same server implements both, so nothing here may drift from that list.
 */
import type {
  ArticleBackend, BackendChange, FileEntry, PublishPayload, UploadResult, WriteOptions,
} from "./types.js";
import { BackendError, ConflictError } from "./types.js";

export interface HttpBackendOptions {
  /** e.g. `/api/articles/my-slug` or `/__pagina/edit`; a trailing slash is ignored. */
  readonly baseUrl: string;
  /** Sent on every request — CSRF tokens, `Authorization`, … */
  readonly headers?: Readonly<Record<string, string>>;
  /** Injectable for tests and for non-browser hosts. */
  readonly fetch?: typeof globalThis.fetch;
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

  constructor(opts: HttpBackendOptions) {
    this.#base = opts.baseUrl.replace(/\/+$/, "");
    this.#headers = opts.headers ?? {};
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
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
    return (await this.#json<{ files: FileEntry[] }>(`${this.#base}/files`, { method: "GET" })).files;
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

  async write(path: string, text: string, opts?: WriteOptions): Promise<{ version: string }> {
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
    if (opts?.version !== undefined && opts.version !== "") headers["If-Match"] = `"${opts.version}"`;
    const res = await this.#fetch(`${this.#base}/files/${encodePath(path)}`, {
      method: "PUT", headers: { ...this.#headers, ...headers }, body: text,
    });
    if (res.status === 409) {
      const body = await readJson(res) as { theirs?: string; version?: string; message?: string } | undefined;
      throw new ConflictError({
        path, theirs: body?.theirs ?? "", version: body?.version ?? "",
        ...(body?.message === undefined ? {} : { message: body.message }),
      });
    }
    if (!res.ok) throw await this.#error(res);
    return await res.json() as { version: string };
  }

  async upload(file: Blob | File, path?: string): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file, "name" in file && typeof file.name === "string" ? file.name : "upload.bin");
    if (path !== undefined) form.append("path", path);
    // Deliberately no Content-Type: only the runtime knows the multipart boundary.
    return await this.#json<UploadResult>(`${this.#base}/upload`, { method: "POST", body: form });
  }

  async delete(path: string): Promise<void> {
    await this.#send(`${this.#base}/files/${encodePath(path)}`, { method: "DELETE" });
  }

  async rename(from: string, to: string): Promise<{ version: string }> {
    return await this.#json<{ version: string }>(`${this.#base}/rename`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }),
    });
  }

  /** The contract has no per-file metadata endpoint, so this reads the listing and picks `path` out. */
  async stat(path: string): Promise<FileEntry | null> {
    return (await this.list()).find((f) => f.path === path) ?? null;
  }

  async publish(payload: PublishPayload): Promise<{ publishedAt: string }> {
    return await this.#json<{ publishedAt: string }>(`${this.#base}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  }

  /** SSE where the runtime has it; a no-op unsubscribe where it does not (the store copes either way). */
  subscribe(cb: (ev: BackendChange) => void): () => void {
    const Source = (globalThis as { EventSource?: typeof EventSource }).EventSource;
    if (Source === undefined) return () => {};
    const source = new Source(`${this.#base}/events`);
    source.onmessage = (e: MessageEvent<string>) => {
      try { cb(JSON.parse(e.data) as BackendChange); } catch { /* ignore malformed frames */ }
    };
    return () => { source.close(); };
  }
}
