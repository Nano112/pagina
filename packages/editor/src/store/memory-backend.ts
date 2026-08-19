/**
 * An in-memory {@link ArticleBackend}: the reference implementation of the contract, used by tests,
 * by the standalone demo, and as the thing every other backend is checked against.
 *
 * Versions are content hashes, so they behave like real ETags: writing the same bytes twice keeps
 * the version, and any change invalidates an outstanding `If-Match`.
 */
import type {
  ArticleBackend, Author, BackendChange, Edit, EditAction, FileEntry, HistoryOptions,
  PublishPayload, PublishRecord, UploadResult, WriteOptions, WriteRecord,
} from "./types.js";
import { BackendError, ConflictError } from "./types.js";
import { MEMORY_AUTHOR, selectHistory } from "./attribution.js";

export interface MemoryBackendOptions {
  /** Milliseconds of artificial delay before every operation, for exercising pending UI states. */
  readonly latency?: number;
  /**
   * Who this backend attributes every write to.
   *
   * A single caller identity, because that is what an in-memory store honestly has. It is set here
   * rather than passed to `write()` for the reason the whole feature exists: identity comes from
   * the host, and a `write()` that took an author would let its caller name itself.
   *
   * Defaults to {@link MEMORY_AUTHOR}, which says what it is.
   */
  readonly author?: Author;
}

/**
 * `by`/`at` are absent for a *seeded* file, and only for one: the constructor's article arrived
 * from somewhere else and nobody in this session edited it. Reporting the session's own identity
 * for it would be the first lie in the log.
 */
interface Stored { bytes: Uint8Array; version: string; mtime: string; by?: Author; at?: string }

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Short content hash: sha-256 where `crypto.subtle` exists (browsers, node 20+), FNV-1a elsewhere. */
async function hash(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
    return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

export class MemoryBackend implements ArticleBackend {
  readonly #files = new Map<string, Stored>();
  readonly #listeners = new Set<(ev: BackendChange) => void>();
  readonly #latency: number;
  readonly #author: Author;
  /** Append-ordered; `history()` reverses a slice of it. */
  readonly #log: Edit[] = [];
  #ready: Promise<void>;
  #published: PublishRecord | undefined;
  #publishedPayload: PublishPayload | undefined;

  constructor(files: Record<string, string | Uint8Array> = {}, opts: MemoryBackendOptions = {}) {
    this.#latency = opts.latency ?? 0;
    this.#author = opts.author ?? MEMORY_AUTHOR;
    this.#ready = (async () => {
      for (const [path, content] of Object.entries(files))
        await this.#put(path, toBytes(content), { log: false });
    })();
  }

  /** The payload of the last {@link publish} call, or `undefined` if nothing was published. */
  get published(): PublishPayload | undefined { return this.#publishedPayload; }

  /** Who this backend attributes writes to. Fixed at construction; never taken from a caller. */
  get author(): Author { return this.#author; }

  async #tick(): Promise<void> {
    await this.#ready;
    if (this.#latency > 0) await new Promise<void>((r) => setTimeout(r, this.#latency));
  }

  #record(entry: Edit): void { this.#log.push(entry); }

  /**
   * Writes bytes and stamps them with *this backend's* identity.
   *
   * The author is read from the field, never from an argument. Seeding passes `log: false` because
   * the constructor's files were not edited by anyone — a seeded article whose history opens on
   * three edits nobody made is a log that has already started lying.
   */
  async #put(
    path: string, bytes: Uint8Array,
    opts: { log?: boolean; action?: EditAction; from?: string; by?: Author } = {},
  ): Promise<string> {
    const version = await hash(bytes);
    const at = new Date().toISOString();
    const attributed = opts.log !== false;
    // `opts.by` is only ever passed by `emit`, which is *simulating another person*. Nothing
    // reachable from the contract can set it: every caller on the write path takes `#author`.
    const by = opts.by ?? this.#author;
    this.#files.set(path, {
      bytes, version, mtime: at,
      ...(attributed ? { by, at } : {}),
    });
    if (attributed) {
      this.#record({
        path, action: opts.action ?? "write", at, by, version,
        ...(opts.from === undefined ? {} : { from: opts.from }),
      });
    }
    return version;
  }

  #entry(path: string, f: Stored): FileEntry {
    return {
      path, version: f.version, size: f.bytes.byteLength, mtime: f.mtime,
      ...(f.by === undefined ? {} : { lastEditedBy: f.by }),
      ...(f.at === undefined ? {} : { lastEditedAt: f.at }),
    };
  }

  /** The write record a mutation answers with: the version, and what was recorded against it. */
  #written(path: string, version: string): WriteRecord {
    const f = this.#files.get(path);
    return {
      version,
      ...(f?.by === undefined ? {} : { lastEditedBy: f.by }),
      ...(f?.at === undefined ? {} : { lastEditedAt: f.at }),
    };
  }

  #require(path: string): Stored {
    const f = this.#files.get(path);
    if (f === undefined) throw new BackendError(`not found: ${path}`, 404);
    return f;
  }

  async list(): Promise<FileEntry[]> {
    await this.#tick();
    return [...this.#files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, f]) => this.#entry(p, f));
  }

  async read(path: string): Promise<{ text: string; version: string }> {
    await this.#tick();
    const f = this.#require(path);
    return { text: decoder.decode(f.bytes), version: f.version };
  }

  async readBinary(path: string): Promise<{ bytes: Uint8Array; version: string }> {
    await this.#tick();
    const f = this.#require(path);
    return { bytes: f.bytes, version: f.version };
  }

  async write(path: string, text: string, opts?: WriteOptions): Promise<WriteRecord> {
    await this.#tick();
    const current = this.#files.get(path);
    if (opts?.version !== undefined && current !== undefined && current.version !== opts.version) {
      throw new ConflictError({
        path, theirs: decoder.decode(current.bytes), version: current.version,
        by: current.by, at: current.at,
      });
    }
    return this.#written(path, await this.#put(path, encoder.encode(text)));
  }

  async upload(file: Blob | File, path?: string): Promise<UploadResult> {
    await this.#tick();
    const name = "name" in file && typeof file.name === "string" && file.name !== "" ? file.name : "upload.bin";
    const target = path ?? `media/${name}`;
    const version = await this.#put(target, new Uint8Array(await file.arrayBuffer()), { action: "upload" });
    // No origin to speak of in memory, so the url is just the folder-relative path.
    return { path: target, url: target, ...this.#written(target, version) };
  }

  async delete(path: string): Promise<void> {
    await this.#tick();
    this.#require(path);
    this.#files.delete(path);
    this.#record({ path, action: "delete", at: new Date().toISOString(), by: this.#author, version: "" });
  }

  async rename(from: string, to: string): Promise<WriteRecord> {
    await this.#tick();
    const f = this.#require(from);
    this.#files.delete(from);
    return this.#written(to, await this.#put(to, f.bytes, { action: "rename", from }));
  }

  async stat(path: string): Promise<FileEntry | null> {
    await this.#tick();
    const f = this.#files.get(path);
    return f === undefined ? null : this.#entry(path, f);
  }

  async publish(payload: PublishPayload): Promise<PublishRecord> {
    await this.#tick();
    this.#publishedPayload = payload;
    const publishedAt = new Date().toISOString();
    this.#published = { publishedAt, publishedBy: this.#author };
    this.#record({
      path: payload.manifest.article.slug, action: "publish", at: publishedAt,
      by: this.#author, version: "",
    });
    return this.#published;
  }

  /** What the last {@link publish} recorded — the timestamp and who did it. */
  get publishRecord(): PublishRecord | undefined { return this.#published; }

  async history(path?: string, opts?: HistoryOptions): Promise<Edit[]> {
    await this.#tick();
    return selectHistory(this.#log, path, opts);
  }

  subscribe(cb: (ev: BackendChange) => void): () => void {
    this.#listeners.add(cb);
    return () => { this.#listeners.delete(cb); };
  }

  /**
   * Simulate someone else changing the folder: applies the change (bypassing `If-Match`, since it
   * did not come from us) and notifies subscribers, exactly as an SSE event would.
   *
   * `by` is the *other person*, and is the one place in this class where the recorded author is not
   * `#author` — because that is what the parameter means. It is not part of `ArticleBackend`, so no
   * client can reach it; a test uses it to produce the two-people case the conflict banner exists
   * for.
   */
  async emit(ev: {
    type: "changed" | "deleted"; path: string; text?: string; bytes?: Uint8Array; by?: Author;
  }): Promise<void> {
    await this.#ready;
    const at = new Date().toISOString();
    const by = ev.by ?? this.#author;
    let version: string | undefined;
    if (ev.type === "deleted") {
      this.#files.delete(ev.path);
      this.#record({ path: ev.path, action: "delete", at, by, version: "" });
    } else if (ev.bytes !== undefined) version = await this.#put(ev.path, ev.bytes, { by });
    else if (ev.text !== undefined) version = await this.#put(ev.path, encoder.encode(ev.text), { by });
    else version = this.#files.get(ev.path)?.version;
    const change: BackendChange = {
      type: ev.type, path: ev.path,
      ...(version === undefined ? {} : { version }),
      by, at,
    };
    for (const cb of [...this.#listeners]) cb(change);
  }
}
