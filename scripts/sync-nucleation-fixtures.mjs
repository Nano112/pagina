#!/usr/bin/env node
/**
 * Refreshes the vendored Nucleation pages under `fixtures/nucleation/`.
 *
 * pagina's parser, serializer and renderer are tested against real pages, not only against
 * hand-made ones — a dialect is only as good as the documents people actually wrote in it. Those
 * pages live in another repository, so they are **copied in and committed here**: coverage that
 * depends on a sibling checkout is coverage that silently disappears on every other machine, and
 * that changes under your feet whenever someone edits an unrelated repo.
 *
 * Re-syncing is therefore explicit and manual. Nothing in the test suite runs this.
 *
 *     PAGINA_NUCLEATION_ROOT=~/src/Nucleation node scripts/sync-nucleation-fixtures.mjs
 *     node scripts/sync-nucleation-fixtures.mjs ~/src/Nucleation
 *
 * Afterwards, review the diff, re-run the suite, and regenerate the core goldens if the pages
 * really did change:
 *
 *     PAGINA_UPDATE_GOLDEN=1 npx vitest run packages/core/test/golden.test.ts
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Paths relative to the Nucleation repository root. The two pages are the ones the tests read; the
 * snippet targets are what their `--8<--` directives resolve to, and without them `expandSnippets`
 * would quietly produce a different document than the site builds.
 */
const FILES = [
  "docs/article.yaml",
  "docs/index.md",
  "docs/features/basics.md",
  "examples/readme/basics/basics.py",
  "examples/readme/basics/basics.mjs",
  "examples/readme/basics/rust/src/main.rs",
];

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, "..", "fixtures", "nucleation");
const source = process.argv[2] ?? process.env["PAGINA_NUCLEATION_ROOT"];

if (source === undefined) {
  console.error("Point this at a Nucleation checkout: PAGINA_NUCLEATION_ROOT=<path> or pass it as the first argument.");
  process.exit(2);
}

const root = resolve(source.replace(/^~(?=\/|$)/, process.env["HOME"] ?? "~"));
if (!existsSync(join(root, "docs", "index.md"))) {
  console.error(`Not a Nucleation checkout (no docs/index.md): ${root}`);
  process.exit(2);
}

for (const file of FILES) {
  const from = join(root, file);
  if (!existsSync(from)) {
    console.error(`Missing in the checkout: ${file}`);
    process.exit(1);
  }
  const to = join(dest, file);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`  ${file}`);
}
console.log(`\n${FILES.length} files synced from ${root} into fixtures/nucleation/.`);
console.log("Review the diff, then: PAGINA_UPDATE_GOLDEN=1 npx vitest run packages/core/test/golden.test.ts");
