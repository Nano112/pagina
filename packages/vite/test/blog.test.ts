/**
 * A blog, built and packed — over the example the repository ships rather than over a fixture
 * assembled here.
 *
 * `examples/blog` is a real blog: three posts on three dates, a draft, a standalone page and a
 * cover. Building *that* is the test, because an example nothing executes is an example that
 * quietly stops working, and because the claims worth checking here are the ones about files on
 * disk: whether `feed.xml` is written, whether the draft is in the sitemap, and whether the folder
 * survives a round trip through a bundle unchanged.
 */
import { describe, expect, it } from "vitest";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tempDir } from "../../../test/tmp.js";
import { staticShell } from "@pagina/shell-static";
import { buildStatic } from "../src/build.js";
import { packBundle, unpackBundle } from "../src/bundle.js";

const example = new URL("../../../examples/blog/", import.meta.url).pathname;

async function walk(dir: string, root = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p, root));
    else out.push(relative(root, p));
  }
  return out.sort();
}

/** A throwaway copy of the example, optionally with `article.yaml` edited. */
async function copyExample(edit?: (yaml: string) => string): Promise<string> {
  const folder = join(await tempDir("blog"), "blog");
  await cp(example, folder, { recursive: true });
  if (edit !== undefined)
    await writeFile(join(folder, "article.yaml"), edit(await readFile(join(folder, "article.yaml"), "utf8")));
  return folder;
}

describe("building examples/blog", () => {
  it("builds clean, with a feed, and with the draft present but unannounced", async () => {
    const outDir = await tempDir("blog-site");
    const r = await buildStatic({ folder: example, outDir, shell: staticShell, strict: true });
    expect(r.diagnostics).toEqual([]);

    const files = await walk(outDir);
    expect(files).toContain("feed.xml");
    expect(files).toContain("index.html");
    // The draft builds and has a URL, which is what makes it reviewable.
    expect(files).toContain("caching-notes/index.html");

    const feed = await readFile(join(outDir, "feed.xml"), "utf8");
    const sitemap = await readFile(join(outDir, "sitemap.xml"), "utf8");
    const index = await readFile(join(outDir, "index.html"), "utf8");
    for (const surface of [feed, sitemap, index]) expect(surface).not.toContain("caching-notes");
    // …and the draft page says so about itself, so a crawler that arrives at the URL still knows.
    expect(await readFile(join(outDir, "caching-notes/index.html"), "utf8")).toContain(`content="noindex, nofollow"`);

    // The archive, in date order, on the page a reader lands on.
    const order = ["on-writing-it-down", "the-smaller-toolbox", "a-week-of-reading-logs"]
      .map((slug) => index.indexOf(`href="/${slug}/"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(-1);
    // The one standalone page is in the rail and not in the archive.
    expect(index).toContain(`class="pg-nav__link" href="/about/"`);
    expect(index).not.toContain(`class="pg-post__title"><a href="/about/"`);
  });

  it("says what is missing when a blog has no site_url to put in its feed", async () => {
    const folder = await copyExample((y) => y.replace("site_url: https://field-notes.example\n", ""));
    const outDir = await tempDir("blog-no-origin");
    const r = await buildStatic({ folder, outDir, shell: staticShell, strict: true });
    const feed = r.diagnostics.find((d) => d.code === "feed-skipped");
    expect(feed).toMatchObject({ severity: "warning" });
    expect(feed!.message).toContain("cannot be subscribed to");
    expect(await walk(outDir)).not.toContain("feed.xml");
  });

  it("writes no feed for a docs article, so nothing changed for the form that has none", async () => {
    const fixture = new URL("../../core/test/fixture/", import.meta.url).pathname;
    const parent = await tempDir("docs-no-feed");
    const folder = join(parent, "fixture");
    await cp(fixture, folder, { recursive: true });
    await cp(new URL("../../core/test/outside/", import.meta.url).pathname, join(parent, "outside"), { recursive: true });
    const outDir = await tempDir("docs-site");
    await buildStatic({ folder, outDir, shell: staticShell, strict: true, siteUrl: "https://docs.example" });
    expect(await walk(outDir)).not.toContain("feed.xml");
  });

  it("survives pack and unpack byte for byte", async () => {
    const out = join(await tempDir("blog-pack"), "blog.pgz");
    const packed = await packBundle({ folder: example, out, created: "2026-08-20T00:00:00.000Z" });
    expect(packed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const dir = join(await tempDir("blog-unpack"), "out");
    await unpackBundle({ file: out, dir });
    for (const name of ["article.yaml", "index.md", "about.md", "on-writing-it-down.md", "caching-notes.md"]) {
      expect(await readFile(join(dir, name))).toEqual(await readFile(join(example, name)));
    }
    // The archive is regenerated from the unpacked folder rather than carried in the source, so
    // rebuilding the round-tripped folder must produce the same index the original did.
    const first = await tempDir("blog-pack-a");
    const second = await tempDir("blog-pack-b");
    await buildStatic({ folder: example, outDir: first, shell: staticShell, strict: true });
    await buildStatic({ folder: dir, outDir: second, shell: staticShell, strict: true });
    expect(await readFile(join(second, "feed.xml"), "utf8")).toEqual(await readFile(join(first, "feed.xml"), "utf8"));
    expect(await readFile(join(second, "index.html"), "utf8")).toEqual(await readFile(join(first, "index.html"), "utf8"));
  });
});
