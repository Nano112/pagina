/**
 * Two obligations every test file gets for free, applied by vitest's `setupFiles`.
 *
 * 1. **Scratch directories are deleted** when the file finishes — pass, fail, or throw.
 * 2. **The working directory is left exactly as it was found**, and the file fails if it is not.
 *
 * The second is the one that matters. The first is a promise about code we have already written;
 * the second is a promise about code nobody has written yet, and it is the only one of the two
 * that can catch the next instance of this. The bug it exists for was not a missing `rm` — it was
 * `os.tmpdir()` quietly resolving to `"."` under a relative `$TMPDIR`, so that 23 call sites that
 * all *said* "temp directory" wrote 2,094 entries and 442 MB into an unrelated project's
 * repository. Every one of those call sites read as correct. A diff of the working directory is
 * what notices, because it asks about the observable effect rather than about the intent.
 *
 * Scoped per test *file*, not per run, so a failure names the file that caused it.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { cleanupTempDirs } from "./tmp.js";

/**
 * The directories a stray write would land in.
 *
 * `process.cwd()` is where a relative path resolves, and so is where the damage appeared. The
 * repository root is usually the same directory, but not when the suite is invoked from
 * elsewhere — which is precisely how the original mess was discovered — so both are watched and
 * the pair is de-duplicated for the common case. The root arrives by environment variable
 * because `import.meta.url` is a Vite `/@fs/…` URL in here; see `vitest.config.ts`.
 */
const WATCHED = [...new Set([process.cwd(), resolve(process.env["PAGINA_REPO_ROOT"] ?? process.cwd())])];

/**
 * Directories the *runners* own, which are gitignored and are not leaks.
 *
 * The runners write these next to their config by design, and a guard that called them a leak
 * would simply be wrong. Everything else is. The e2e lane keeps the same list, in
 * `e2e/cwd-guard.ts`.
 */
const RUNNER_ARTEFACTS = new Set(["test-results", "playwright-report", "coverage", ".pagina-scratch"]);

const before = new Map<string, string[]>();

const listing = async (dir: string): Promise<string[]> => (await readdir(dir)).sort();

beforeAll(async () => {
  for (const dir of WATCHED) before.set(dir, await listing(dir));
});

afterAll(async () => {
  // The guard reads the directory *before* cleanup, on purpose. Cleaning up first would delete
  // any scratch directory that had wrongly landed in the working directory, and the check would
  // then pass on exactly the failure it was written to catch.
  const strays: string[] = [];
  for (const dir of WATCHED) {
    const had = new Set(before.get(dir) ?? []);
    for (const entry of await listing(dir))
      if (!had.has(entry) && !RUNNER_ARTEFACTS.has(entry)) strays.push(join(dir, entry));
  }

  await cleanupTempDirs();

  if (strays.length > 0) {
    throw new Error(
      [
        `This test file left ${String(strays.length)} entr${strays.length === 1 ? "y" : "ies"} behind in the working directory:`,
        ...strays.map((s) => `  ${s}`),
        "",
        "Tests must not write to the working directory. Use `tempDir()` from `test/tmp.ts`,",
        "which allocates under an absolute temp root and is cleaned up automatically.",
      ].join("\n"),
    );
  }
});
