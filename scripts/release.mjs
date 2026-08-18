#!/usr/bin/env node
// Release driver for this monorepo's npm packages.
//
//   node scripts/release.mjs check     clean build + full test suite + tarball audit
//   node scripts/release.mjs pack      tarball audit only (writes .release/ tarballs)
//   node scripts/release.mjs publish   check, then publish every package in dependency order
//
// The publish step is deliberately the only thing that talks to the registry, and it refuses to
// run unless `npm whoami` succeeds — an unauthenticated publish half-way through a dependency
// chain leaves a scope with holes in it, and a published version is immutable.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".release");

const run = (cmd, cwd = ROOT) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

/** Every workspace package under packages/ that is not `private`. */
function publishable() {
  const dir = join(ROOT, "packages");
  return readdirSync(dir)
    .map((d) => ({ dir: join(dir, d), file: join(dir, d, "package.json") }))
    .filter((p) => existsSync(p.file))
    .map((p) => ({ ...p, json: JSON.parse(readFileSync(p.file, "utf8")) }))
    .filter((p) => !p.json.private);
}

/** Dependency-first order: a package is never published before something it depends on. */
function topological(pkgs) {
  const byName = new Map(pkgs.map((p) => [p.json.name, p]));
  const done = new Set();
  const out = [];
  const visit = (p, seen = new Set()) => {
    if (done.has(p.json.name)) return;
    if (seen.has(p.json.name)) throw new Error(`dependency cycle at ${p.json.name}`);
    seen.add(p.json.name);
    const deps = { ...p.json.dependencies, ...p.json.peerDependencies };
    for (const name of Object.keys(deps)) {
      const dep = byName.get(name);
      if (dep) visit(dep, seen);
    }
    done.add(p.json.name);
    out.push(p);
  };
  for (const p of pkgs) visit(p);
  return out;
}

/** Pack each package and assert the tarball is fit to be public and immutable. */
function audit(pkgs) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const problems = [];
  const rows = [];

  for (const p of pkgs) {
    const raw = execFileSync("npm", ["pack", "--pack-destination", OUT, "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    const meta = JSON.parse(raw)[0];
    const files = meta.files.map((f) => f.path);
    const has = (re) => files.some((f) => re.test(f));

    const bad = [];
    if (!has(/^README\.md$/i)) bad.push("no README.md");
    if (!has(/^LICENSE$/i)) bad.push("no LICENSE");
    if (files.some((f) => /\.(test|spec)\./.test(f))) bad.push("ships tests");
    if (files.some((f) => /\.tsbuildinfo$/.test(f))) bad.push("ships .tsbuildinfo");
    if (!p.json.publishConfig?.access) bad.push("no publishConfig.access");
    if (!p.json.repository) bad.push("no repository");
    if (!p.json.description) bad.push("no description");
    for (const field of ["dependencies", "peerDependencies"]) {
      for (const [n, r] of Object.entries(p.json[field] ?? {})) {
        if (r === "*") bad.push(`${field}.${n} is "*"`);
      }
    }
    // A dist entry that does not exist is the failure `npm pack` will not catch: the file is
    // simply absent from the tarball and the first `import` a stranger writes throws.
    const entries = [p.json.main, p.json.types, ...Object.values(p.json.bin ?? {})].filter(Boolean);
    for (const cond of Object.values(p.json.exports ?? {})) {
      if (typeof cond === "string") entries.push(cond);
      else for (const [k, v] of Object.entries(cond ?? {})) {
        if (k !== "development" && typeof v === "string") entries.push(v);
      }
    }
    for (const e of new Set(entries)) {
      const rel = e.replace(/^\.\//, "");
      if (rel.includes("*")) continue;
      if (!files.includes(rel)) bad.push(`entry missing from tarball: ${e}`);
    }

    rows.push({
      name: `${meta.name}@${meta.version}`,
      files: meta.entryCount,
      packed: `${(meta.size / 1024).toFixed(1)} KB`,
      unpacked: `${(meta.unpackedSize / 1024).toFixed(1)} KB`,
      status: bad.length ? "FAIL" : "ok",
    });
    if (bad.length) problems.push(`${meta.name}: ${bad.join("; ")}`);
  }

  console.table(rows);
  if (problems.length) {
    console.error("\nTarball audit failed:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\nTarballs written to ${OUT}`);
}

const step = process.argv[2] ?? "check";
const pkgs = topological(publishable());
console.log("publish order:", pkgs.map((p) => p.json.name).join(" -> "));

if (step === "check" || step === "publish") {
  run("npm run clean --if-present");
  run("npm ci --no-audit --no-fund");

  // `npm ci` prunes anything that is not in the lockfile, which includes a linked sibling
  // checkout. If this repo still consumes a package that is not on the registry, say so here
  // rather than letting the test run fail three minutes later with a module-not-found.
  const needsLink = existsSync(join(ROOT, "package.json")) &&
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts?.["link:kineglyph"] &&
    !existsSync(join(ROOT, "node_modules", "@kineglyph", "core"));
  if (needsLink) {
    console.error(
      "\n@kineglyph/* is not installed after `npm ci`.\n" +
      "Either publish Kineglyph and run `npm run adopt:kineglyph`, or run\n" +
      "`npm run link:kineglyph` against a local checkout before releasing.",
    );
    process.exit(1);
  }

  run("npm test");
}

if (step === "check" || step === "pack" || step === "publish") {
  if (step === "pack") run("npm run build");
  audit(pkgs);
}

if (step === "publish") {
  try {
    const who = execFileSync("npm", ["whoami"], { encoding: "utf8" }).trim();
    console.log(`\npublishing as ${who}`);
  } catch {
    console.error("\nnpm whoami failed — run `npm login` first. Nothing was published.");
    process.exit(1);
  }
  const dry = process.env.RELEASE_DRY_RUN === "1" ? ["--dry-run"] : [];
  for (const p of pkgs) {
    console.log(`\n--- publish ${p.json.name}@${p.json.version}`);
    execFileSync("npm", ["publish", "--access", "public", ...dry], { cwd: p.dir, stdio: "inherit" });
  }
  const stamp = pkgs.map((p) => `${p.json.name}@${p.json.version}`).join("\n  ");
  console.log(`\nAll published:\n  ${stamp}\n\nTag the release, naming the versions it carries:\n  git tag -a release-$(date +%Y-%m-%d) -m 'first npm release' && git push origin --tags`);
}
