/**
 * The backend contract the editor store talks to.
 *
 * These method names and payload shapes mirror the HTTP contract in
 * `docs/design/2026-08-17-editor-connectivity-laravel.md` one-for-one, because three
 * implementations have to agree on them: `MemoryBackend` (tests, demos), `HttpBackend` (browser),
 * and the servers behind it — the Vite dev middleware and the Laravel package. Renaming anything
 * here is a protocol change.
 */
import type { Manifest } from "@pagina/core";

/** One file in the article folder. `version` is the ETag the server hands out. */
export interface FileEntry {
  readonly path: string;
  readonly version: string;
  readonly size?: number;
  readonly mtime?: string;
}

/**
 * What `POST {base}/publish` carries: the manifest and pre-rendered HTML from `@pagina/core`, plus
 * figure SVGs rendered in the browser (`figures[id][theme] = svg`).
 */
export interface PublishPayload {
  readonly manifest: Manifest;
  readonly pages: Readonly<Record<string, string>>;
  readonly figures: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** A file-changed notification from `GET {base}/events` (or `MemoryBackend.emit`). */
export interface BackendChange {
  readonly type: "changed" | "deleted";
  readonly path: string;
  readonly version?: string;
}

export interface WriteOptions {
  /** Last known version; sent as `If-Match` so a concurrent write becomes a 409, not a clobber. */
  readonly version?: string | undefined;
}

export interface UploadResult {
  readonly path: string;
  readonly url: string;
  readonly version: string;
}

export interface ArticleBackend {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<{ text: string; version: string }>;
  readBinary(path: string): Promise<{ bytes: Uint8Array; version: string }>;
  /** Throws {@link ConflictError} when `opts.version` no longer matches the stored version. */
  write(path: string, text: string, opts?: WriteOptions): Promise<{ version: string }>;
  upload(file: Blob | File, path?: string): Promise<UploadResult>;
  delete(path: string): Promise<void>;
  rename(from: string, to: string): Promise<{ version: string }>;
  stat(path: string): Promise<FileEntry | null>;
  publish(payload: PublishPayload): Promise<{ publishedAt: string }>;
  /** Optional live updates for other-tab awareness. Returns an unsubscribe function. */
  subscribe?(cb: (ev: BackendChange) => void): () => void;
}

/** Any non-2xx response, carrying the HTTP status when there was one. */
export class BackendError extends Error {
  readonly status?: number | undefined;
  constructor(message: string, status?: number | undefined) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

/**
 * A 409: someone else wrote the file since we last read it. `theirs` is the current server text and
 * `version` its version, so the UI can offer "reload theirs" / "overwrite with mine" without a
 * second round trip.
 */
export class ConflictError extends BackendError {
  readonly path: string;
  readonly theirs: string;
  readonly version: string;
  constructor(o: { path: string; theirs: string; version: string; message?: string }) {
    super(o.message ?? `conflict: ${o.path} changed on the server`, 409);
    this.name = "ConflictError";
    this.path = o.path;
    this.theirs = o.theirs;
    this.version = o.version;
  }
}
