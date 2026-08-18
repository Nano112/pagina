import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdown, renderMarkdown } from "../src/markdown.js";
import { expandSnippets } from "../src/plugins/snippets.js";
import type { ContentFs } from "../src/types.js";

/**
 * Byte-for-byte HTML goldens for the whole markdown pipeline.
 *
 * These exist to pin the rendered output while the block plugins are refactored from
 * "render eagerly into one `html_block`" to structured tokens + renderer rules: the site's HTML
 * must not change by a byte.
 *
 * Regenerate with:
 *
 *     PAGINA_UPDATE_GOLDEN=1 npx vitest run packages/core/test/golden.test.ts
 *
 * Inputs are committed under `test/golden/input/`: the fixture pages come from `test/fixture/`,
 * and the two Nucleation pages are snapshotted (post-`expandSnippets`) from the vendored copies in
 * `fixtures/nucleation/`, so the goldens stay reproducible even though that repo keeps moving.
 * Updating regenerates the inputs from those copies, then rewrites every golden.
 *
 * The vendored copies are refreshed by hand — `scripts/sync-nucleation-fixtures.mjs` — and never
 * by a test. Nothing here reads a path outside this repository.
 */

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, "golden");
const inputDir = join(goldenDir, "input");
const fixtureRoot = join(here, "fixture");
const nucleationRoot = resolve(here, "../../../fixtures/nucleation/docs");
const UPDATE = process.env["PAGINA_UPDATE_GOLDEN"] === "1";

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

function nodeFs(root: string): ContentFs {
  const abs = (p: string) => resolve(root, p);
  return {
    read: async (p) => readFileSync(abs(p), "utf8"),
    readBinary: async (p) => new Uint8Array(readFileSync(abs(p))),
    exists: async (p) => existsSync(abs(p)),
    list: async () => [],
  };
}

/** `<root>/<page>` with snippets expanded, exactly as `renderPage` would hand it to markdown-it. */
async function expandedSource(root: string, page: string, roots: readonly string[]): Promise<string> {
  const fs = nodeFs(root);
  const source = (await fs.read(page)).replace(FRONT_MATTER, "");
  const { text } = await expandSnippets(source, { fs, roots, pagePath: page });
  return text;
}

function fixturePages(): string[] {
  const top = readdirSync(fixtureRoot).filter((n) => n.endsWith(".md"));
  const guide = readdirSync(join(fixtureRoot, "guide")).filter((n) => n.endsWith(".md")).map((n) => `guide/${n}`);
  return [...top.sort(), ...guide.sort()];
}

/**
 * Case name → committed, already-expanded markdown input. Updating refreshes the generated
 * inputs from their sources; hand-written inputs (`dialect.md`) are picked up as they are.
 */
async function collectInputs(): Promise<Map<string, string>> {
  if (UPDATE) {
    mkdirSync(inputDir, { recursive: true });
    const generated = new Map<string, string>();
    for (const page of fixturePages()) {
      generated.set(`fixture-${page.replace(/\.md$/, "").replace(/\//g, "-")}`, await expandedSource(fixtureRoot, page, [".", "../outside"]));
    }
    for (const page of ["index.md", "features/basics.md"]) {
      generated.set(`nucleation-${page.replace(/\.md$/, "").replace(/\//g, "-")}`, await expandedSource(nucleationRoot, page, [".", ".."]));
    }
    for (const [name, text] of generated) writeFileSync(join(inputDir, `${name}.md`), text);
  }
  const inputs = new Map<string, string>();
  for (const name of readdirSync(inputDir).filter((n) => n.endsWith(".md")).sort()) {
    inputs.set(name.replace(/\.md$/, ""), readFileSync(join(inputDir, name), "utf8"));
  }
  return inputs;
}

const inputs = await collectInputs();

describe("golden HTML", () => {
  it("has inputs to render", () => {
    expect([...inputs.keys()]).toEqual(expect.arrayContaining([
      "dialect", "fixture-index", "fixture-guide-tabs", "fixture-guide-figures", "nucleation-index", "nucleation-features-basics",
    ]));
  });

  it.each([...inputs.keys()])("renders %s exactly as committed", (name) => {
    const { html, headings } = renderMarkdown(createMarkdown(), inputs.get(name)!);
    const htmlFile = join(goldenDir, `${name}.html`);
    const headingsFile = join(goldenDir, `${name}.headings.json`);
    if (UPDATE) {
      writeFileSync(htmlFile, html);
      writeFileSync(headingsFile, `${JSON.stringify(headings, null, 2)}\n`);
    }
    expect(html).toBe(readFileSync(htmlFile, "utf8"));
    expect(headings).toEqual(JSON.parse(readFileSync(headingsFile, "utf8")));
  });
});
