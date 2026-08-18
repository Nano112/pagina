/**
 * The bundle format's pure half: the path policy, the descriptor's schema, and the verification a
 * host runs before it trusts an archive.
 *
 * These are the checks a Laravel importer calls without shelling out, so they are tested here
 * rather than only through `pack`/`unpack` — a host that decodes the archive itself must be able
 * to reach the same verdict from the same function.
 */
import { describe, expect, it } from "vitest";
import {
  BUNDLE_FORMAT, BundleError, DEFAULT_BUNDLE_LIMITS, isSafeBundlePath, parseBundleManifest,
  sha256Hex, verifyBundleEntries, type BundleEntry, type BundleManifest,
} from "../src/index.js";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

async function manifestFor(entries: readonly BundleEntry[], patch: Partial<BundleManifest> = {}): Promise<BundleManifest> {
  const files: { path: string; size: number; sha256: string }[] = [];
  for (const e of entries) files.push({ path: e.path, size: e.data.byteLength, sha256: await sha256Hex(e.data) });
  return {
    format: BUNDLE_FORMAT, pagina: "0.1.0", created: "2026-08-18T00:00:00.000Z",
    slug: "fixture", title: "Fixture", base: "/",
    totalSize: files.reduce((n, f) => n + f.size, 0),
    files, external: [],
    ...patch,
  };
}

/** Every refusal below is asserted by *code*, not by message: a host branches on the code. */
async function refusal(run: () => Promise<unknown>): Promise<BundleError> {
  try {
    await run();
  } catch (e) {
    expect(e, `expected a BundleError, got ${String(e)}`).toBeInstanceOf(BundleError);
    return e as BundleError;
  }
  throw new Error("expected a refusal, got success");
}

describe("isSafeBundlePath", () => {
  it("accepts the shapes a bundle actually contains", () => {
    for (const path of [
      "article.yaml", "index.md", "guide/tabs.md", "media/hero.png",
      ".rendered/manifest.json", ".rendered/pages/guide-tabs.html",
      "snippets/hello.rs", "a-b_c.1.svg",
    ])
      expect(isSafeBundlePath(path), path).toBe(true);
  });

  it("refuses every way a name reaches outside the destination", () => {
    for (const path of [
      "",                              // nothing
      "../../etc/passwd",              // the classic
      "a/../../b",                     // traversal in the middle
      "/etc/passwd",                   // absolute posix
      "C:/Windows/system32/x.dll",     // absolute windows
      "c:x",                           // a drive-relative path
      "..\\..\\etc\\passwd",           // a separator on the machine this may be unpacked on
      "a\\b",                          // and a legal filename character on the one that packed it
      "./a",                           // a `.` segment is normalisation this reader will not do
      "a//b",                          // an empty segment
      "media/",                        // a directory
      "media/logo.png\u0000.txt",      // a NUL, which truncates a C string
      "media/\u001bx",                 // a control character
      "a".repeat(1025),                // a name no filesystem will take
    ])
      expect(isSafeBundlePath(path), JSON.stringify(path)).toBe(false);
  });

  it("refuses names Windows cannot create, so a cross-platform import cannot half-fail", () => {
    for (const path of ["con", "NUL.txt", "a/aux", "com1.md", "lpt9", "trailing.", "trailing "])
      expect(isSafeBundlePath(path), path).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("agrees with the known vector for the empty string", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("hashes the view it is given, not the pool behind it", async () => {
    const pool = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(await sha256Hex(pool.subarray(2, 4))).toBe(await sha256Hex(new Uint8Array([3, 4])));
  });
});

describe("parseBundleManifest", () => {
  it("reads a descriptor pack wrote", async () => {
    const m = await manifestFor([{ path: "index.md", data: bytes("# Hi\n") }]);
    expect(parseBundleManifest(JSON.stringify(m))).toEqual(m);
  });

  it("refuses a format it does not read, rather than guessing", async () => {
    const m = await manifestFor([], { format: BUNDLE_FORMAT + 1 });
    expect((await refusal(async () => parseBundleManifest(JSON.stringify(m)))).code).toBe("bundle-format");
    expect((await refusal(async () => parseBundleManifest(JSON.stringify({ ...m, format: "1" })))).code).toBe("bundle-format");
  });

  it("refuses malformed JSON, missing fields and bad checksums", async () => {
    const good = await manifestFor([{ path: "index.md", data: bytes("x") }]);
    const cases: [string, string][] = [
      ["not json", "{"],
      ["an array", JSON.stringify([])],
      ["no slug", JSON.stringify({ ...good, slug: "" })],
      ["no totalSize", JSON.stringify({ ...good, totalSize: "12" })],
      ["files not a list", JSON.stringify({ ...good, files: {} })],
      ["a short checksum", JSON.stringify({ ...good, files: [{ ...good.files[0]!, sha256: "abc" }] })],
      ["an uppercase checksum", JSON.stringify({ ...good, files: [{ ...good.files[0]!, sha256: "A".repeat(64) }] })],
      ["a negative size", JSON.stringify({ ...good, files: [{ ...good.files[0]!, size: -1 }] })],
    ];
    for (const [what, text] of cases) {
      const e = await refusal(async () => parseBundleManifest(text));
      expect(e.code, what).toBe("bundle-manifest");
    }
  });

  it("refuses a descriptor whose own file list is unsafe or repeats itself", async () => {
    const good = await manifestFor([{ path: "index.md", data: bytes("x") }]);
    const record = good.files[0]!;
    expect((await refusal(async () => parseBundleManifest(JSON.stringify({ ...good, files: [{ ...record, path: "../x" }] })))).code).toBe("bundle-path");
    expect((await refusal(async () => parseBundleManifest(JSON.stringify({ ...good, files: [record, record] })))).code).toBe("bundle-manifest");
    expect((await refusal(async () => parseBundleManifest(JSON.stringify({ ...good, files: [{ ...record, path: "bundle.json" }] })))).code).toBe("bundle-manifest");
  });
});

describe("verifyBundleEntries", () => {
  const entries: BundleEntry[] = [
    { path: "article.yaml", data: bytes("slug: fixture\n") },
    { path: "index.md", data: bytes("# Fixture\n") },
  ];
  const archiveSize = 512;

  it("passes a bundle that is what it says it is", async () => {
    await expect(verifyBundleEntries({ manifest: await manifestFor(entries), entries, archiveSize })).resolves.toBeUndefined();
  });

  it("refuses a member the descriptor never accounted for", async () => {
    const manifest = await manifestFor(entries);
    const extra = [...entries, { path: "sneaky.sh", data: bytes("rm -rf /\n") }];
    expect((await refusal(() => verifyBundleEntries({ manifest, entries: extra, archiveSize }))).code).toBe("bundle-extra-entry");
  });

  it("refuses a record with no member", async () => {
    const manifest = await manifestFor([...entries, { path: "media/hero.png", data: bytes("png") }]);
    expect((await refusal(() => verifyBundleEntries({ manifest, entries, archiveSize }))).code).toBe("bundle-missing-entry");
  });

  it("refuses a declared size that does not add up, and one that does not match the bytes", async () => {
    const lyingTotal = await manifestFor(entries, { totalSize: 1 });
    expect((await refusal(() => verifyBundleEntries({ manifest: lyingTotal, entries, archiveSize }))).code).toBe("bundle-size");
    const base = await manifestFor(entries);
    const lyingRecord: BundleManifest = { ...base, files: base.files.map((f) => (f.path === "index.md" ? { ...f, size: f.size + 1 } : f)), totalSize: base.totalSize + 1 };
    expect((await refusal(() => verifyBundleEntries({ manifest: lyingRecord, entries, archiveSize }))).code).toBe("bundle-size");
  });

  it("refuses a corrupted file even when its size still matches", async () => {
    const manifest = await manifestFor(entries);
    const tampered = entries.map((e) => (e.path === "index.md" ? { path: e.path, data: bytes("# Fixturf\n") } : e));
    const e = await refusal(() => verifyBundleEntries({ manifest, entries: tampered, archiveSize }));
    expect(e.code).toBe("bundle-checksum");
    expect(e.message).toContain("index.md");
  });

  it("refuses a bomb by its ratio and by its absolute size", async () => {
    const big = [{ path: "index.md", data: new Uint8Array(1024 * 1024) }];
    const bigManifest = await manifestFor(big);
    expect((await refusal(() => verifyBundleEntries({ manifest: bigManifest, entries: big, archiveSize: 1024 }))).code).toBe("bundle-ratio");
    const overCap = await manifestFor(entries, { totalSize: DEFAULT_BUNDLE_LIMITS.maxTotalSize + 1 });
    expect((await refusal(() => verifyBundleEntries({ manifest: overCap, entries, archiveSize }))).code).toBe("bundle-size");
  });

  it("refuses more members than the limit allows before it hashes any of them", async () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ path: `p${String(i)}.md`, data: bytes("x") }));
    const manyManifest = await manifestFor(many);
    const e = await refusal(() => verifyBundleEntries({
      manifest: manyManifest, entries: many, archiveSize,
      limits: { ...DEFAULT_BUNDLE_LIMITS, maxEntries: 3 },
    }));
    expect(e.code).toBe("bundle-entry-count");
  });

  it("refuses a traversing member name even when its checksum is perfect", async () => {
    const evil = [{ path: "../../etc/passwd", data: bytes("root::0:0\n") }];
    // The descriptor cannot even be written with that path, so the entry arrives unaccounted for
    // — but the name is refused first, and by name.
    const empty = await manifestFor([]);
    const e = await refusal(() => verifyBundleEntries({ manifest: empty, entries: evil, archiveSize }));
    expect(e.code).toBe("bundle-path");
  });
});
