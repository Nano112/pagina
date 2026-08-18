/**
 * An {@link ArticleBackend} over the browser's `localStorage`.
 *
 * This is not demo scaffolding. It is the backend for the three situations where there is no server
 * to talk to: an author working offline, a test that wants persistence across a reload, and a
 * static site — a GitHub Pages docs site, a Blade page with the editor embedded and no article API
 * yet — where the editor still has to be usable. Everything the store relies on is here: real
 * per-file versions, real conflicts, and cross-tab notification.
 *
 * Three things about `localStorage` shape the design, and each one is a deliberate trade rather
 * than an accident:
 *
 * 1. **It stores strings, and about 5 MB of them per origin.** Binary uploads are therefore base64
 *    inside the same store, capped by {@link LocalStorageBackendOptions.maxBinaryBytes}, and a
 *    refusal above the cap is a clear error rather than a wedged article. See {@link upload}.
 * 2. **It is shared by the whole origin.** Every key is namespaced, so two demos — or a demo and a
 *    real app — on one origin cannot read or overwrite each other.
 * 3. **It fires a `storage` event in *other* tabs only.** That is precisely the signal
 *    {@link ArticleBackend.subscribe} wants, so two tabs on the same article produce genuine
 *    `changed`/`deleted` conflicts, exercising the store's conflict banner for real.
 *
 * Versions are a **monotonic counter shared by the namespace**, not a content hash. Two properties
 * follow, and both matter: writing the same bytes twice still moves the version, so a second tab's
 * save always conflicts with a stale `If-Match` even when the text happens to match; and a version
 * is never reused, so a stale version cannot accidentally match a file that was deleted and
 * recreated under the same path. The counter deliberately survives {@link reset}.
 */
import type {
  ArticleBackend, BackendChange, FileEntry, PublishPayload, UploadResult, WriteOptions,
} from "./types.js";
import { BackendError, ConflictError } from "./types.js";

/** The part of `Storage` this backend uses — small enough that a test can pass a plain object. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The part of a `StorageEvent` the cross-tab listener reads. */
export interface StorageEventLike {
  readonly key: string | null;
  readonly newValue: string | null;
  readonly storageArea?: unknown;
}

/** The part of `window` the cross-tab listener needs; `window` itself satisfies it. */
export interface StorageEventTarget {
  addEventListener(type: "storage", listener: (ev: StorageEventLike) => void): void;
  removeEventListener(type: "storage", listener: (ev: StorageEventLike) => void): void;
}

export interface LocalStorageBackendOptions {
  /**
   * Distinguishes this article's keys from everything else on the origin. Required in anything but
   * a throwaway, because the failure it prevents — two articles quietly sharing one `index.md` —
   * is silent. May not contain `:`.
   */
  readonly namespace?: string;
  /** Defaults to `globalThis.localStorage`. Injectable for tests and for non-browser hosts. */
  readonly storage?: StorageLike;
  /**
   * Where the cross-tab `storage` event is listened for; defaults to `globalThis.window`. Pass
   * `null` to opt out of cross-tab awareness entirely.
   */
  readonly events?: StorageEventTarget | null;
  /**
   * Files to write **if the namespace does not already have them**. Seeding is part of the backend
   * rather than something a host page does afterwards, because "seed unless the author has already
   * been here" is the only behaviour that survives a reload, and every host would otherwise have to
   * re-derive it. {@link reset} re-applies this set, overwriting.
   */
  readonly seed?: Readonly<Record<string, string | Uint8Array>>;
  /**
   * Largest upload accepted, in bytes of the *original* file (default 512 KB). base64 costs a
   * further third on top, and the whole origin shares roughly 5 MB, so the default leaves room for
   * an article rather than letting one photograph fill the store.
   */
  readonly maxBinaryBytes?: number;
  /** Milliseconds of artificial delay before every operation, for exercising pending UI states. */
  readonly latency?: number;
  /** Key prefix, ahead of the namespace. Only worth changing to avoid a clash with other software. */
  readonly keyPrefix?: string;
}

/**
 * The store is full. Distinct from a plain {@link BackendError} because the caller can do something
 * about it, and because losing an author's paragraph to an unhandled `QuotaExceededError` is the
 * single worst thing this backend could do. Nothing is written when this is thrown: `setItem`
 * either takes the whole value or takes none of it, so the previous contents of `path` survive and
 * the text is still in the editor.
 */
export class StorageQuotaError extends BackendError {
  readonly path: string;
  /** Size of the value that did not fit, in bytes. */
  readonly bytes: number;
  constructor(o: { path: string; bytes: number; message?: string }) {
    super(
      o.message ??
        `browser storage is full: ${o.path} (${formatBytes(o.bytes)}) did not fit in this ` +
          `browser's storage for this site, which is about 5 MB in total. Nothing was written and ` +
          `your text is still in the editor — delete an upload or reset the article to free space, ` +
          `then save again.`,
      507,
    );
    this.name = "StorageQuotaError";
    this.path = o.path;
    this.bytes = o.bytes;
  }
}

/** One stored file. `v` is the version, `b` marks base64, `s` is the decoded size in bytes. */
interface Stored {
  v: number;
  d: string;
  s: number;
  m: string;
  b?: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Every way a browser says "full". Chrome and Safari throw `QuotaExceededError` (code 22), Firefox
 * historically `NS_ERROR_DOM_QUOTA_REACHED` (code 1014), and a `Storage` shim in a test throws a
 * plain `Error`. Getting this wrong in the *permissive* direction is the safe way round: a
 * misdiagnosed error still reaches the caller, only with a less specific message.
 */
function isQuotaError(e: unknown): boolean {
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    return e.code === 22 || e.code === 1014 ||
      e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED";
  }
  return e instanceof Error && /quota|storage is full|exceeded/i.test(`${e.name} ${e.message}`);
}

/** Chunked so a multi-megabyte upload cannot blow the argument limit of `String.fromCharCode`. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Whether this runtime has a usable `localStorage`.
 *
 * The presence check alone is not enough: Safari in private browsing, and a browser with site data
 * blocked, both expose the object and throw on `setItem`. A host page that wants to offer the
 * editor only when it can actually save should call this rather than reading `typeof localStorage`.
 */
export function hasLocalStorage(storage?: StorageLike): boolean {
  const target = storage ?? (globalThis as { localStorage?: StorageLike }).localStorage;
  if (target === undefined) return false;
  const probe = "pagina:__probe__";
  try {
    target.setItem(probe, "1");
    target.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export class LocalStorageBackend implements ArticleBackend {
  readonly #storage: StorageLike;
  readonly #events: StorageEventTarget | null;
  readonly #filePrefix: string;
  readonly #seqKey: string;
  readonly #publishedKey: string;
  readonly #maxBinaryBytes: number;
  readonly #latency: number;
  readonly #seed: Readonly<Record<string, string | Uint8Array>>;
  readonly #listeners = new Set<(ev: BackendChange) => void>();
  /** Paths this instance has seen, so a foreign `localStorage.clear()` can be reported per file. */
  readonly #known = new Set<string>();
  readonly #ready: Promise<void>;
  #attached = false;
  #published: PublishPayload | undefined;

  constructor(opts: LocalStorageBackendOptions = {}) {
    const namespace = opts.namespace ?? "default";
    if (namespace === "" || namespace.includes(":")) {
      throw new BackendError(`invalid namespace ${JSON.stringify(namespace)}: it must be non-empty and contain no ":"`);
    }
    const storage = opts.storage ?? (globalThis as { localStorage?: StorageLike }).localStorage;
    if (storage === undefined) {
      throw new BackendError(
        "this browser has no localStorage, so the editor has nowhere to save. Private browsing and " +
          "blocked site data both look like this; a server-backed HttpBackend is the way to edit here.",
      );
    }
    this.#storage = storage;
    this.#events = opts.events === undefined
      ? ((globalThis as { window?: StorageEventTarget }).window ?? null)
      : opts.events;
    const prefix = opts.keyPrefix ?? "pagina:";
    this.#filePrefix = `${prefix}${namespace}:file:`;
    this.#seqKey = `${prefix}${namespace}:seq`;
    this.#publishedKey = `${prefix}${namespace}:published`;
    this.#maxBinaryBytes = opts.maxBinaryBytes ?? 512 * 1024;
    this.#latency = opts.latency ?? 0;
    this.#seed = opts.seed ?? {};
    this.#ready = this.seed(this.#seed);
  }

  /** The payload of the last {@link publish}; see that method for why it is not persisted. */
  get published(): PublishPayload | undefined { return this.#published; }

  // ---- storage primitives ----------------------------------------------------------------------

  #keyOf(path: string): string { return `${this.#filePrefix}${path}`; }

  #pathOf(key: string): string | undefined {
    return key.startsWith(this.#filePrefix) ? key.slice(this.#filePrefix.length) : undefined;
  }

  #set(key: string, value: string, path: string): void {
    try {
      this.#storage.setItem(key, value);
    } catch (e) {
      if (isQuotaError(e)) throw new StorageQuotaError({ path, bytes: value.length * 2 });
      throw e;
    }
  }

  /**
   * The next version.
   *
   * Written before the file it belongs to: burning a number on a write that then fails costs
   * nothing, whereas storing a file under a number the counter has not reached would let a later
   * write reuse it, and two different contents sharing a version is exactly the bug versions exist
   * to prevent.
   */
  #nextVersion(path: string): number {
    const raw = this.#storage.getItem(this.#seqKey);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    const next = (Number.isFinite(parsed) && parsed > 0 ? parsed : 0) + 1;
    this.#set(this.#seqKey, String(next), path);
    return next;
  }

  #load(path: string): Stored | undefined {
    const raw = this.#storage.getItem(this.#keyOf(path));
    if (raw === null) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt or foreign value under our key. Treating it as absent is the only option that lets
      // the author carry on working; throwing would wedge the whole article on one bad key.
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const rec = parsed as Partial<Stored>;
    if (typeof rec.v !== "number" || typeof rec.d !== "string") return undefined;
    this.#known.add(path);
    return {
      v: rec.v, d: rec.d, s: typeof rec.s === "number" ? rec.s : rec.d.length,
      m: typeof rec.m === "string" ? rec.m : new Date(0).toISOString(),
      ...(rec.b === true ? { b: true } : {}),
    };
  }

  #store(path: string, rec: Stored): void {
    this.#set(this.#keyOf(path), JSON.stringify(rec), path);
    this.#known.add(path);
  }

  #putText(path: string, text: string): number {
    const v = this.#nextVersion(path);
    this.#store(path, { v, d: text, s: encoder.encode(text).byteLength, m: new Date().toISOString() });
    return v;
  }

  #putBytes(path: string, bytes: Uint8Array): number {
    const v = this.#nextVersion(path);
    this.#store(path, { v, d: toBase64(bytes), s: bytes.byteLength, m: new Date().toISOString(), b: true });
    return v;
  }

  #paths(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.#storage.length; i++) {
      const key = this.#storage.key(i);
      if (key === null) continue;
      const path = this.#pathOf(key);
      if (path !== undefined) out.push(path);
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  #entry(path: string, rec: Stored): FileEntry {
    return { path, version: String(rec.v), size: rec.s, mtime: rec.m };
  }

  #text(rec: Stored): string {
    return rec.b === true ? decoder.decode(fromBase64(rec.d)) : rec.d;
  }

  async #tick(): Promise<void> {
    await this.#ready;
    if (this.#latency > 0) await new Promise<void>((r) => { setTimeout(r, this.#latency); });
  }

  #require(path: string): Stored {
    const rec = this.#load(path);
    if (rec === undefined) throw new BackendError(`not found: ${path}`, 404);
    return rec;
  }

  // ---- the contract ----------------------------------------------------------------------------

  async list(): Promise<FileEntry[]> {
    await this.#tick();
    const out: FileEntry[] = [];
    for (const path of this.#paths()) {
      const rec = this.#load(path);
      if (rec !== undefined) out.push(this.#entry(path, rec));
    }
    return out;
  }

  async read(path: string): Promise<{ text: string; version: string }> {
    await this.#tick();
    const rec = this.#require(path);
    return { text: this.#text(rec), version: String(rec.v) };
  }

  async readBinary(path: string): Promise<{ bytes: Uint8Array; version: string }> {
    await this.#tick();
    const rec = this.#require(path);
    return { bytes: rec.b === true ? fromBase64(rec.d) : encoder.encode(rec.d), version: String(rec.v) };
  }

  async write(path: string, text: string, opts?: WriteOptions): Promise<{ version: string }> {
    await this.#tick();
    const current = this.#load(path);
    if (opts?.version !== undefined && current !== undefined && String(current.v) !== opts.version) {
      throw new ConflictError({ path, theirs: this.#text(current), version: String(current.v) });
    }
    return { version: String(this.#putText(path, text)) };
  }

  /**
   * base64 into the same store, refused above {@link LocalStorageBackendOptions.maxBinaryBytes}.
   *
   * IndexedDB would hold far more, and was rejected: it would split the article across two stores
   * with two notions of "current", and — the deciding point — IndexedDB has no cross-tab event, so
   * the second tab would see text changes and miss uploads. One store, one version counter, one
   * `storage` event. The cost is honest and stated up front: a few hundred kilobytes of media, and
   * a refusal rather than a silent truncation above that.
   *
   * `url` is a `data:` URL because a browser store has no origin to serve from, and a data URL is
   * the one answer to "where can this be fetched from" that is actually true here.
   */
  async upload(file: Blob | File, path?: string): Promise<UploadResult> {
    await this.#tick();
    const name = "name" in file && typeof file.name === "string" && file.name !== "" ? file.name : "upload.bin";
    const target = path ?? `media/${name}`;
    if (file.size > this.#maxBinaryBytes) {
      throw new BackendError(
        `${name} is ${formatBytes(file.size)}, over the ${formatBytes(this.#maxBinaryBytes)} limit for ` +
          `browser-stored uploads. Browser storage holds about 5 MB for the whole site and base64 adds ` +
          `a third on top, so a file this size would leave no room for the article. Shrink it, or use a ` +
          `server-backed backend for media this large.`,
        413,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const version = String(this.#putBytes(target, bytes));
    const type = file.type === "" ? "application/octet-stream" : file.type;
    return { path: target, url: `data:${type};base64,${toBase64(bytes)}`, version };
  }

  async delete(path: string): Promise<void> {
    await this.#tick();
    this.#require(path);
    this.#storage.removeItem(this.#keyOf(path));
    this.#known.delete(path);
  }

  async rename(from: string, to: string): Promise<{ version: string }> {
    await this.#tick();
    const rec = this.#require(from);
    const v = this.#nextVersion(to);
    this.#store(to, { ...rec, v, m: new Date().toISOString() });
    this.#storage.removeItem(this.#keyOf(from));
    this.#known.delete(from);
    return { version: String(v) };
  }

  async stat(path: string): Promise<FileEntry | null> {
    await this.#tick();
    const rec = this.#load(path);
    return rec === undefined ? null : this.#entry(path, rec);
  }

  /**
   * Accepts a publish and keeps the payload **in memory only**.
   *
   * There is no publish target in a browser store, and a rendered article — every page's HTML plus
   * two SVGs per figure — is precisely the thing that would fill the 5 MB and take the author's
   * source down with it. Persisting the timestamp is enough for a host to say "published at", and
   * the payload stays reachable through {@link published} for the life of the page, which is what a
   * test or a preview pane actually wants.
   */
  async publish(payload: PublishPayload): Promise<{ publishedAt: string }> {
    await this.#tick();
    this.#published = payload;
    const publishedAt = new Date().toISOString();
    this.#set(this.#publishedKey, JSON.stringify({ publishedAt }), this.#publishedKey);
    return { publishedAt };
  }

  /** When {@link publish} was last called in *any* tab, or `undefined`. */
  get publishedAt(): string | undefined {
    const raw = this.#storage.getItem(this.#publishedKey);
    if (raw === null) return undefined;
    try {
      const parsed = JSON.parse(raw) as { publishedAt?: unknown };
      return typeof parsed.publishedAt === "string" ? parsed.publishedAt : undefined;
    } catch {
      return undefined;
    }
  }

  // ---- cross-tab ---------------------------------------------------------------------------

  #onStorage = (ev: StorageEventLike): void => {
    // `storageArea` pins the event to the store we were given; a page using both `localStorage` and
    // `sessionStorage` would otherwise cross the streams.
    if (ev.storageArea != null && ev.storageArea !== this.#storage) return;
    if (ev.key === null) {
      // Another tab called `clear()`: everything is gone and there is no key to name, so report the
      // paths this instance knows about — which is what the store is holding open.
      for (const path of [...this.#known]) {
        this.#known.delete(path);
        this.#emit({ type: "deleted", path });
      }
      return;
    }
    const path = this.#pathOf(ev.key);
    if (path === undefined) return;
    if (ev.newValue === null) {
      this.#known.delete(path);
      this.#emit({ type: "deleted", path });
      return;
    }
    let version: string | undefined;
    try {
      const parsed = JSON.parse(ev.newValue) as { v?: unknown };
      if (typeof parsed.v === "number") version = String(parsed.v);
    } catch { /* a value we cannot read is still a change; report it without a version */ }
    this.#known.add(path);
    this.#emit({ type: "changed", path, ...(version === undefined ? {} : { version }) });
  };

  #emit(change: BackendChange): void {
    for (const cb of [...this.#listeners]) cb(change);
  }

  /**
   * Cross-tab awareness, over the DOM `storage` event.
   *
   * The event fires in every *other* tab on the origin and never in the one that wrote, which is
   * exactly the semantics the store's `changed`/`deleted` handling was written for. Two tabs open
   * on one article is therefore a real, reachable conflict rather than a unit-test fixture.
   */
  subscribe(cb: (ev: BackendChange) => void): () => void {
    this.#listeners.add(cb);
    if (!this.#attached && this.#events !== null) {
      this.#events.addEventListener("storage", this.#onStorage);
      this.#attached = true;
    }
    return () => {
      this.#listeners.delete(cb);
      if (this.#listeners.size === 0 && this.#attached && this.#events !== null) {
        this.#events.removeEventListener("storage", this.#onStorage);
        this.#attached = false;
      }
    };
  }

  // ---- seeding and reset ---------------------------------------------------------------------

  /**
   * Writes `files`, skipping any path that already exists unless `overwrite` is set.
   *
   * Skipping is the default because the caller that seeds is almost always a page that runs on
   * every load, and overwriting there would delete the author's work every time they came back.
   */
  async seed(
    files: Readonly<Record<string, string | Uint8Array>>,
    opts: { readonly overwrite?: boolean } = {},
  ): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      if (opts.overwrite !== true && this.#load(path) !== undefined) continue;
      if (typeof content === "string") this.#putText(path, content);
      else this.#putBytes(path, content);
    }
    await Promise.resolve();
  }

  /** Deletes every file in this namespace. The version counter is kept; see the class comment. */
  async clear(): Promise<void> {
    for (const path of this.#paths()) {
      this.#storage.removeItem(this.#keyOf(path));
      this.#known.delete(path);
    }
    this.#storage.removeItem(this.#publishedKey);
    this.#published = undefined;
    await Promise.resolve();
  }

  /**
   * Back to the article this backend was constructed with: every file removed, the constructor's
   * seed written again. The version counter deliberately keeps climbing, so an editor still holding
   * a pre-reset version conflicts instead of silently writing over the fresh copy.
   */
  async reset(): Promise<void> {
    await this.clear();
    await this.seed(this.#seed, { overwrite: true });
  }

  /**
   * Roughly what this namespace costs in the browser's budget: `bytes` counts two per UTF-16 code
   * unit of every key and value, which is how browsers charge for `localStorage`.
   */
  usage(): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;
    for (let i = 0; i < this.#storage.length; i++) {
      const key = this.#storage.key(i);
      if (key === null || this.#pathOf(key) === undefined) continue;
      files++;
      bytes += (key.length + (this.#storage.getItem(key)?.length ?? 0)) * 2;
    }
    return { files, bytes };
  }

  /** Detaches the cross-tab listener. Safe to call more than once. */
  destroy(): void {
    this.#listeners.clear();
    if (this.#attached && this.#events !== null) {
      this.#events.removeEventListener("storage", this.#onStorage);
      this.#attached = false;
    }
  }
}
