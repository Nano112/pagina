#!/usr/bin/env node
// Switch pagina from a linked Kineglyph checkout to the published packages.
//
// Run this once, after Kineglyph's first npm release. Until then `@kineglyph/*` cannot be a real
// dependency of anything here: `npm ci` would ask the registry for a package that does not exist
// and every CI lane would go red. So the packages carry `@kineglyph/*` as *optional* peers with
// real semver ranges — the ranges are already right, npm just does not go and fetch them — and
// this script flips the switch in one commit.
//
//   node scripts/adopt-kineglyph.mjs [--check]
//
// `--check` reports what would change and exits non-zero if anything would, so CI can assert the
// repo is in whichever state it is meant to be in.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

// `@pagina/vite` is the only package that imports Kineglyph at module scope — `src/prerender.ts`
// has a top-level `import { prerender } from "@kineglyph/export"`, and `src/build.ts` imports
// that eagerly. There is no code path through `pagina build` that avoids it, so for this package
// Kineglyph is a plain dependency, not something the user is invited to supply.
//
// `@pagina/cli` and `@pagina/shell-static` only ever reach Kineglyph through `@pagina/vite` or
// through a bare specifier the bundler rewrites, so they keep it as a peer: one copy of the
// figure engine per install, chosen by whoever is installing.
const RUNTIME_DEP = "vite";
const PEER_ONLY = ["cli", "shell-static"];

const RANGES = {
  "@kineglyph/core": "^0.1.0",
  "@kineglyph/export": "^0.2.0",
  "@kineglyph/web": "^0.1.0",
};

const changes = [];

function edit(rel, fn) {
  const file = join(ROOT, rel);
  const before = readFileSync(file, "utf8");
  const pkg = JSON.parse(before);
  fn(pkg);
  const after = JSON.stringify(pkg, null, 2) + "\n";
  if (after === before) return;
  changes.push(rel);
  if (!CHECK) writeFileSync(file, after);
}

// 1. @pagina/vite: optional peer -> real dependency.
edit(`packages/${RUNTIME_DEP}/package.json`, (pkg) => {
  for (const [name, range] of Object.entries(RANGES)) {
    if (!pkg.peerDependencies?.[name]) continue;
    delete pkg.peerDependencies[name];
    delete pkg.peerDependenciesMeta?.[name];
    pkg.dependencies = { ...pkg.dependencies, [name]: range };
  }
  if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length === 0) delete pkg.peerDependencies;
  if (pkg.peerDependenciesMeta && Object.keys(pkg.peerDependenciesMeta).length === 0) delete pkg.peerDependenciesMeta;
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
});

// 2. The remaining packages keep Kineglyph as a peer, but a *required* one: an install that
//    silently omits the figure engine produces a build that fails on the first figure, and a
//    warning at install time is cheaper than a stack trace at build time.
for (const dir of PEER_ONLY) {
  edit(`packages/${dir}/package.json`, (pkg) => {
    if (!pkg.peerDependencies) return;
    for (const name of Object.keys(RANGES)) {
      if (pkg.peerDependencies[name]) delete pkg.peerDependenciesMeta?.[name];
    }
    if (pkg.peerDependenciesMeta && Object.keys(pkg.peerDependenciesMeta).length === 0) {
      delete pkg.peerDependenciesMeta;
    }
  });
}

// 3. The workspace root gets them as devDependencies so a fresh clone can run the test suite
//    with `npm ci` alone — no sibling checkout, no `npm link`.
edit("package.json", (pkg) => {
  pkg.devDependencies = Object.fromEntries(
    Object.entries({ ...pkg.devDependencies, ...RANGES }).sort(([a], [b]) => a.localeCompare(b)),
  );
});

if (CHECK) {
  if (changes.length) {
    console.error("pagina still consumes Kineglyph from a link. Would change:\n  " + changes.join("\n  "));
    process.exit(1);
  }
  console.log("pagina already depends on published @kineglyph/* packages.");
  process.exit(0);
}

if (!changes.length) {
  console.log("Nothing to do — pagina already depends on published @kineglyph/* packages.");
  process.exit(0);
}

console.log("Updated:\n  " + changes.join("\n  "));
console.log("\n$ npm install");
execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit" });
console.log(
  "\nDone. `npm run link:kineglyph` still works and still wins — it is now a way to test an\n" +
  "unreleased Kineglyph, not the only way to install.\n\n" +
  "The CI workflows may keep their checkout-and-symlink block: pinning the figure engine by SHA\n" +
  "is still the stricter thing to test against. Drop it only when you want CI to exercise what a\n" +
  "stranger gets from the registry.",
);
