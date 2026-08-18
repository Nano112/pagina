/**
 * "Not for publication", as the folder already says it.
 *
 * An article folder that lives in a git repository usually already states which of its files are
 * private, in the one place everyone who works on it can see: `.gitignore`. Nucleation's docs
 * folder said so about a directory of internal notes and a 118 MB `plans/` tree, and building that
 * folder as a site would have published both — the rule was "copy the folder", and `.gitignore` is
 * not part of the folder's contents.
 *
 * So the build asks git. Not a reimplementation of git's matching rules — `git check-ignore`, the
 * program whose answer is the definition. That gets nested `.gitignore` files, `.git/info/exclude`,
 * the user's global excludes and negation exactly right, which a hand-rolled matcher would not,
 * and getting it subtly wrong here means either publishing a private file or dropping a real one.
 *
 * The choice to honour it at all is a trade against surprise, and the trade is settled by
 * reporting: every build says how many files git's answer removed and names them, and
 * `exclude_gitignore: false` in `article.yaml` turns it off. A file that is both gitignored and
 * *referenced by a page* is a harder case — see `unreferencedReport` in `build.ts`, which turns
 * that into a build error rather than a quietly broken image.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The subset of `paths` that git ignores, folder-relative and POSIX, or `undefined` when the
 * question could not be asked.
 *
 * `undefined` rather than an empty set, because "git said nothing is ignored" and "there is no
 * git here" are different facts and the build reports them differently. A folder outside a work
 * tree, a machine with no git, a git that failed: all `undefined`.
 *
 * `git check-ignore` exits **1** when it matched nothing, which is a normal answer and not a
 * failure, and only ≥2 is an error. `-z` throughout because a filename may contain a newline.
 */
export async function gitIgnoredPaths(folder: string, paths: readonly string[]): Promise<Set<string> | undefined> {
  if (paths.length === 0) return new Set();
  if (!existsSync(folder)) return undefined;
  try {
    // Cheap and decisive: outside a work tree this exits non-zero and we stop here, rather than
    // shelling out with a megabyte of stdin to find out.
    await run("git", ["-C", folder, "rev-parse", "--is-inside-work-tree"], { windowsHide: true });
  } catch {
    return undefined;
  }
  // If the *folder itself* is ignored, every file in it is ignored, and git is answering a
  // question about the container rather than about the article: an article folder that lives
  // inside a `dist/` or a scratch directory would otherwise publish no assets at all, silently.
  // That is not what `.gitignore` was being asked, so its answer is discarded here.
  try {
    await run("git", ["-C", folder, "check-ignore", "-q", "."], { windowsHide: true });
    return undefined;                                     // exit 0 = the folder itself is ignored
  } catch {
    // Exit 1 — not ignored — is the normal path. Anything else is a git that cannot answer, and
    // `check-ignore --stdin` below will fail the same way and return `undefined` too.
  }
  try {
    // No `--no-index`: a file git is *tracking* is not private, whatever pattern happens to match
    // it, and reporting it as ignored would drop a committed asset from the site.
    const child = run("git", ["-C", folder, "check-ignore", "-z", "--stdin"], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    child.child.stdin?.end(`${paths.join("\0")}\0`);
    const { stdout } = await child;
    return new Set(stdout.split("\0").filter((p) => p !== ""));
  } catch (e) {
    // Exit 1 is "nothing matched". `execFile`'s rejection still carries the output it collected.
    const err = e as { code?: unknown; stdout?: string };
    if (err.code === 1) return new Set((err.stdout ?? "").split("\0").filter((p) => p !== ""));
    return undefined;
  }
}
