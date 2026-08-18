/**
 * The three shipped backends, run against one contract.
 *
 * `MemoryBackend` and `LocalStorageBackend` are driven directly. `HttpBackend` is driven through an
 * in-process implementation of the documented HTTP contract (`httpServer` below) backed by a
 * `MemoryBackend`, which makes this a round trip over the real request/response code rather than a
 * conversation with hand-written stubs. `http-backend.test.ts` keeps its own tests for the parts
 * only that backend has — header shapes, ETag parsing, error bodies.
 */
import { afterEach, describe, expect, it } from "vitest";
import { describeBackendContract } from "./backend-contract.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { HttpBackend } from "../src/store/http-backend.js";
import {
  LocalStorageBackend, StorageQuotaError, hasLocalStorage,
  type LocalStorageBackendOptions, type StorageEventLike, type StorageEventTarget, type StorageLike,
} from "../src/store/local-storage-backend.js";
import { BackendError } from "../src/store/types.js";

// --- a `Storage` and a `window`, in memory ------------------------------------------------------

/** Records every mutation so a test can replay it as the `storage` events another tab would see. */
class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  readonly log: { key: string | null; newValue: string | null }[] = [];
  /** When set, `setItem` throws it once — the only way to exercise the quota path deterministically. */
  failNext: unknown;

  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (this.failNext !== undefined) {
      const e = this.failNext;
      this.failNext = undefined;
      throw e;
    }
    this.map.set(k, v);
    this.log.push({ key: k, newValue: v });
  }
  removeItem(k: string): void {
    if (this.map.delete(k)) this.log.push({ key: k, newValue: null });
  }
  clear(): void { this.map.clear(); this.log.push({ key: null, newValue: null }); }
  drain(): { key: string | null; newValue: string | null }[] { return this.log.splice(0, this.log.length); }
}

class FakeWindow implements StorageEventTarget {
  readonly listeners = new Set<(ev: StorageEventLike) => void>();
  addEventListener(_type: "storage", listener: (ev: StorageEventLike) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "storage", listener: (ev: StorageEventLike) => void): void { this.listeners.delete(listener); }
  dispatch(ev: StorageEventLike): void { for (const l of [...this.listeners]) l(ev); }
}

// --- an in-process server speaking the HTTP contract --------------------------------------------

interface FakeSse { close(): void; push(data: unknown): void }

/**
 * `fetch` implementing `GET/PUT /files`, `POST /upload|rename|publish`, `DELETE /files` over a
 * `MemoryBackend`, plus a stand-in `EventSource` for `/events`. It is the same shape the Vite
 * middleware and the Laravel controllers implement, which is what makes running `HttpBackend`
 * against it meaningful.
 */
function httpServer(seed: Record<string, string>): {
  base: string;
  fetch: typeof globalThis.fetch;
  store: MemoryBackend;
  sse: FakeSse[];
  restoreEventSource(): void;
} {
  const base = "https://articles.test/api/articles/demo";
  const store = new MemoryBackend(seed);
  const sse: FakeSse[] = [];

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const rest = url.pathname.slice(new URL(base).pathname.length);
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    try {
      if (rest === "/files" && method === "GET") return json({ files: await store.list() });

      if (rest.startsWith("/files/")) {
        const path = rest.slice("/files/".length).split("/").map(decodeURIComponent).join("/");
        if (method === "GET") {
          const { bytes, version } = await store.readBinary(path);
          return new Response(bytes as BodyInit, { status: 200, headers: { ETag: `"${version}"` } });
        }
        if (method === "PUT") {
          const ifMatch = new Headers(init.headers).get("If-Match");
          const version = ifMatch === null ? undefined : ifMatch.replace(/^W\//, "").replace(/^"|"$/g, "");
          return json(await store.write(path, String(init.body ?? ""), { version }));
        }
        if (method === "DELETE") {
          await store.delete(path);
          return new Response(null, { status: 204 });
        }
      }

      if (rest === "/upload" && method === "POST") {
        const form = await new Request(base, { method: "POST", body: init.body as BodyInit }).formData();
        const file = form.get("file");
        if (!(file instanceof Blob)) return json({ message: "no file" }, 400);
        const at = form.get("path");
        return json(await store.upload(file, typeof at === "string" ? at : undefined));
      }
      if (rest === "/rename" && method === "POST") {
        const { from, to } = JSON.parse(String(init.body)) as { from: string; to: string };
        return json(await store.rename(from, to));
      }
      if (rest === "/publish" && method === "POST") {
        return json(await store.publish(JSON.parse(String(init.body)) as never));
      }
      return json({ message: `no route for ${method} ${rest}` }, 404);
    } catch (e) {
      // The server half of the contract: a conflict is a 409 carrying the other side.
      if (e instanceof BackendError && e.status === 409) {
        const conflict = e as { theirs?: string; version?: string };
        return json({ message: e.message, theirs: conflict.theirs, version: conflict.version }, 409);
      }
      if (e instanceof BackendError && e.status !== undefined) return json({ message: e.message }, e.status);
      throw e;
    }
  };

  const previous = (globalThis as { EventSource?: unknown }).EventSource;
  class StubEventSource {
    onmessage: ((e: { data: string }) => void) | null = null;
    #open = true;
    readonly url: string;
    constructor(url: string) {
      this.url = url;
      sse.push({
        close: () => { this.#open = false; },
        push: (data: unknown) => { if (this.#open) this.onmessage?.({ data: JSON.stringify(data) }); },
      });
    }
    close(): void { this.#open = false; }
  }
  (globalThis as { EventSource?: unknown }).EventSource = StubEventSource;

  return {
    base, store, sse,
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    restoreEventSource(): void { (globalThis as { EventSource?: unknown }).EventSource = previous; },
  };
}

// --- the contract, three times ------------------------------------------------------------------

describe("MemoryBackend / the contract", () => {
  describeBackendContract((seed) => {
    const backend = new MemoryBackend(seed);
    return {
      backend,
      external: async (ev) => {
        await backend.emit(ev.text === undefined ? ev : { type: ev.type, path: ev.path, text: ev.text });
      },
    };
  });
});

describe("LocalStorageBackend / the contract", () => {
  describeBackendContract((seed) => {
    const storage = new FakeStorage();
    const events = new FakeWindow();
    const backend = new LocalStorageBackend({ namespace: "contract", storage, events, seed });
    // A second instance on the same storage *is* the second tab: it writes, and the events its
    // writes produce are delivered to the first, which is exactly the browser's behaviour.
    const otherTab = new LocalStorageBackend({ namespace: "contract", storage, events: null });
    storage.drain();
    return {
      backend,
      external: async (ev) => {
        if (ev.type === "deleted") await otherTab.delete(ev.path);
        else await otherTab.write(ev.path, ev.text ?? "");
        for (const change of storage.drain()) events.dispatch({ ...change, storageArea: storage });
      },
      cleanup: () => { backend.destroy(); },
    };
  });
});

describe("HttpBackend / the contract", () => {
  describeBackendContract((seed) => {
    const server = httpServer(seed);
    const backend = new HttpBackend({ baseUrl: server.base, fetch: server.fetch });
    return {
      backend,
      external: async (ev) => {
        if (ev.type === "deleted") await server.store.emit({ type: "deleted", path: ev.path });
        else await server.store.emit({ type: "changed", path: ev.path, text: ev.text ?? "" });
        const latest = await server.store.stat(ev.path);
        for (const source of server.sse) {
          source.push({
            type: ev.type, path: ev.path,
            ...(latest === null ? {} : { version: latest.version }),
          });
        }
      },
      cleanup: () => { server.restoreEventSource(); },
    };
  });
});

// --- what only the localStorage backend has ------------------------------------------------------

describe("LocalStorageBackend", () => {
  const made: LocalStorageBackend[] = [];
  const make = (opts: LocalStorageBackendOptions = {}): LocalStorageBackend => {
    const b = new LocalStorageBackend(opts);
    made.push(b);
    return b;
  };
  afterEach(() => { for (const b of made.splice(0)) b.destroy(); });

  it("namespaces its keys so two articles on one origin cannot collide", async () => {
    const storage = new FakeStorage();
    const a = make({ namespace: "alpha", storage, events: null, seed: { "index.md": "# A\n" } });
    const b = make({ namespace: "beta", storage, events: null, seed: { "index.md": "# B\n" } });

    await a.write("index.md", "# A edited\n");
    expect((await b.read("index.md")).text).toEqual("# B\n");
    expect([...storage.map.keys()].filter((k) => k.startsWith("pagina:alpha:")).length).toBeGreaterThan(0);
    expect([...storage.map.keys()].some((k) => k.startsWith("pagina:beta:file:index.md"))).toBe(true);
  });

  it("refuses a namespace that would make keys ambiguous", () => {
    expect(() => new LocalStorageBackend({ namespace: "a:b", storage: new FakeStorage(), events: null }))
      .toThrow(/namespace/);
    expect(() => new LocalStorageBackend({ namespace: "", storage: new FakeStorage(), events: null }))
      .toThrow(/namespace/);
  });

  it("keeps versions monotonic even when the same bytes are written twice", async () => {
    const backend = make({ namespace: "v", storage: new FakeStorage(), events: null, seed: { "index.md": "x" } });
    const first = (await backend.read("index.md")).version;
    const second = (await backend.write("index.md", "same", { version: first })).version;
    const third = (await backend.write("index.md", "same", { version: second })).version;
    expect(Number(second)).toBeGreaterThan(Number(first));
    expect(Number(third)).toBeGreaterThan(Number(second));
    // Which is the point: an identical write from another tab still conflicts here.
    await expect(backend.write("index.md", "same", { version: second })).rejects.toThrow(/conflict/i);
  });

  it("never reuses a version, so a stale one cannot match a re-created file", async () => {
    const backend = make({ namespace: "v2", storage: new FakeStorage(), events: null, seed: { "a.md": "1" } });
    const stale = (await backend.read("a.md")).version;
    await backend.delete("a.md");
    await backend.write("a.md", "recreated");
    expect((await backend.read("a.md")).version).not.toEqual(stale);
    await expect(backend.write("a.md", "mine", { version: stale })).rejects.toThrow(/conflict/i);
  });

  it("survives being rebuilt on the same storage — which is what a reload is", async () => {
    const storage = new FakeStorage();
    const first = make({ namespace: "reload", storage, events: null, seed: { "index.md": "# Seed\n" } });
    await first.write("index.md", "# The author's work\n");

    const second = make({ namespace: "reload", storage, events: null, seed: { "index.md": "# Seed\n" } });
    expect((await second.read("index.md")).text).toEqual("# The author's work\n");
  });

  it("seeds only what is missing, and reset puts the seed back", async () => {
    const storage = new FakeStorage();
    const seed = { "index.md": "# Seed\n", "article.yaml": "slug: demo\n" };
    const backend = make({ namespace: "seed", storage, events: null, seed });

    await backend.write("index.md", "# Edited\n");
    await backend.write("extra.md", "# Extra\n");
    await backend.seed(seed);
    expect((await backend.read("index.md")).text).toEqual("# Edited\n");

    await backend.reset();
    expect((await backend.read("index.md")).text).toEqual("# Seed\n");
    expect((await backend.list()).map((f) => f.path)).toEqual(["article.yaml", "index.md"]);
  });

  it("turns a quota failure into an actionable error, and loses nothing", async () => {
    const storage = new FakeStorage();
    const backend = make({ namespace: "quota", storage, events: null, seed: { "index.md": "# Safe\n" } });
    storage.failNext = new DOMException("exceeded the quota", "QuotaExceededError");

    const error = await backend.write("index.md", "# New\n").then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(StorageQuotaError);
    expect((error as StorageQuotaError).message).toMatch(/storage is full/);
    expect((error as StorageQuotaError).message).toMatch(/still in the editor/);
    expect((error as StorageQuotaError).status).toBe(507);
    // The previous content is intact: nothing was half-written.
    expect((await backend.read("index.md")).text).toEqual("# Safe\n");
  });

  it("refuses an upload that would swallow the whole budget, and says why", async () => {
    const backend = make({ namespace: "big", storage: new FakeStorage(), events: null, maxBinaryBytes: 64 });
    const file = new File([new Uint8Array(4096) as BlobPart], "huge.png", { type: "image/png" });
    const error = await backend.upload(file).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect((error as BackendError).status).toBe(413);
    expect((error as BackendError).message).toMatch(/limit for browser-stored uploads/);
    expect((await backend.list()).map((f) => f.path)).not.toContain("media/huge.png");
  });

  it("reports a foreign clear() as a deletion of everything it was holding", async () => {
    const storage = new FakeStorage();
    const events = new FakeWindow();
    const backend = make({ namespace: "wipe", storage, events, seed: { "index.md": "# A\n", "b.md": "# B\n" } });
    await backend.list();

    const seen: string[] = [];
    backend.subscribe((ev) => { seen.push(`${ev.type}:${ev.path}`); });
    storage.clear();
    events.dispatch({ key: null, newValue: null, storageArea: storage });
    expect(seen.sort()).toEqual(["deleted:b.md", "deleted:index.md"]);
  });

  it("ignores storage events from another store on the same page", async () => {
    const storage = new FakeStorage();
    const events = new FakeWindow();
    const backend = make({ namespace: "other", storage, events, seed: { "index.md": "# A\n" } });
    await backend.list();
    const seen: string[] = [];
    backend.subscribe((ev) => { seen.push(ev.path); });
    events.dispatch({ key: "pagina:other:file:index.md", newValue: "{\"v\":9,\"d\":\"x\"}", storageArea: new FakeStorage() });
    expect(seen).toEqual([]);
  });

  it("reports usage, so a host can show what the demo is costing", async () => {
    const backend = make({ namespace: "usage", storage: new FakeStorage(), events: null, seed: { "index.md": "# A\n" } });
    await backend.list();
    const usage = backend.usage();
    expect(usage.files).toBe(1);
    expect(usage.bytes).toBeGreaterThan(0);
  });

  it("says plainly when there is nowhere to save", () => {
    const broken = new FakeStorage();
    broken.failNext = new DOMException("denied", "QuotaExceededError");
    expect(hasLocalStorage(broken)).toBe(false);
    expect(hasLocalStorage(new FakeStorage())).toBe(true);
  });
});
