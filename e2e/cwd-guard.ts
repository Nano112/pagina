/**
 * The same working-directory guard the unit suite has (`test/setup.ts`), for the e2e lane.
 *
 * The e2e lane needs its own because it is the half that runs the *CLI* — `pagina dev`, and the
 * static host — as real processes. A library that writes scratch into its caller's directory is a
 * bug whether the caller is a test or a person, and a child process's stray `mkdir` is invisible
 * to a vitest hook.
 *
 * The snapshot is taken at the *end* of `globalSetup`, not the start: `e2e/.tmp/` is deliberate,
 * gitignored, and built by setup itself. What is being guarded is what the specs and the servers
 * do afterwards.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SNAPSHOT = fileURLToPath(new URL(".tmp/cwd-before.json", import.meta.url));

/** The directories a stray write would land in, de-duplicated for the usual case. */
const watched = (): string[] => [...new Set([resolve(process.cwd()), resolve(REPO_ROOT)])];

/**
 * Directories the *runners* own, which are gitignored and are not leaks.
 *
 * Playwright writes `test-results/` and `playwright-report/` next to its config by design; a
 * guard that called those a leak would simply be wrong. Everything else is.
 */
const RUNNER_ARTEFACTS = new Set(["test-results", "playwright-report", "coverage", ".pagina-scratch"]);

const listing = async (dir: string): Promise<string[]> => (await readdir(dir)).sort();

/** Records what the watched directories held. Called at the end of `globalSetup`. */
export async function recordWorkingDirectories(): Promise<void> {
  const snapshot: Record<string, string[]> = {};
  for (const dir of watched()) snapshot[dir] = await listing(dir);
  await mkdir(fileURLToPath(new URL(".tmp/", import.meta.url)), { recursive: true });
  await writeFile(SNAPSHOT, JSON.stringify(snapshot), "utf8");
}

/** Fails the run if the specs or the servers left anything behind. `globalTeardown`. */
export async function assertWorkingDirectoriesClean(): Promise<void> {
  let snapshot: Record<string, string[]>;
  try {
    snapshot = JSON.parse(await readFile(SNAPSHOT, "utf8")) as Record<string, string[]>;
  } catch {
    // No snapshot means `globalSetup` did not finish, which is already being reported as the
    // failure it is. Adding a second, less informative error on top helps nobody.
    return;
  }
  const strays: string[] = [];
  for (const [dir, had] of Object.entries(snapshot)) {
    const before = new Set(had);
    for (const entry of await listing(dir))
      if (!before.has(entry) && !RUNNER_ARTEFACTS.has(entry)) strays.push(join(dir, entry));
  }
  if (strays.length > 0) {
    throw new Error(
      [
        `The e2e run left ${String(strays.length)} entr${strays.length === 1 ? "y" : "ies"} behind in the working directory:`,
        ...strays.map((s) => `  ${s}`),
        "",
        "Neither the specs nor the pagina CLI may write to the working directory.",
        "Scratch space belongs under an absolute temp root (`paginaTempRoot()`) or in `e2e/.tmp/`.",
      ].join("\n"),
    );
  }
}

export default assertWorkingDirectoriesClean;
