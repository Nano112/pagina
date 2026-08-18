/**
 * What a build is allowed to publish.
 *
 * `build` used to copy every non-page file in the article folder. The scenario that made this
 * urgent is the first test below, and it is not hypothetical: Nucleation's `docs/` folder holds a
 * gitignored directory of internal notes and a `plans/` tree, and building it directly would have
 * put 118 MB of both on the public web. Only the *bundle* path was safe, and only because it walks
 * references for portability — containment was a side effect nobody had promised.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "../../../test/tmp.js";
import { buildStatic } from "../src/index.js";
import { stubShell } from "./stub-shell.js";

/** The smallest thing that is an article: one page, one nav entry, no snippets reaching out. */
const ARTICLE_YAML = [
  "slug: notes",
  "title: Notes",
  "status: published",
  "nav:",
  "  - { title: Index, page: index.md }",
  "",
].join("\n");

interface FolderSpec {
  /** Extra YAML appended to the minimal `article.yaml`. */
  readonly yaml?: string;
  /** Path → contents. Directories are created as needed. */
  readonly files?: Record<string, string>;
  /** Markdown body of `index.md`. Defaults to a heading and a paragraph. */
  readonly page?: string;
  /** `.gitignore` contents. When given, the folder is also `git init`ed. */
  readonly gitignore?: string;
}

async function folder(spec: FolderSpec): Promise<string> {
  const dir = await tempDir("exclude");
  await writeFile(join(dir, "article.yaml"), ARTICLE_YAML + (spec.yaml ?? ""));
  await writeFile(join(dir, "index.md"), spec.page ?? "# Notes\n\nA paragraph.\n");
  for (const [path, contents] of Object.entries(spec.files ?? {})) {
    const file = join(dir, path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, contents);
  }
  if (spec.gitignore !== undefined) {
    await writeFile(join(dir, ".gitignore"), spec.gitignore);
    execFileSync("git", ["init", "-q"], { cwd: dir });
  }
  return dir;
}

async function build(dir: string, opts: { strictAssets?: boolean } = {}): Promise<{ out: string; diagnostics: readonly { code: string; severity: string; message: string }[] }> {
  const out = await tempDir("exclude-out");
  const r = await buildStatic({ folder: dir, outDir: out, shell: stubShell, strict: true, ...opts });
  return { out, diagnostics: r.diagnostics };
}

describe("what a build publishes", () => {
  it("does not publish a gitignored directory of private notes", async () => {
    // The Nucleation case, reduced: internal notes and a plans tree, both gitignored, both sitting
    // in the article folder, neither referenced by any page.
    const dir = await folder({
      gitignore: "superpowers/\nplans/\n",
      files: {
        "superpowers/notes.md": "internal only",
        "superpowers/secret.txt": "do not publish",
        "superpowers/diagram.png": "not really a png",
        "plans/q3.pdf": "also internal",
        "media/hero.png": "a real asset",
      },
      page: "# Notes\n\n![hero](media/hero.png)\n",
    });
    const { out, diagnostics } = await build(dir);

    expect(existsSync(join(out, "superpowers")), "superpowers/ must not be published").toBe(false);
    expect(existsSync(join(out, "superpowers/secret.txt"))).toBe(false);
    expect(existsSync(join(out, "superpowers/diagram.png"))).toBe(false);
    expect(existsSync(join(out, "plans")), "plans/ must not be published").toBe(false);
    // And the file that *is* article content still made it.
    expect(existsSync(join(out, "media/hero.png"))).toBe(true);

    // Silently dropping files is its own failure mode, so the build says what git removed.
    const said = diagnostics.find((d) => d.code === "gitignored-excluded");
    expect(said?.message).toContain("superpowers/secret.txt");
    expect(said?.message).toContain("exclude_gitignore: false");
  });

  it("publishes them again when the folder opts out", async () => {
    const dir = await folder({
      yaml: "exclude_gitignore: false\n",
      gitignore: "superpowers/\n",
      files: { "superpowers/secret.txt": "do not publish" },
    });
    const { out, diagnostics } = await build(dir);
    expect(existsSync(join(out, "superpowers/secret.txt"))).toBe(true);
    expect(diagnostics.some((d) => d.code === "gitignored-excluded")).toBe(false);
  });

  it("refuses to publish a page that references a file git ignores", async () => {
    // The one case that is an error however lenient the run: honouring `.gitignore` here would
    // publish a page with a dead image on it, which is worse than either alternative.
    const dir = await folder({
      gitignore: "media/\n",
      files: { "media/hero.png": "a real asset" },
      page: "# Notes\n\n![hero](media/hero.png)\n",
    });
    const out = await tempDir("exclude-out");
    await expect(buildStatic({ folder: dir, outDir: out, shell: stubShell, strict: true }))
      .rejects.toThrow(/gitignored-but-referenced/);
  });

  it("honours an `exclude` list in article.yaml, with no git anywhere", async () => {
    const dir = await folder({
      yaml: "exclude:\n  - drafts/\n  - '*.psd'\n",
      files: {
        "drafts/rough.png": "a draft",
        "art/logo.psd": "a source file",
        "media/hero.png": "a real asset",
      },
      page: "# Notes\n\n![hero](media/hero.png)\n",
    });
    const { out } = await build(dir);
    expect(existsSync(join(out, "drafts"))).toBe(false);
    expect(existsSync(join(out, "art/logo.psd"))).toBe(false);
    expect(existsSync(join(out, "media/hero.png"))).toBe(true);
  });

  it("lets a later `!` win back one file from an excluded directory", async () => {
    const dir = await folder({
      yaml: "exclude:\n  - drafts/\n  - '!drafts/keep.png'\n",
      files: { "drafts/rough.png": "a draft", "drafts/keep.png": "wanted after all" },
    });
    const { out } = await build(dir);
    expect(existsSync(join(out, "drafts/rough.png"))).toBe(false);
    expect(existsSync(join(out, "drafts/keep.png"))).toBe(true);
  });

  it("reports a file nothing references, as a warning", async () => {
    const dir = await folder({
      files: { "media/hero.png": "used", "media/orphan.png": "nothing links this" },
      page: "# Notes\n\n![hero](media/hero.png)\n",
    });
    const { out, diagnostics } = await build(dir);
    const orphan = diagnostics.filter((d) => d.code === "unreferenced-file");
    expect(orphan.map((d) => d.severity)).toEqual(["warning"]);
    expect(orphan[0]?.message).toContain("media/orphan.png");
    // A warning is a warning: the build still wrote it, and the author decides.
    expect(existsSync(join(out, "media/orphan.png"))).toBe(true);
    // The file that is referenced is not reported.
    expect(orphan[0]?.message).not.toContain("hero.png");
  });

  it("refuses the same folder under --strict-assets", async () => {
    const dir = await folder({
      files: { "media/orphan.png": "nothing links this" },
    });
    const out = await tempDir("exclude-out");
    await expect(buildStatic({ folder: dir, outDir: out, shell: stubShell, strict: true, strictAssets: true }))
      .rejects.toThrow(/unreferenced-file/);
  });

  it("does not report a file a page only pulls in with `--8<--`", async () => {
    // Found by pointing the report at pagina's own docs: a snippet is referenced from the page
    // *source*, and by the time the page is HTML the directive has become the quoted text. A walk
    // that only reads rendered output calls every snippet dead weight.
    const dir = await folder({
      files: { "snippets/example.ts": "export const answer = 42;\n" },
      page: '# Notes\n\n```ts\n--8<-- "snippets/example.ts"\n```\n',
    });
    const { diagnostics } = await build(dir);
    const reported = diagnostics.filter((d) => d.code === "unreferenced-file").map((d) => d.message).join(" ");
    expect(reported).not.toContain("snippets/example.ts");
  });

  it("does not report a scene module that only a figure reaches", async () => {
    // The walk follows figures and their transitive imports, so neither the scene nor what it
    // imports is dead weight — the report would be noise, and noise is what gets ignored.
    const dir = await folder({
      files: {
        // A real scene, so the figure actually draws — and one that imports a second local module,
        // because the walk has to follow that too or the transitive case goes unasserted.
        "scenes/demo.mjs": 'import { sceneFromSpec } from "kineglyph";\nimport { spec } from "./spec.mjs";\n\nexport default sceneFromSpec(spec);\n',
        "scenes/spec.mjs": 'export const spec = {\n  version: 1,\n  id: "demo",\n  title: "Demo",\n  layout: "row",\n  nodes: [{ kind: "box", id: "a", title: "A" }],\n  edges: [],\n};\n',
      },
      page: '# Notes\n\n<figure class="kg" data-scene="scenes/demo.mjs" id="demo"></figure>\n',
    });
    const { diagnostics } = await build(dir);
    const reported = diagnostics.filter((d) => d.code === "unreferenced-file").map((d) => d.message).join(" ");
    expect(reported).not.toContain("scenes/demo.mjs");
    expect(reported).not.toContain("scenes/spec.mjs");
  });
});
