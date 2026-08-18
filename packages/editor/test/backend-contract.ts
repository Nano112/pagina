/**
 * One suite, run against every {@link ArticleBackend}.
 *
 * Before this existed each backend had its own tests, which is the arrangement that lets three
 * implementations of one interface drift apart while all three suites stay green: `MemoryBackend`
 * was checked for 404s and conflicts, `HttpBackend` was checked for the *wire* — headers, ETags,
 * status codes — and nobody had ever asserted that the two agree about what `rename` does to a
 * version, or that a stale write conflicts the same way in both. The store is written against the
 * interface, so anything the store may rely on has to be checked at the interface.
 *
 * `HttpBackend` runs against an in-process server implementing the documented HTTP contract, so it
 * is exercised end to end rather than through response stubs shaped to match the assertions.
 */
import { expect, it } from "vitest";
import type { ArticleBackend } from "../src/store/types.js";
import { BackendError, ConflictError } from "../src/store/types.js";

/** What a backend has to supply for the suite to drive it. */
export interface BackendUnderTest {
  readonly backend: ArticleBackend;
  /**
   * Applies a change the way something *other than this backend instance* would — a second tab, a
   * second process, a server-side edit — and delivers whatever notification the transport carries.
   * This is the only part of the contract that cannot be exercised through the interface itself.
   */
  external(ev: { type: "changed" | "deleted"; path: string; text?: string }): Promise<void>;
  cleanup?(): void;
}

export type BackendFactory = (seed: Record<string, string>) => BackendUnderTest | Promise<BackendUnderTest>;

const SEED = {
  "article.yaml": "slug: demo\ntitle: Demo\nnav:\n  - { title: Home, page: index.md }\n",
  "index.md": "# Demo\n\nHello.\n",
  "guide/tabs.md": "# Tabs\n",
};

async function statusOf(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run();
  } catch (e) {
    expect(e).toBeInstanceOf(BackendError);
    return (e as BackendError).status;
  }
  return undefined;
}

/**
 * Declares the contract tests for one backend. Call inside a `describe`.
 *
 * Everything asserted here is behaviour the {@link ArticleStore} depends on. Two things are
 * deliberately *not* asserted, because the implementations legitimately differ and the store does
 * not care: what a version string looks like (`MemoryBackend` hashes content, `LocalStorageBackend`
 * counts, a server may do either), and whether rewriting identical bytes moves the version.
 */
export function describeBackendContract(make: BackendFactory): void {
  const setUp = async (seed: Record<string, string> = SEED): Promise<BackendUnderTest> => await make({ ...seed });

  it("lists the seeded files, sorted, with a version each", async () => {
    const { backend, cleanup } = await setUp();
    const files = await backend.list();
    expect(files.map((f) => f.path)).toEqual(["article.yaml", "guide/tabs.md", "index.md"]);
    for (const f of files) expect(f.version).toBeTypeOf("string");
    for (const f of files) expect(f.version).not.toEqual("");
    cleanup?.();
  });

  it("reads a file back byte for byte, including a nested path", async () => {
    const { backend, cleanup } = await setUp();
    expect((await backend.read("index.md")).text).toEqual(SEED["index.md"]);
    expect((await backend.read("guide/tabs.md")).text).toEqual(SEED["guide/tabs.md"]);
    cleanup?.();
  });

  it("answers 404 for a file that is not there", async () => {
    const { backend, cleanup } = await setUp();
    expect(await statusOf(() => backend.read("nope.md"))).toBe(404);
    expect(await statusOf(() => backend.readBinary("nope.png"))).toBe(404);
    expect(await statusOf(() => backend.delete("nope.md"))).toBe(404);
    expect(await statusOf(() => backend.rename("nope.md", "other.md"))).toBe(404);
    cleanup?.();
  });

  it("writes without a version, and the read reflects it", async () => {
    const { backend, cleanup } = await setUp();
    const { version } = await backend.write("index.md", "# Changed\n");
    expect(version).toBeTypeOf("string");
    expect(version).not.toEqual("");
    expect(await backend.read("index.md")).toEqual({ text: "# Changed\n", version });
    cleanup?.();
  });

  it("creates a file that did not exist, at a new nested path", async () => {
    const { backend, cleanup } = await setUp();
    await backend.write("guide/new/deep.md", "# Deep\n");
    expect((await backend.read("guide/new/deep.md")).text).toEqual("# Deep\n");
    expect((await backend.list()).map((f) => f.path)).toContain("guide/new/deep.md");
    cleanup?.();
  });

  it("changes the version when the content changes", async () => {
    const { backend, cleanup } = await setUp();
    const first = (await backend.read("index.md")).version;
    const second = (await backend.write("index.md", "# One\n")).version;
    const third = (await backend.write("index.md", "# Two\n", { version: second })).version;
    expect(second).not.toEqual(first);
    expect(third).not.toEqual(second);
    cleanup?.();
  });

  it("accepts a write that carries the current version", async () => {
    const { backend, cleanup } = await setUp();
    const { version } = await backend.read("index.md");
    await expect(backend.write("index.md", "# Fresh\n", { version })).resolves.toBeTruthy();
    cleanup?.();
  });

  it("refuses a write carrying a stale version, and hands back the other side", async () => {
    const { backend, cleanup } = await setUp();
    const stale = (await backend.read("index.md")).version;
    await backend.write("index.md", "# Theirs\n", { version: stale });

    const error = await backend.write("index.md", "# Mine\n", { version: stale }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConflictError);
    const conflict = error as ConflictError;
    expect(conflict.status).toBe(409);
    expect(conflict.path).toBe("index.md");
    // `theirs` and `version` are what the conflict banner offers as "reload theirs" without a
    // second round trip; a conflict that omits them makes the banner lie about what it has.
    expect(conflict.theirs).toEqual("# Theirs\n");
    expect(conflict.version).toEqual((await backend.read("index.md")).version);
    // The refused write must not have landed.
    expect((await backend.read("index.md")).text).toEqual("# Theirs\n");
    cleanup?.();
  });

  it("treats a versioned write to a path that does not exist as a create", async () => {
    // Deliberate: the version refers to a file that is not there, so there is nothing to clobber.
    // All three implementations agree, and the store relies on it when a file is created offline.
    const { backend, cleanup } = await setUp();
    await expect(backend.write("brand-new.md", "# New\n", { version: "whatever" })).resolves.toBeTruthy();
    expect((await backend.read("brand-new.md")).text).toEqual("# New\n");
    cleanup?.();
  });

  it("uploads a file, lists it, and reads the bytes back", async () => {
    const { backend, cleanup } = await setUp();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    const file = new File([bytes as BlobPart], "shot.png", { type: "image/png" });

    const result = await backend.upload(file);
    expect(result.path).toBe("media/shot.png");
    expect(result.url).toBeTypeOf("string");
    expect(result.url).not.toEqual("");
    expect(result.version).not.toEqual("");

    const read = await backend.readBinary("media/shot.png");
    expect([...read.bytes]).toEqual([...bytes]);
    expect((await backend.list()).map((f) => f.path)).toContain("media/shot.png");
    cleanup?.();
  });

  it("uploads to an explicit path when given one", async () => {
    const { backend, cleanup } = await setUp();
    const file = new File([new Uint8Array([1, 2, 3]) as BlobPart], "x.bin", { type: "" });
    expect((await backend.upload(file, "media/renamed.bin")).path).toBe("media/renamed.bin");
    expect([...(await backend.readBinary("media/renamed.bin")).bytes]).toEqual([1, 2, 3]);
    cleanup?.();
  });

  it("deletes a file", async () => {
    const { backend, cleanup } = await setUp();
    await backend.delete("guide/tabs.md");
    expect((await backend.list()).map((f) => f.path)).not.toContain("guide/tabs.md");
    expect(await statusOf(() => backend.read("guide/tabs.md"))).toBe(404);
    cleanup?.();
  });

  it("renames a file, keeping the content and moving the listing entry", async () => {
    const { backend, cleanup } = await setUp();
    const { version } = await backend.rename("guide/tabs.md", "guide/panels.md");
    expect(version).toBeTypeOf("string");
    expect((await backend.read("guide/panels.md")).text).toEqual(SEED["guide/tabs.md"]);
    const paths = (await backend.list()).map((f) => f.path);
    expect(paths).toContain("guide/panels.md");
    expect(paths).not.toContain("guide/tabs.md");
    cleanup?.();
  });

  it("stats a file, and answers null rather than throwing for one that is missing", async () => {
    const { backend, cleanup } = await setUp();
    const entry = await backend.stat("index.md");
    expect(entry?.path).toBe("index.md");
    expect(entry?.version).toEqual((await backend.read("index.md")).version);
    expect(await backend.stat("nope.md")).toBeNull();
    cleanup?.();
  });

  it("accepts a publish and answers with an ISO timestamp", async () => {
    const { backend, cleanup } = await setUp();
    const { publishedAt } = await backend.publish({
      manifest: { article: { slug: "demo", title: "Demo" }, pages: [], assets: [], nav: [] } as never,
      pages: { "/": "<h1>Demo</h1>" },
      figures: {},
    });
    expect(Number.isNaN(Date.parse(publishedAt))).toBe(false);
    cleanup?.();
  });

  it("notifies a subscriber when something else changes a file", async () => {
    const { backend, external, cleanup } = await setUp();
    const seen: { type: string; path: string }[] = [];
    const off = backend.subscribe?.((ev) => { seen.push({ type: ev.type, path: ev.path }); });
    expect(off).toBeTypeOf("function");

    await external({ type: "changed", path: "index.md", text: "# From elsewhere\n" });
    expect(seen).toContainEqual({ type: "changed", path: "index.md" });
    // The notification has to be truthful: the file really did change underneath us.
    expect((await backend.read("index.md")).text).toEqual("# From elsewhere\n");

    await external({ type: "deleted", path: "guide/tabs.md" });
    expect(seen).toContainEqual({ type: "deleted", path: "guide/tabs.md" });

    off?.();
    await external({ type: "changed", path: "index.md", text: "# After unsubscribe\n" });
    expect(seen.filter((e) => e.path === "index.md")).toHaveLength(1);
    cleanup?.();
  });
}
