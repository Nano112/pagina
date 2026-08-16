/**
 * An in-memory {@link ArticleBackend}: the reference implementation of the contract, used by tests,
 * by the standalone demo, and as the thing every other backend is checked against.
 *
 * Versions are content hashes, so they behave like real ETags: writing the same bytes twice keeps
 * the version, and any change invalidates an outstanding `If-Match`.
 */
import type {
  ArticleBackend, BackendChange, FileEntry, PublishPayload, UploadResult, WriteOptions,
} from "./types.js";
import { BackendError, ConflictError } from "./types.js";

export interface MemoryBackendOptions {
  /** Milliseconds of artificial delay before every operation, for exercising pending UI states. */
  readonly latency?: number;
}

interface Stored { bytes: Uint8Array; version: string; mtime: string }

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
  #ready: Promise<void>;
  #published: PublishPayload | undefined;

  constructor(files: Record<string, string | Uint8Array> = {}, opts: MemoryBackendOptions = {}) {
    this.#latency = opts.latency ?? 0;
    this.#ready = (async () => {
      for (const [path, content] of Object.entries(files)) await this.#put(path, toBytes(content));
    })();
  }

  /** The payload of the last {@link publish} call, or `undefined` if nothing was published. */
  get published(): PublishPayload | undefined { return this.#published; }

  async #tick(): Promise<void> {
    await this.#ready;
    if (this.#latency > 0) await new Promise<void>((r) => setTimeout(r, this.#latency));
  }

  async #put(path: string, bytes: Uint8Array): Promise<string> {
    const version = await hash(bytes);
    this.#files.set(path, { bytes, version, mtime: new Date().toISOString() });
    return version;
  }

  #entry(path: string, f: Stored): FileEntry {
    return { path, version: f.version, size: f.bytes.byteLength, mtime: f.mtime };
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

  async write(path: string, text: string, opts?: WriteOptions): Promise<{ version: string }> {
    await this.#tick();
    const current = this.#files.get(path);
    if (opts?.version !== undefined && current !== undefined && current.version !== opts.version)
      throw new ConflictError({ path, theirs: decoder.decode(current.bytes), version: current.version });
    return { version: await this.#put(path, encoder.encode(text)) };
  }

  async upload(file: Blob | File, path?: string): Promise<UploadResult> {
    await this.#tick();
    const name = "name" in file && typeof file.name === "string" && file.name !== "" ? file.name : "upload.bin";
    const target = path ?? `media/${name}`;
    const version = await this.#put(target, new Uint8Array(await file.arrayBuffer()));
    // No origin to speak of in memory, so the url is just the folder-relative path.
    return { path: target, url: target, version };
  }

  async delete(path: string): Promise<void> {
    await this.#tick();
    this.#require(path);
    this.#files.delete(path);
  }

  async rename(from: string, to: string): Promise<{ version: string }> {
    await this.#tick();
    const f = this.#require(from);
    this.#files.delete(from);
    return { version: await this.#put(to, f.bytes) };
  }

  async stat(path: string): Promise<FileEntry | null> {
    await this.#tick();
    const f = this.#files.get(path);
    return f === undefined ? null : this.#entry(path, f);
  }

  async publish(payload: PublishPayload): Promise<{ publishedAt: string }> {
    await this.#tick();
    this.#published = payload;
    return { publishedAt: new Date().toISOString() };
  }

  subscribe(cb: (ev: BackendChange) => void): () => void {
    this.#listeners.add(cb);
    return () => { this.#listeners.delete(cb); };
  }

  /**
   * Simulate someone else changing the folder: applies the change (bypassing `If-Match`, since it
   * did not come from us) and notifies subscribers, exactly as an SSE event would.
   */
  async emit(ev: { type: "changed" | "deleted"; path: string; text?: string; bytes?: Uint8Array }): Promise<void> {
    await this.#ready;
    let version: string | undefined;
    if (ev.type === "deleted") this.#files.delete(ev.path);
    else if (ev.bytes !== undefined) version = await this.#put(ev.path, ev.bytes);
    else if (ev.text !== undefined) version = await this.#put(ev.path, encoder.encode(ev.text));
    else version = this.#files.get(ev.path)?.version;
    const change: BackendChange = { type: ev.type, path: ev.path, ...(version === undefined ? {} : { version }) };
    for (const cb of [...this.#listeners]) cb(change);
  }
}
