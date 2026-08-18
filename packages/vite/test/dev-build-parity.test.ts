/**
 * `pagina dev` and `pagina build` must agree about what the folder's article *is*.
 *
 * They used not to, and it broke the dogfooding loop: `build` of Kineglyph's docs folder succeeded
 * while `dev` served "Cannot GET /" for the same folder, so the one lane where the author watches
 * their own docs while writing them was the one lane that did not work.
 *
 * Two separate resolutions were the cause. The dev server called `renderArticle` itself, with no
 * `exclude` (so it served files a build refuses to publish) and with the diagnostics discarded (so
 * a page that failed to render was simply *not there*, and the request fell through to Vite's bare
 * 404 with nothing anywhere saying why). Both now come through `resolveArticle`.
 *
 * The sharpest case is the last test here: an `article.yaml` with no `nav:` has no pages at all,
 * because `nav` is what makes a markdown file a page. A build wrote a site of zero pages and
 * exited 0; the dev server 404'd at `/`. Same folder, opposite verdicts, and neither of them said
 * the thing that was actually true.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { tempDir } from "../../../test/tmp.js";
import { buildStatic, createDevServer } from "../src/index.js";
import { stubShell } from "./stub-shell.js";

interface FolderSpec {
  /** `nav:` block, or `undefined` for a folder that never wrote one. */
  readonly nav?: readonly string[];
  readonly files?: Record<string, string>;
  readonly gitignore?: string;
}

async function folder(spec: FolderSpec): Promise<string> {
  const dir = await tempDir("parity");
  const yaml = [
    "slug: notes", "title: Notes", "status: published",
    ...(spec.nav === undefined ? [] : ["nav:", ...spec.nav.map((n) => `  - ${n}`)]),
    "",
  ].join("\n");
  await writeFile(join(dir, "article.yaml"), yaml);
  await writeFile(join(dir, "index.md"), "# Notes\n\nA paragraph.\n");
  for (const [path, contents] of Object.entries(spec.files ?? {})) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), contents);
  }
  if (spec.gitignore !== undefined) {
    await writeFile(join(dir, ".gitignore"), spec.gitignore);
    execFileSync("git", ["init", "-q"], { cwd: dir });
  }
  return dir;
}

let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** The dev server's answers for one folder: status per path, and the article it resolved. */
async function serve(dir: string): Promise<{ status: (path: string) => Promise<number>; assets: readonly string[] }> {
  server = await createDevServer({ folder: dir, shell: stubShell, port: 0, host: "127.0.0.1" });
  await server.listen();
  const { port } = server.httpServer!.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const { resolveArticle } = await import("../src/article.js");
  const resolved = await resolveArticle({ folder: dir, base: "/", strict: false });
  return {
    status: async (path) => (await fetch(`${origin}${path}`, { headers: { accept: "text/html" } })).status,
    assets: resolved.article.manifest.assets,
  };
}

describe("dev and build resolve the same article", () => {
  it("excludes what git ignores in dev, exactly as a build does", async () => {
    const dir = await folder({
      nav: ["{ title: Index, page: index.md }"],
      gitignore: "secret/\n",
      files: { "secret/notes.txt": "internal", "public.txt": "fine" },
    });
    const built = await buildStatic({ folder: dir, outDir: join(await tempDir("parity-out"), "site"), shell: stubShell, strict: false, strictAssets: false });
    const dev = await serve(dir);

    // The build never copies it…
    expect(built.files).not.toContain("secret/notes.txt");
    // …and the dev server no longer counts it as part of the article either.
    expect(dev.assets).not.toContain("secret/notes.txt");
    expect(dev.assets).toContain("public.txt");
    expect(await dev.status("/")).toBe(200);
  }, 60_000);

  it("agrees that a folder with no nav has no pages, and both say so", async () => {
    const dir = await folder({});
    const built = await buildStatic({ folder: dir, outDir: join(await tempDir("parity-out"), "site"), shell: stubShell, strict: false, strictAssets: false });
    // The build used to publish this in silence. It is the one fact worth stating about the folder.
    expect(built.diagnostics.map((d) => d.code)).toContain("no-pages");
    expect(built.files).not.toContain("index.html");

    const dev = await serve(dir);
    // Still a 404 — there is genuinely no page — but it is the article's own 404 now, not Vite's.
    expect(await dev.status("/")).toBe(404);
  }, 60_000);

  it("keeps serving a folder whose nav names a file that is not there, and does not lose the rest", async () => {
    const dir = await folder({
      nav: ["{ title: Index, page: index.md }", "{ title: Ghost, page: ghost.md }"],
    });
    const dev = await serve(dir);
    expect(await dev.status("/")).toBe(200);
    expect(await dev.status("/ghost/")).toBe(404);
    // Non-strict, so the build still writes what exists — the same verdict, reported not enforced.
    const built = await buildStatic({ folder: dir, outDir: join(await tempDir("parity-out"), "site"), shell: stubShell, strict: false, strictAssets: false });
    expect(built.diagnostics.map((d) => d.code)).toContain("nav-missing-file");
    expect(built.files).toContain("index.html");
  }, 60_000);
});
