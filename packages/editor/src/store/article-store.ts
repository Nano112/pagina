/**
 * `ArticleStore` — the only thing the editor UI is allowed to talk to.
 *
 * It keeps an in-memory mirror of the article folder and makes every edit land locally first:
 * `setText` is synchronous, and persistence happens behind it (debounced per file, retried with
 * backoff, versioned with `If-Match`). A 409 never overwrites anyone: the file goes to `conflict`
 * and waits for `resolveConflict`.
 *
 * The mirror doubles as a `ContentFs`, so `@pagina/core` can render a live preview of unsaved text
 * without a round trip.
 */
import {
  parseArticleConfig, renderArticle, renderPage,
  type ArticleConfig, type ContentFs, type NavEntry, type NavPage, type RenderedArticle, type RenderedPage,
} from "@pagina/core";
import type { ArticleBackend, BackendChange, FileEntry, UploadResult } from "./types.js";
import { ConflictError } from "./types.js";

export type FileStatus = "saved" | "saving" | "dirty" | "error" | "conflict";

export interface FileState {
  readonly path: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
  readonly version: string;
  readonly dirty: boolean;
  readonly status: FileStatus;
  /** Why the last save failed, for the error banner. */
  readonly error?: string;
  /** The server's text at the time of the conflict; fetched lazily for conflicts raised by events. */
  readonly theirs?: string;
}

export interface StoreStatus {
  readonly state: FileStatus;
  readonly lastSavedAt?: string;
}

export interface ArticleStoreOptions {
  /** Quiet period before an edited file is written. Default 500 ms. */
  readonly debounceMs?: number;
  /** Retries after the first failed write, at 250/500/1000 ms. Default 3. */
  readonly maxRetries?: number;
  /** Site base passed through to the renderer. Default "/". */
  readonly base?: string;
}

export interface StoreEventMap {
  /** A file's content changed (local edit, adopted remote change, resolved conflict). */
  change: string;
  /** The aggregate status changed. */
  status: StoreStatus;
  /** The file list changed (create, upload, delete, rename, load). */
  files: void;
}
export type StoreEvent = keyof StoreEventMap;

const BACKOFF_MS = [250, 500, 1000] as const;

const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "yaml", "yml", "json", "txt", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "css", "html", "htm", "svg", "rs", "py", "toml", "sh", "php", "go", "java", "c", "h", "cpp",
]);

function isTextPath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Status precedence when rolling per-file states into one: the worst news wins. */
const RANK: Record<FileStatus, number> = { saved: 0, dirty: 1, saving: 2, error: 3, conflict: 4 };

function flattenNav(entries: readonly NavEntry[]): NavPage[] {
  return entries.flatMap((e) => ("section" in e ? flattenNav(e.children) : [e]));
}

interface Record_ {
  path: string;
  text: string | undefined;
  bytes: Uint8Array | undefined;
  version: string;
  dirty: boolean;
  status: FileStatus;
  error: string | undefined;
  theirs: string | undefined;
  /** The server version we lost to, so "overwrite with mine" can pass a valid `If-Match`. */
  remoteVersion: string | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  attempt: number;
  saving: Promise<void> | undefined;
  pending: boolean;
}

export class ArticleStore {
  readonly #backend: ArticleBackend;
  readonly #debounceMs: number;
  readonly #maxRetries: number;
  readonly #base: string;

  readonly #recs = new Map<string, Record_>();
  readonly #entries = new Map<string, FileEntry>();
  /** Files reached through a snippet root outside the folder (`../…`); never part of `files`. */
  readonly #external = new Map<string, string>();
  readonly #listeners = new Map<StoreEvent, Set<(payload: never) => void>>();

  #article: ArticleConfig | undefined;
  #lastSavedAt: string | undefined;
  #unsubscribe: (() => void) | undefined;
  #destroyed = false;

  constructor(backend: ArticleBackend, opts: ArticleStoreOptions = {}) {
    this.#backend = backend;
    this.#debounceMs = opts.debounceMs ?? 500;
    this.#maxRetries = opts.maxRetries ?? 3;
    this.#base = opts.base ?? "/";
    this.#unsubscribe = backend.subscribe?.((ev) => { void this.#onExternal(ev); });
  }

  // ---------------------------------------------------------------------------- reading the mirror

  /** Every file the store knows about, keyed by folder-relative posix path. */
  get files(): ReadonlyMap<string, FileState> {
    const out = new Map<string, FileState>();
    for (const [path, r] of this.#recs) out.set(path, this.#snapshot(r));
    return out;
  }

  /** The whole folder listing, including files never opened. */
  list(): readonly FileEntry[] {
    const seen = new Map<string, FileEntry>(this.#entries);
    for (const [path, r] of this.#recs) if (!seen.has(path)) seen.set(path, { path, version: r.version });
    return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  get article(): ArticleConfig | undefined { return this.#article; }
  get nav(): readonly NavEntry[] { return this.#article?.nav ?? []; }

  /** The nav flattened to an ordered page list — what a sidebar and the renderer both want. */
  navPages(): readonly NavPage[] { return flattenNav(this.nav); }
  navPaths(): ReadonlySet<string> { return new Set(this.navPages().map((p) => p.page)); }

  get status(): StoreStatus {
    let worst: FileStatus = "saved";
    for (const r of this.#recs.values()) if (RANK[r.status] > RANK[worst]) worst = r.status;
    return { state: worst, ...(this.#lastSavedAt === undefined ? {} : { lastSavedAt: this.#lastSavedAt }) };
  }

  #snapshot(r: Record_): FileState {
    return {
      path: r.path, version: r.version, dirty: r.dirty, status: r.status,
      ...(r.text === undefined ? {} : { text: r.text }),
      ...(r.bytes === undefined ? {} : { bytes: r.bytes }),
      ...(r.error === undefined ? {} : { error: r.error }),
      ...(r.theirs === undefined ? {} : { theirs: r.theirs }),
    };
  }

  // ------------------------------------------------------------------------------------- lifecycle

  /** Lists the folder and reads `article.yaml`; everything else is read on demand. */
  async load(): Promise<ArticleConfig> {
    for (const entry of await this.#backend.list()) this.#entries.set(entry.path, entry);
    const { text, version } = await this.#backend.read("article.yaml");
    this.#adopt("article.yaml", text, version);
    this.#article = parseArticleConfig(text);
    this.#emit("files", undefined);
    return this.#article;
  }

  /** Reads a file into the mirror if it is not there yet. Binary files land in `bytes`. */
  async open(path: string): Promise<FileState> {
    const existing = this.#recs.get(path);
    if (existing !== undefined && (existing.text !== undefined || existing.bytes !== undefined))
      return this.#snapshot(existing);
    if (isTextPath(path)) {
      const { text, version } = await this.#backend.read(path);
      return this.#snapshot(this.#adopt(path, text, version));
    }
    const { bytes, version } = await this.#backend.readBinary(path);
    const r = this.#rec(path);
    r.bytes = bytes; r.version = version; r.dirty = false; r.status = "saved";
    return this.#snapshot(r);
  }

  /** Drops timers and the backend subscription. The mirror is left alone; unsaved edits are lost. */
  destroy(): void {
    this.#destroyed = true;
    for (const r of this.#recs.values()) if (r.timer !== undefined) { clearTimeout(r.timer); r.timer = undefined; }
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }

  // ------------------------------------------------------------------------------------ mutations

  /** Applies an edit to the mirror immediately and queues the write. Never throws. */
  setText(path: string, text: string): void {
    const r = this.#rec(path);
    if (r.text === text && r.dirty) return;
    r.text = text;
    r.dirty = true;
    r.error = undefined;
    r.attempt = 0;
    this.#setStatus(r, "dirty");
    this.#emit("change", path);
    this.#schedule(r);
  }

  /**
   * Writes every dirty file now and resolves once the queue has settled — including writes that
   * were already in flight, so callers can rely on the backend being up to date afterwards.
   */
  async flush(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const r of this.#recs.values()) {
      if (r.timer !== undefined) { clearTimeout(r.timer); r.timer = undefined; }
      if (r.saving !== undefined) jobs.push(r.saving);
      else if (r.dirty && r.status !== "conflict") jobs.push(this.#save(r));
    }
    await Promise.all(jobs);
  }

  /** Resumes saving a file that ran out of retries. */
  async retry(path: string): Promise<void> {
    const r = this.#recs.get(path);
    if (r === undefined || !r.dirty) return;
    r.attempt = 0;
    r.error = undefined;
    await this.#save(r);
  }

  /**
   * Ends a conflict. `"theirs"` discards the local edit and takes the server text; `"mine"` re-writes
   * the local text against the server's current version, so it wins deliberately rather than by luck.
   */
  async resolveConflict(path: string, choice: "theirs" | "mine"): Promise<void> {
    const r = this.#recs.get(path);
    if (r === undefined || r.status !== "conflict") return;
    let theirs = r.theirs;
    let version = r.remoteVersion;
    if (theirs === undefined || version === undefined) {
      const fresh = await this.#backend.read(path);   // conflicts raised by an event carry no body
      theirs = fresh.text;
      version = fresh.version;
    }
    r.theirs = undefined;
    r.remoteVersion = undefined;
    r.error = undefined;
    r.attempt = 0;
    if (choice === "theirs") {
      r.text = theirs;
      r.version = version;
      r.dirty = false;
      this.#setStatus(r, "saved");
      this.#emit("change", path);
      return;
    }
    r.version = version;
    r.dirty = true;
    this.#setStatus(r, "dirty");
    await this.#save(r);
  }

  /** Creates a file on the backend and in the mirror. */
  async createFile(path: string, text = ""): Promise<FileState> {
    const { version } = await this.#backend.write(path, text);
    const r = this.#adopt(path, text, version);
    this.#entries.set(path, { path, version });
    this.#emit("files", undefined);
    return this.#snapshot(r);
  }

  /** Uploads a blob (default target `media/<name>`) and records it in the mirror. */
  async uploadFile(file: Blob | File, path?: string): Promise<UploadResult> {
    const result = path === undefined ? await this.#backend.upload(file) : await this.#backend.upload(file, path);
    const r = this.#rec(result.path);
    r.version = result.version; r.dirty = false; r.status = "saved";
    this.#entries.set(result.path, { path: result.path, version: result.version });
    this.#emit("files", undefined);
    return result;
  }

  async deleteFile(path: string): Promise<void> {
    await this.#backend.delete(path);
    this.#forget(path);
    this.#emit("files", undefined);
  }

  async renameFile(from: string, to: string): Promise<void> {
    const { version } = await this.#backend.rename(from, to);
    const old = this.#recs.get(from);
    this.#forget(from);
    const r = this.#rec(to);
    r.text = old?.text; r.bytes = old?.bytes; r.version = version; r.dirty = false; r.status = "saved";
    this.#entries.set(to, { path: to, version });
    this.#emit("files", undefined);
  }

  // -------------------------------------------------------------------------------------- rendering

  /**
   * Renders one page from the mirror — unsaved text included — through `@pagina/core`.
   *
   * Snippet roots that point outside the folder (`../…`) cannot come from the mirror, which only
   * ever holds folder-relative paths. The `ContentFs` therefore falls back to `backend.read` for
   * such paths; a backend that refuses to serve them (the HTTP one will 404, since the listing never
   * contains `..`) simply produces core's usual `snippet-missing` diagnostic and placeholder.
   */
  async render(path: string): Promise<RenderedPage> {
    const config = this.#requireArticle();
    const { page } = await renderPage({
      fs: this.contentFs(), config, path, navPages: this.navPaths(), base: this.#base,
    });
    return page;
  }

  /** Renders the whole article, non-strict, so the UI can show diagnostics instead of crashing. */
  async renderAll(): Promise<RenderedArticle> {
    return await renderArticle({ fs: this.contentFs(), strict: false, base: this.#base });
  }

  /** Renders everything and ships it, along with the figure SVGs the caller rendered in the browser. */
  async publish(figures: Readonly<Record<string, Readonly<Record<string, string>>>> = {}): Promise<{ publishedAt: string }> {
    const rendered = await this.renderAll();
    const pages = Object.fromEntries(Object.entries(rendered.pages).map(([href, page]) => [href, page.html]));
    return await this.#backend.publish({ manifest: rendered.manifest, pages, figures });
  }

  /** A `ContentFs` view of the mirror, with a per-instance cache so one render asks the backend once. */
  contentFs(): ContentFs {
    const misses = new Set<string>();
    const readText = async (path: string): Promise<string> => {
      const r = this.#recs.get(path);
      if (r?.text !== undefined) return r.text;
      const cached = this.#external.get(path);
      if (cached !== undefined) return cached;
      const { text, version } = await this.#backend.read(path);
      if (path.startsWith("../")) this.#external.set(path, text);
      else this.#adopt(path, text, version);
      return text;
    };
    return {
      read: readText,
      readBinary: async (path) => {
        const r = this.#recs.get(path);
        if (r?.bytes !== undefined) return r.bytes;
        return (await this.#backend.readBinary(path)).bytes;
      },
      exists: async (path) => {
        if (this.#recs.has(path) || this.#entries.has(path) || this.#external.has(path)) return true;
        if (misses.has(path)) return false;
        const found = await this.#backend.stat(path).catch(() => null);
        if (found === null) { misses.add(path); return false; }
        return true;
      },
      list: async () => this.list().map((f) => f.path),
    };
  }

  // ----------------------------------------------------------------------------------------- events

  on<E extends StoreEvent>(event: E, cb: (payload: StoreEventMap[E]) => void): () => void {
    let set = this.#listeners.get(event);
    if (set === undefined) { set = new Set(); this.#listeners.set(event, set); }
    const listener = cb as (payload: never) => void;
    set.add(listener);
    return () => { this.#listeners.get(event)?.delete(listener); };
  }

  #emit<E extends StoreEvent>(event: E, payload: StoreEventMap[E]): void {
    for (const cb of [...(this.#listeners.get(event) ?? [])]) (cb as (p: StoreEventMap[E]) => void)(payload);
  }

  // ---------------------------------------------------------------------------------------- saving

  #rec(path: string): Record_ {
    let r = this.#recs.get(path);
    if (r === undefined) {
      r = {
        path, text: undefined, bytes: undefined, version: this.#entries.get(path)?.version ?? "",
        dirty: false, status: "saved", error: undefined, theirs: undefined, remoteVersion: undefined,
        timer: undefined, attempt: 0, saving: undefined, pending: false,
      };
      this.#recs.set(path, r);
    }
    return r;
  }

  #adopt(path: string, text: string, version: string): Record_ {
    const r = this.#rec(path);
    r.text = text; r.version = version; r.dirty = false; r.error = undefined; r.status = "saved";
    return r;
  }

  #forget(path: string): void {
    const r = this.#recs.get(path);
    if (r?.timer !== undefined) clearTimeout(r.timer);
    this.#recs.delete(path);
    this.#entries.delete(path);
  }

  #requireArticle(): ArticleConfig {
    if (this.#article === undefined) throw new Error("ArticleStore: call load() before rendering");
    return this.#article;
  }

  #setStatus(r: Record_, status: FileStatus): void {
    if (r.status === status) return;
    r.status = status;
    this.#emit("status", this.status);
  }

  #schedule(r: Record_): void {
    if (r.timer !== undefined) clearTimeout(r.timer);
    r.timer = setTimeout(() => { r.timer = undefined; void this.#save(r); }, this.#debounceMs);
  }

  #save(r: Record_): Promise<void> {
    if (r.saving !== undefined) { r.pending = true; return r.saving; }
    if (r.timer !== undefined) { clearTimeout(r.timer); r.timer = undefined; }
    const run = this.#runSave(r).finally(() => {
      r.saving = undefined;
      if (r.pending) {
        r.pending = false;
        if (r.dirty && r.status !== "conflict" && r.status !== "error") void this.#save(r);
      }
    });
    r.saving = run;
    return run;
  }

  async #runSave(r: Record_): Promise<void> {
    for (;;) {
      if (!r.dirty || this.#destroyed) return;
      const text = r.text ?? "";
      this.#setStatus(r, "saving");
      try {
        const { version } = await this.#backend.write(r.path, text, r.version === "" ? {} : { version: r.version });
        r.version = version;
        r.attempt = 0;
        r.error = undefined;
        this.#entries.set(r.path, { path: r.path, version });
        this.#lastSavedAt = new Date().toISOString();
        if (r.text !== text) continue;   // a newer edit arrived mid-flight; save it too
        r.dirty = false;
        this.#setStatus(r, "saved");
        this.#emit("status", this.status);
        return;
      } catch (e) {
        if (e instanceof ConflictError) {
          r.theirs = e.theirs;
          r.remoteVersion = e.version;
          r.error = e.message;
          this.#setStatus(r, "conflict");
          return;
        }
        r.attempt += 1;
        r.error = messageOf(e);
        if (r.attempt > this.#maxRetries) { this.#setStatus(r, "error"); return; }
        await new Promise<void>((resolve) => setTimeout(resolve, BACKOFF_MS[r.attempt - 1] ?? 1000));
      }
    }
  }

  // ------------------------------------------------------------------------------- external changes

  async #onExternal(ev: BackendChange): Promise<void> {
    if (this.#destroyed) return;
    const r = this.#recs.get(ev.path);
    if (ev.type === "deleted") {
      if (r?.dirty === true) { r.remoteVersion = undefined; r.error = `${ev.path} was deleted on the server`; this.#setStatus(r, "conflict"); return; }
      this.#forget(ev.path);
      this.#emit("files", undefined);
      return;
    }
    if (r === undefined) {
      this.#entries.set(ev.path, { path: ev.path, ...(ev.version === undefined ? {} : { version: ev.version }) } as FileEntry);
      this.#emit("files", undefined);
      return;
    }
    if (r.dirty) {
      // Someone else moved while we were editing: flag it, but leave the local text on screen. The
      // server's version is fetched only if the author actually asks to see it.
      if (r.timer !== undefined) { clearTimeout(r.timer); r.timer = undefined; }
      r.theirs = undefined;
      r.remoteVersion = ev.version;
      r.error = `${ev.path} changed on the server`;
      this.#setStatus(r, "conflict");
      return;
    }
    if (r.text === undefined && r.bytes === undefined) {
      if (ev.version !== undefined) r.version = ev.version;
      return;
    }
    if (r.text !== undefined) {
      const { text, version } = await this.#backend.read(ev.path);
      r.text = text; r.version = version;
    } else {
      const { bytes, version } = await this.#backend.readBinary(ev.path);
      r.bytes = bytes; r.version = version;
    }
    this.#emit("change", ev.path);
  }
}
