/**
 * The backend contract the editor store talks to.
 *
 * These method names and payload shapes mirror the HTTP contract in
 * `docs/design/2026-08-17-editor-connectivity-laravel.md` one-for-one, because three
 * implementations have to agree on them: `MemoryBackend` (tests, demos), `HttpBackend` (browser),
 * and the servers behind it — the Vite dev middleware and the Laravel package. Renaming anything
 * here is a protocol change.
 */
import type { Author, Manifest } from "@pagina/core";

export type { Author } from "@pagina/core";

/**
 * One file in the article folder. `version` is the ETag the server hands out.
 *
 * `lastEditedBy` and `lastEditedAt` are **attribution**: who last touched this file, and when. One
 * row per file, overwritten by each write, which is cheap enough that every backend can keep it.
 * Both are optional, because a host that does not know is expected to say nothing rather than
 * invent an answer — and every reader here has to render that absence rather than assume a name.
 */
export interface FileEntry {
  readonly path: string;
  readonly version: string;
  readonly size?: number;
  readonly mtime?: string;
  /** Who last wrote this file, as the *host* identified them. Never supplied by the client. */
  readonly lastEditedBy?: Author;
  /** ISO-8601 instant of that write. */
  readonly lastEditedAt?: string;
}

/** What happened to a file. `publish` is not about one file, and carries the article's own path. */
export type EditAction = "write" | "upload" | "delete" | "rename" | "publish";

/**
 * One entry in a backend's {@link ArticleBackend.history}: that an edit happened, by whom, when,
 * and which version it produced.
 *
 * Deliberately *not* a revision: pagina does not store old contents, so there is nothing here to
 * restore. A host that wants real revisions has git or a database; this is the layer that says who,
 * so a host with either can join the two up.
 */
export interface Edit {
  readonly path: string;
  readonly action: EditAction;
  /** ISO-8601 instant. */
  readonly at: string;
  readonly by: Author;
  /** The version the edit produced. Empty for a delete, which produces none. */
  readonly version: string;
  /** The old path, on a `rename`. */
  readonly from?: string;
}

export interface HistoryOptions {
  /** Newest-first cap. Backends default to 50 and refuse to exceed 500. */
  readonly limit?: number;
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

/**
 * What a publish leaves behind. `publishedBy` is the author of the event a reader's page is
 * attributed to, which is the one most worth having later.
 */
export interface PublishRecord {
  readonly publishedAt: string;
  readonly publishedBy?: Author;
}

/** What a write leaves behind: the new version, and the attribution the host recorded for it. */
export interface WriteRecord {
  readonly version: string;
  readonly lastEditedBy?: Author;
  readonly lastEditedAt?: string;
}

/**
 * A file-changed notification from `GET {base}/events` (or `MemoryBackend.emit`).
 *
 * `by` is what turns "index.md changed on the server" into "Alice changed index.md": the conflict
 * an author actually meets in two open tabs arrives here, not through a 409.
 */
export interface BackendChange {
  readonly type: "changed" | "deleted";
  readonly path: string;
  readonly version?: string;
  readonly by?: Author;
  readonly at?: string;
}

export interface WriteOptions {
  /** Last known version; sent as `If-Match` so a concurrent write becomes a 409, not a clobber. */
  readonly version?: string | undefined;
}

export interface UploadResult {
  readonly path: string;
  readonly url: string;
  readonly version: string;
  readonly lastEditedBy?: Author;
  readonly lastEditedAt?: string;
}

// --8<-- [start:contract]
export interface ArticleBackend {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<{ text: string; version: string }>;
  readBinary(path: string): Promise<{ bytes: Uint8Array; version: string }>;
  /**
   * Throws {@link ConflictError} when `opts.version` no longer matches the stored version.
   *
   * There is **no author parameter, by design.** Identity comes from the host, which already knows
   * who is calling; an author in a request body is a claim, and a claim is forgeable. A backend
   * that let a caller name itself would record fiction and invite the one attack that matters
   * here — writing as somebody else.
   */
  write(path: string, text: string, opts?: WriteOptions): Promise<WriteRecord>;
  upload(file: Blob | File, path?: string): Promise<UploadResult>;
  delete(path: string): Promise<void>;
  rename(from: string, to: string): Promise<WriteRecord>;
  stat(path: string): Promise<FileEntry | null>;
  publish(payload: PublishPayload): Promise<PublishRecord>;
  /** Optional live updates for other-tab awareness. Returns an unsubscribe function. */
  subscribe?(cb: (ev: BackendChange) => void): () => void;
  /**
   * Optional edit log, newest first; `path` narrows it to one file.
   *
   * Optional because history costs what attribution does not — an append-only record rather than
   * one overwritten row per file — and not every host wants to keep it. A backend that cannot
   * answer **omits the method**, and the editor hides the panel rather than rendering an empty one.
   */
  history?(path?: string, opts?: HistoryOptions): Promise<Edit[]>;
}
// --8<-- [end:contract]

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
 *
 * `by` and `at` are who that someone else was. They are what lets the banner say *Alice changed
 * index.md two minutes ago* instead of *index.md changed on the server* — the same mechanism, the
 * same 409, and materially different for the person deciding whether to keep their version. A
 * backend that does not know omits them and the banner falls back.
 */
export class ConflictError extends BackendError {
  readonly path: string;
  readonly theirs: string;
  readonly version: string;
  readonly by?: Author | undefined;
  readonly at?: string | undefined;
  constructor(o: {
    path: string; theirs: string; version: string; message?: string;
    by?: Author | undefined; at?: string | undefined;
  }) {
    super(o.message ?? `conflict: ${o.path} changed on the server`, 409);
    this.name = "ConflictError";
    this.path = o.path;
    this.theirs = o.theirs;
    this.version = o.version;
    this.by = o.by;
    this.at = o.at;
  }
}
