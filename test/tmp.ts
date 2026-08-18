/**
 * Scratch directories for tests, with the two properties the ad-hoc version never had:
 * they are somewhere absolute, and they go away again.
 *
 * Before this helper existed, 23 call sites each wrote `mkdtemp(join(tmpdir(), "pagina-…"))` and
 * only one of them ever deleted the result. Two failures followed from that:
 *
 * 1. **Nothing was cleaned up.** A full run left ~40 directories behind, forever. On a machine
 *    that had run the suite a few dozen times there were 734 of them.
 * 2. **`tmpdir()` is not necessarily absolute** — see `paginaTempRoot`. Under a relative
 *    `$TMPDIR` every one of those 23 sites wrote into `process.cwd()` instead, which is how a run
 *    of this suite dumped 2,094 directories and 442 MB into an unrelated repository.
 *
 * So: one door in, and the setup file (`test/setup.ts`) shuts it after every test file, pass or
 * fail. `eslint.config.js` forbids `node:os`'s `tmpdir` in test files so the ad-hoc form cannot
 * come back, and `test/setup.ts` fails any file that leaves something in the working directory.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { paginaTempRoot } from "../packages/vite/src/tmp.js";

/**
 * Every directory `tempDir` has handed out and `cleanupTempDirs` has not yet removed.
 *
 * Module state is the right scope: vitest gives each test *file* a fresh module registry, so this
 * set only ever holds one file's directories, and the `afterAll` that drains it is that file's.
 */
const outstanding = new Set<string>();

/**
 * A fresh empty directory that will be deleted when this test file finishes.
 *
 * `prefix` names it for whoever is looking at a hung run's leftovers; it is not unique on its own,
 * `mkdtemp` supplies the random suffix.
 */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(paginaTempRoot(), `pagina-${prefix}-`));
  outstanding.add(dir);
  return dir;
}

/**
 * Deletes every outstanding directory. Registered as an `afterAll` by `test/setup.ts`.
 *
 * `force` because a test is entitled to have deleted, renamed or moved its own directory — the
 * bundle tests `rename` staging directories away on purpose — and a cleanup step that throws on
 * an already-clean state would turn tidiness into flakiness.
 */
export async function cleanupTempDirs(): Promise<void> {
  const dirs = [...outstanding];
  outstanding.clear();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}
