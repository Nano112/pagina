import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArticleConfig, renderPage, type ContentFs } from "@pagina/core";
import { ArticleStore } from "../src/store/article-store.js";
import { MemoryBackend } from "../src/store/memory-backend.js";
import { ConflictError, type ArticleBackend } from "../src/store/types.js";

const ARTICLE = `slug: demo
title: Demo
form: docs
status: published
tags: []
snippets:
  roots: ["."]
nav:
  - { title: Home, page: index.md }
`;

function base(): Record<string, string> {
  return { "article.yaml": ARTICLE, "index.md": "# Home\n" };
}

async function loaded(backend: ArticleBackend, opts?: { debounceMs?: number }): Promise<ArticleStore> {
  const store = new ArticleStore(backend, opts);
  await store.load();
  return store;
}

describe("MemoryBackend", () => {
  it("round-trips text, binary, stat and list", async () => {
    const b = new MemoryBackend({ "index.md": "# Home\n", "media/logo.png": new Uint8Array([1, 2, 3]) });
    const read = await b.read("index.md");
    expect(read.text).toBe("# Home\n");
    expect((await b.readBinary("media/logo.png")).bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect((await b.stat("index.md"))?.version).toBe(read.version);
    expect(await b.stat("nope.md")).toBeNull();
    expect((await b.list()).map((f) => f.path)).toEqual(["index.md", "media/logo.png"]);
  });

  it("changes the version on write and rejects a stale If-Match", async () => {
    const b = new MemoryBackend({ "a.md": "one" });
    const v0 = (await b.read("a.md")).version;
    const { version: v1 } = await b.write("a.md", "two", { version: v0 });
    expect(v1).not.toBe(v0);
    await expect(b.write("a.md", "three", { version: v0 })).rejects.toBeInstanceOf(ConflictError);
    await expect(b.write("a.md", "three", { version: v0 })).rejects.toMatchObject({ theirs: "two", version: v1 });
  });

  it("uploads under media/, renames, deletes and records publishes", async () => {
    const b = new MemoryBackend({});
    const up = await b.upload(new File([new Uint8Array([7])], "shot.png"));
    expect(up.path).toBe("media/shot.png");
    await b.rename("media/shot.png", "media/hero.png");
    expect(await b.stat("media/shot.png")).toBeNull();
    await b.delete("media/hero.png");
    expect(await b.list()).toEqual([]);
    const payload = { manifest: { article: {}, nav: [], pages: {}, figures: {}, assets: [] }, pages: {}, figures: {} };
    const res = await b.publish(payload as never);
    expect(typeof res.publishedAt).toBe("string");
    expect(b.published).toEqual(payload);
  });
});

describe("ArticleStore", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("loads the config and the nav page list", async () => {
    const store = await loaded(new MemoryBackend(base()));
    expect(store.article?.slug).toBe("demo");
    expect(store.navPages().map((p) => p.page)).toEqual(["index.md"]);
    expect(store.files.get("article.yaml")?.status).toBe("saved");
    store.destroy();
  });

  it("applies an edit synchronously and only writes after the debounce", async () => {
    const b = new MemoryBackend(base());
    const write = vi.spyOn(b, "write");
    const store = await loaded(b);
    await store.open("index.md");

    store.setText("index.md", "# Edited\n");
    expect(store.files.get("index.md")?.text).toBe("# Edited\n");
    expect(store.files.get("index.md")?.dirty).toBe(true);
    expect(store.status.state).toBe("dirty");
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(1);
    await store.flush();
    expect((await b.read("index.md")).text).toBe("# Edited\n");
    expect(store.files.get("index.md")?.status).toBe("saved");
    expect(store.status.state).toBe("saved");
    expect(store.status.lastSavedAt).toBeTruthy();
    store.destroy();
  });

  it("coalesces three quick edits into one write", async () => {
    const b = new MemoryBackend(base());
    const write = vi.spyOn(b, "write");
    const store = await loaded(b);
    await store.open("index.md");

    store.setText("index.md", "a");
    await vi.advanceTimersByTimeAsync(100);
    store.setText("index.md", "ab");
    await vi.advanceTimersByTimeAsync(100);
    store.setText("index.md", "abc");
    await vi.advanceTimersByTimeAsync(500);

    expect(write).toHaveBeenCalledTimes(1);
    await store.flush();
    expect((await b.read("index.md")).text).toBe("abc");
    store.destroy();
  });

  it("flush() saves every dirty file immediately", async () => {
    const b = new MemoryBackend({ ...base(), "other.md": "x" });
    const store = await loaded(b);
    await store.open("index.md");
    await store.open("other.md");
    store.setText("index.md", "one");
    store.setText("other.md", "two");
    await store.flush();
    expect((await b.read("index.md")).text).toBe("one");
    expect((await b.read("other.md")).text).toBe("two");
    expect(store.status.state).toBe("saved");
    store.destroy();
  });

  it("retries with backoff and then succeeds", async () => {
    const b = new MemoryBackend(base());
    const real = b.write.bind(b);
    let failures = 2;
    const write = vi.spyOn(b, "write").mockImplementation(async (p, t, o) => {
      if (failures-- > 0) throw new Error("network down");
      return real(p, t, o);
    });
    const store = await loaded(b);
    await store.open("index.md");
    store.setText("index.md", "retried");

    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.files.get("index.md")?.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(250);
    expect(write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(3);

    await store.flush();
    expect(store.files.get("index.md")?.status).toBe("saved");
    expect((await b.read("index.md")).text).toBe("retried");
    store.destroy();
  });

  it("gives up after maxRetries, keeps the edit, and retry() resumes", async () => {
    const b = new MemoryBackend(base());
    const real = b.write.bind(b);
    let broken = true;
    vi.spyOn(b, "write").mockImplementation(async (p, t, o) => {
      if (broken) throw new Error("network down");
      return real(p, t, o);
    });
    const store = await loaded(b);
    await store.open("index.md");
    store.setText("index.md", "kept");

    await vi.advanceTimersByTimeAsync(500 + 250 + 500 + 1000);
    const state = store.files.get("index.md")!;
    expect(state.status).toBe("error");
    expect(state.dirty).toBe(true);
    expect(state.text).toBe("kept");
    expect(state.error).toContain("network down");
    expect(store.status.state).toBe("error");

    broken = false;
    await store.retry("index.md");
    expect(store.files.get("index.md")?.status).toBe("saved");
    expect((await b.read("index.md")).text).toBe("kept");
    store.destroy();
  });

  it("turns a 409 into a conflict and resolves it with theirs", async () => {
    const b = new MemoryBackend(base());
    const store = await loaded(b);
    await store.open("index.md");
    store.setText("index.md", "# Mine\n");
    await b.write("index.md", "# Theirs\n");     // another client lands first, no event delivered
    await vi.advanceTimersByTimeAsync(500);

    const state = store.files.get("index.md")!;
    expect(state.status).toBe("conflict");
    expect(state.theirs).toBe("# Theirs\n");
    expect(state.conflict).toMatchObject({ kind: "changed", theirs: "# Theirs\n" });
    expect(store.status.state).toBe("conflict");

    await store.resolveConflict("index.md", "theirs");
    const after = store.files.get("index.md")!;
    expect(after.text).toBe("# Theirs\n");
    expect(after.status).toBe("saved");
    expect(after.dirty).toBe(false);
    expect(after.version).toBe((await b.read("index.md")).version);
    store.destroy();
  });

  it("resolves a conflict with mine by re-writing against theirs' version", async () => {
    const b = new MemoryBackend(base());
    const store = await loaded(b);
    await store.open("index.md");
    store.setText("index.md", "# Mine\n");
    await b.write("index.md", "# Theirs\n");
    await vi.advanceTimersByTimeAsync(500);
    expect(store.files.get("index.md")?.status).toBe("conflict");

    await store.resolveConflict("index.md", "mine");
    expect(store.files.get("index.md")?.status).toBe("saved");
    expect(store.files.get("index.md")?.dirty).toBe(false);
    expect((await b.read("index.md")).text).toBe("# Mine\n");
    expect(store.files.get("index.md")?.version).toBe((await b.read("index.md")).version);
    store.destroy();
  });

  it("creates, uploads, renames and deletes files", async () => {
    const b = new MemoryBackend(base());
    const store = await loaded(b);

    await store.createFile("guide/new.md", "# New\n");
    expect(store.files.get("guide/new.md")?.text).toBe("# New\n");
    expect((await b.read("guide/new.md")).text).toBe("# New\n");

    const up = await store.uploadFile(new File([new Uint8Array([9])], "pic.png"));
    expect(up.path).toBe("media/pic.png");
    expect(store.list().map((f) => f.path)).toContain("media/pic.png");

    await store.renameFile("guide/new.md", "guide/renamed.md");
    expect(store.files.has("guide/new.md")).toBe(false);
    expect(store.files.get("guide/renamed.md")?.text).toBe("# New\n");

    await store.deleteFile("guide/renamed.md");
    expect(store.files.has("guide/renamed.md")).toBe(false);
    expect(await b.stat("guide/renamed.md")).toBeNull();
    store.destroy();
  });

  it("adopts an external change to a clean file and conflicts on a dirty one", async () => {
    const b = new MemoryBackend(base());
    const store = await loaded(b);
    await store.open("index.md");

    await b.emit({ type: "changed", path: "index.md", text: "# From another tab\n" });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.files.get("index.md")?.text).toBe("# From another tab\n");
    expect(store.files.get("index.md")?.status).toBe("saved");

    store.setText("index.md", "# Local\n");
    await b.emit({ type: "changed", path: "index.md", text: "# Remote\n" });
    await vi.advanceTimersByTimeAsync(0);
    const dirty = store.files.get("index.md")!;
    expect(dirty.status).toBe("conflict");
    expect(dirty.text).toBe("# Local\n");

    await store.resolveConflict("index.md", "theirs");   // theirs fetched lazily
    expect(store.files.get("index.md")?.text).toBe("# Remote\n");
    store.destroy();
  });

  it("holds a dirty file whose remote copy was deleted, without resurrecting it", async () => {
    const b = new MemoryBackend(base());
    const write = vi.spyOn(b, "write");
    const store = await loaded(b);
    await store.open("index.md");
    store.setText("index.md", "# Unsaved\n");
    await b.emit({ type: "deleted", path: "index.md" });
    await vi.advanceTimersByTimeAsync(0);

    const state = store.files.get("index.md")!;
    expect(state.status).toBe("conflict");
    expect(state.conflict?.kind).toEqual("deleted");
    expect(state.text).toBe("# Unsaved\n");

    // the queued write must not fire — that would silently recreate the file the other side removed
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).not.toHaveBeenCalled();
    expect(await b.stat("index.md")).toBeNull();
    expect(store.status.state).toBe("conflict");

    await store.resolveConflict("index.md", "theirs");
    expect(store.files.has("index.md")).toBe(false);
    expect(await b.stat("index.md")).toBeNull();
    store.destroy();
  });

  it("re-creates a remotely deleted file when the author keeps mine", async () => {
    const b = new MemoryBackend(base());
    const store = await loaded(b);
    await store.open("index.md");
    store.setText("index.md", "# Unsaved\n");
    await b.emit({ type: "deleted", path: "index.md" });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.files.get("index.md")?.conflict?.kind).toEqual("deleted");

    await store.resolveConflict("index.md", "mine");
    const state = store.files.get("index.md")!;
    expect(state.status).toBe("saved");
    expect(state.dirty).toBe(false);
    expect(state.conflict).toBeUndefined();
    expect((await b.read("index.md")).text).toBe("# Unsaved\n");
    store.destroy();
  });

  it("emits change, status and files events and stops after destroy()", async () => {
    const b = new MemoryBackend(base());
    const store = await loaded(b);
    await store.open("index.md");
    const changes: string[] = [];
    const files = vi.fn();
    const off = store.on("change", (p) => changes.push(p));
    store.on("files", files);

    store.setText("index.md", "x");
    expect(changes).toEqual(["index.md"]);
    off();
    store.setText("index.md", "y");
    expect(changes).toEqual(["index.md"]);

    await store.createFile("z.md", "z");
    expect(files).toHaveBeenCalled();
    store.destroy();
  });
});

// ---------------------------------------------------------------------------------------------
// Preview parity: the store's ContentFs view of the mirror must render byte-identically to core
// rendering the same folder off disk — snippets that reach outside the folder included.
// ---------------------------------------------------------------------------------------------

const FIXTURE = fileURLToPath(new URL("../../core/test/fixture/", import.meta.url));
const OUTSIDE = fileURLToPath(new URL("../../core/test/outside/", import.meta.url));

function walk(dir: string, prefix: string, into: Record<string, string>): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, `${prefix}${name}/`, into);
    else into[`${prefix}${name}`] = readFileSync(abs, "utf8");
  }
}

function fixtureFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  walk(FIXTURE, "", files);
  walk(OUTSIDE, "../outside/", files);   // snippets.roots reaches out of the folder
  return files;
}

function diskFs(): ContentFs {
  const abs = (p: string): string => join(FIXTURE, p);
  return {
    read: async (p) => readFileSync(abs(p), "utf8"),
    readBinary: async (p) => new Uint8Array(readFileSync(abs(p))),
    exists: async (p) => { try { statSync(abs(p)); return true; } catch { return false; } },
    list: async () => { const f: Record<string, string> = {}; walk(FIXTURE, "", f); return Object.keys(f).map((p) => relative(".", p)); },
  };
}

describe("ArticleStore.render", () => {
  it("matches core's renderPage on the fixture folder", async () => {
    const files = fixtureFiles();
    const store = new ArticleStore(new MemoryBackend(files));
    await store.load();

    const mine = await store.render("guide/tabs.md");
    const config = parseArticleConfig(files["article.yaml"]!);
    const theirs = await renderPage({
      fs: diskFs(), config, path: "guide/tabs.md",
      navPages: new Set(["index.md", "guide/tabs.md", "guide/figures.md"]),
    });

    expect(mine.html).toBe(theirs.page.html);
    expect(mine.title).toBe(theirs.page.title);
    expect(mine.headings).toEqual(theirs.page.headings);
    store.destroy();
  });

  it("renderAll() returns the manifest and diagnostics without throwing", async () => {
    const store = new ArticleStore(new MemoryBackend(fixtureFiles()));
    await store.load();
    const article = await store.renderAll();
    expect(Object.keys(article.pages).sort()).toEqual(["/", "/guide/figures/", "/guide/tabs/"]);
    expect(article.manifest.article.slug).toBe("fixture");
    expect(Array.isArray(article.diagnostics)).toBe(true);
    store.destroy();
  });

  it("publish() sends the rendered pages plus the caller's figure SVGs", async () => {
    const b = new MemoryBackend(fixtureFiles());
    const store = new ArticleStore(b);
    await store.load();
    const figures = { "guide-tabs-1": { light: "<svg/>", dark: "<svg/>" } };
    const res = await store.publish(figures);
    expect(typeof res.publishedAt).toBe("string");
    expect(b.published?.figures).toEqual(figures);
    expect(b.published?.pages["/"]).toContain("<h1");
    expect(b.published?.manifest.article.slug).toBe("fixture");
    store.destroy();
  });

  it("falls back to the backend for snippet roots outside the folder", async () => {
    const files = fixtureFiles();
    delete files["../outside/hello.rs"];                 // backend can no longer serve it
    const store = new ArticleStore(new MemoryBackend(files));
    await store.load();
    const page = await store.render("guide/tabs.md");
    expect(page.html).toContain("snippet missing: ../outside/hello.rs");
    store.destroy();
  });
});
