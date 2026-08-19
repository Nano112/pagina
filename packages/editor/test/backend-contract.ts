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
import type { ArticleBackend, Author } from "../src/store/types.js";
import { BackendError, ConflictError } from "../src/store/types.js";

/** The other person, for the tests that need two. */
export const OTHER: Author = { id: "contract:bob", name: "Bob" };

/** What a backend has to supply for the suite to drive it. */
export interface BackendUnderTest {
  readonly backend: ArticleBackend;
  /**
   * Applies a change the way something *other than this backend instance* would — a second tab, a
   * second process, a server-side edit — and delivers whatever notification the transport carries.
   * This is the only part of the contract that cannot be exercised through the interface itself.
   *
   * `by` names the person who made it, where the transport can carry one. That is not decoration:
   * the two-tab conflict the banner exists for arrives through here, so a suite that could not
   * express "somebody else did this" could not check the feature at all.
   */
  external(ev: { type: "changed" | "deleted"; path: string; text?: string; by?: Author }): Promise<void>;
  /**
   * Who this backend attributes *its own* writes to, when it attributes them at all.
   *
   * Omitted for a backend with no identity of its own — `HttpBackend` reports whatever its server
   * says, and has no answer of its own to give. The attribution tests are skipped in that case
   * rather than asserted loosely.
   */
  readonly expectedAuthor?: Author;
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

  // --- attribution -------------------------------------------------------------------------------

  it("attributes a write to the backend's own identity, and reports it from stat and list", async () => {
    const { backend, expectedAuthor, cleanup } = await setUp();
    if (expectedAuthor === undefined) { cleanup?.(); return; }
    const before = Date.now();
    await backend.write("index.md", "# Attributed\n");

    const entry = await backend.stat("index.md");
    expect(entry?.lastEditedBy).toEqual(expectedAuthor);
    expect(Number.isNaN(Date.parse(entry?.lastEditedAt ?? ""))).toBe(false);
    expect(Date.parse(entry!.lastEditedAt!)).toBeGreaterThanOrEqual(before - 1000);

    // `list` and `stat` must agree: they are the same fact, and a UI reads whichever is to hand.
    const listed = (await backend.list()).find((f) => f.path === "index.md");
    expect(listed?.lastEditedBy).toEqual(expectedAuthor);
    expect(listed?.lastEditedAt).toEqual(entry?.lastEditedAt);
    cleanup?.();
  });

  /**
   * The security property, at the interface.
   *
   * `write()` has no author parameter, so the only way a caller could name itself is by smuggling
   * one through the options bag. Every backend must ignore it — this is a compile-time guarantee
   * cast away deliberately, because the check that matters is what happens at runtime when
   * something does it anyway.
   */
  it("ignores an author a caller tries to smuggle into a write", async () => {
    const { backend, expectedAuthor, cleanup } = await setUp();
    if (expectedAuthor === undefined) { cleanup?.(); return; }
    const forged = { id: "mallory", name: "Mallory" };
    await backend.write("index.md", "# Forged\n", {
      author: forged, by: forged, lastEditedBy: forged,
    } as never);

    const entry = await backend.stat("index.md");
    expect(entry?.lastEditedBy).toEqual(expectedAuthor);
    expect(JSON.stringify(entry)).not.toMatch(/mallory/i);
    cleanup?.();
  });

  /**
   * The reason the whole feature exists, asserted at the interface: a 409 must name the person who
   * actually wrote, not the caller who just got refused.
   *
   * Every backend can do this, including `HttpBackend`, whose server puts the author in the 409
   * body. So it is asserted for all of them rather than gated on `expectedAuthor` — the conflict
   * banner is the payoff, and a backend that dropped this would still pass every other test here.
   */
  it("names the other side in a conflict, so the banner can name a person", async () => {
    const { backend, external, expectedAuthor, cleanup } = await setUp();
    const stale = (await backend.read("index.md")).version;
    await external({ type: "changed", path: "index.md", text: "# Theirs\n", by: OTHER });

    const error = await backend.write("index.md", "# Mine\n", { version: stale }).then(
      () => undefined, (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConflictError);
    const conflict = error as ConflictError;
    expect(conflict.theirs).toEqual("# Theirs\n");
    expect(conflict.by).toEqual(OTHER);
    if (expectedAuthor !== undefined) expect(conflict.by).not.toEqual(expectedAuthor);
    expect(Number.isNaN(Date.parse(conflict.at ?? ""))).toBe(false);
    cleanup?.();
  });

  it("names the other side on a change notification too — the two-tab case", async () => {
    const { backend, external, cleanup } = await setUp();
    const seen: { path: string; by?: { name: string } }[] = [];
    const off = backend.subscribe?.((ev) => { seen.push({ path: ev.path, ...(ev.by === undefined ? {} : { by: ev.by }) }); });

    await external({ type: "changed", path: "index.md", text: "# From Bob\n", by: OTHER });
    // A 409 is the *other* half of the conflict story. This is the half an author actually meets,
    // with two tabs open, and an anonymous event here would leave the banner anonymous with it.
    expect(seen.find((e) => e.path === "index.md")?.by).toEqual(OTHER);
    off?.();
    cleanup?.();
  });

  it("records who published", async () => {
    const { backend, expectedAuthor, cleanup } = await setUp();
    if (expectedAuthor === undefined) { cleanup?.(); return; }
    const record = await backend.publish({
      manifest: { article: { slug: "demo", title: "Demo" }, pages: [], assets: [], nav: [] } as never,
      pages: { "/": "<h1>Demo</h1>" },
      figures: {},
    });
    expect(record.publishedBy).toEqual(expectedAuthor);
    cleanup?.();
  });

  it("leaves a seeded file unattributed, because nobody edited it", async () => {
    const { backend, expectedAuthor, cleanup } = await setUp();
    if (expectedAuthor === undefined) { cleanup?.(); return; }
    // The seed came from whoever built the backend, not from a person at a keyboard. Claiming
    // otherwise would make the first thing any panel shows untrue.
    const entry = await backend.stat("index.md");
    expect(entry?.lastEditedBy).toBeUndefined();
    expect(entry?.lastEditedAt).toBeUndefined();
    cleanup?.();
  });

  // --- history, for the backends that keep one ---------------------------------------------------

  it("keeps history newest-first, filtered by path and capped — or omits the method entirely", async () => {
    const { backend, cleanup } = await setUp();
    if (backend.history === undefined) {
      // Which is a valid answer, and the one the editor reads as "hide the panel". Asserting the
      // shape of the *absence* is the point: `history` must be missing, not an empty function.
      expect(backend.history).toBeUndefined();
      cleanup?.();
      return;
    }
    await backend.write("index.md", "# One\n");
    await backend.write("index.md", "# Two\n");
    await backend.write("guide/tabs.md", "# Elsewhere\n");

    const all = await backend.history();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const edit of all) {
      expect(edit.by.id).toBeTypeOf("string");
      expect(edit.by.name).not.toEqual("");
      expect(Number.isNaN(Date.parse(edit.at))).toBe(false);
    }
    const times = all.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const mine = await backend.history("index.md");
    expect(mine.map((e) => e.path)).toEqual(["index.md", "index.md"]);
    expect(mine.every((e) => e.action === "write")).toBe(true);

    expect(await backend.history("index.md", { limit: 1 })).toHaveLength(1);
    cleanup?.();
  });

  it("records a rename in history against the new path, naming the old one", async () => {
    const { backend, cleanup } = await setUp();
    if (backend.history === undefined) { cleanup?.(); return; }
    await backend.rename("guide/tabs.md", "guide/panels.md");
    const [latest] = await backend.history("guide/panels.md");
    expect(latest).toMatchObject({ path: "guide/panels.md", action: "rename", from: "guide/tabs.md" });
    cleanup?.();
  });

  it("records a delete, so the log says the file went rather than going quiet", async () => {
    const { backend, cleanup } = await setUp();
    if (backend.history === undefined) { cleanup?.(); return; }
    await backend.delete("guide/tabs.md");
    const [latest] = await backend.history("guide/tabs.md");
    expect(latest).toMatchObject({ path: "guide/tabs.md", action: "delete" });
    cleanup?.();
  });
}
