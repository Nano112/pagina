/**
 * Which files in an article folder are **not** article content.
 *
 * The build copies the folder's assets into the output verbatim, so the answer to "what is an
 * asset" is the answer to "what gets published". It used to be "everything that is not a page and
 * not `article.yaml`", which is a rule that publishes whatever happens to be sitting in the
 * folder — a directory of internal notes, a 118 MB scratch tree, an `.env`. Publishing private
 * material is the one mistake in this project that cannot be undone, so the rule is now explicit,
 * declared, and reported.
 *
 * The patterns are gitignore-shaped, because that is the syntax an author already knows:
 *
 * - matched against the folder-relative POSIX path of each file;
 * - `*` matches within one segment, `**` across segments, `?` one character that is not `/`;
 * - a pattern with **no** `/` matches at any depth, as a file *or* as a directory — `.*` covers
 *   `.env` and everything under `.git/`, `notes` covers `notes/private.md`;
 * - a `/` at the start or in the middle anchors the pattern to the folder root — `/plans/` and
 *   `plans/q3/` are this folder's, `plans/` is a `plans` directory at any depth;
 * - a trailing `/` means "directory": it matches what is *inside*, never a file of that name;
 * - a leading `!` re-includes, and the last pattern that matches a path decides.
 *
 * This lives in core rather than in the Node filesystem adapter on purpose. `NodeContentFs`
 * happens to skip dot-entries and `node_modules` while walking, but the editor's store and the
 * bundle's reader do not, and a containment rule that only holds for one of three filesystems is
 * not a containment rule.
 */

/**
 * Excluded by every build, before `article.yaml` says anything.
 *
 * Chosen so that each entry names something that is *never* article content, rather than
 * something that is *usually* not — a default that drops a file an author meant to publish is a
 * silent broken image, and the author has no reason to suspect the tool.
 *
 * - `.*` — dotfiles and dot-directories at any depth: `.git`, `.env`, `.DS_Store`, `.github`,
 *   `.obsidian`, `.superpowers`. The bundle writer already refuses to carry a path with a
 *   dot-segment, so this makes the static build agree with it rather than inventing a rule.
 * - `node_modules/` — a dependency tree is never content, and it is the single largest thing that
 *   can end up in a folder by accident.
 * - `bundle.json` — pagina's own bundle descriptor. An article folder that came out of `unpack`
 *   has one at its root, and republishing it puts a checksum manifest of the previous pack on the
 *   web. `.rendered/` next to it is already covered by the dot rule.
 * - `Thumbs.db`, `desktop.ini` — Windows shell droppings, the two that are not dotfiles.
 *
 * Deliberately **not** here: `dist`, `build`, `out`, `tmp`, `*.log`, `README.md`. Every one of
 * them is a plausible name for something an author wrote on purpose, and a default that guesses
 * about intent is worse than a default that only covers what is mechanically not content. Use
 * `exclude` for those; the unreferenced-file report will point at them.
 */
export const DEFAULT_EXCLUDE: readonly string[] = [".*", "node_modules/", "bundle.json", "Thumbs.db", "desktop.ini"];

/** A single compiled pattern: the regexes it matches with, and whether it re-includes. */
interface Compiled {
  readonly negated: boolean;
  readonly res: readonly RegExp[];
}

/** Escapes a literal run for use inside a regex. */
function literal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One glob segment-path → one regex source, anchored at both ends.
 *
 * `**` between separators spans any number of segments including none, which is why the
 * separator is folded into the wildcard: `a/**\/b` has to match `a/b`, not just `a/x/b`.
 */
function globToRegex(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      const doubled = glob[i + 1] === "*";
      if (doubled) {
        i++;
        // `**/` — any number of leading segments, or none at all.
        if (glob[i + 1] === "/") { i++; out += "(?:[^/]+/)*"; continue; }
        out += ".*";
        continue;
      }
      out += "[^/]*";
      continue;
    }
    if (c === "?") { out += "[^/]"; continue; }
    out += literal(c);
  }
  return new RegExp(`^${out}$`);
}

function compile(pattern: string): Compiled | undefined {
  let p = pattern.trim();
  if (p === "" || p.startsWith("#")) return undefined;
  const negated = p.startsWith("!");
  if (negated) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  // gitignore's rule, kept exactly: a separator at the start or the middle anchors the pattern to
  // the folder root, a *trailing* one only says "directory". So `plans/` is any `plans` directory
  // and `/plans/` is this folder's.
  const anchored = p.startsWith("/") || p.includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  if (p === "") return undefined;
  const body = anchored ? p : `**/${p}`;
  const res: RegExp[] = [];
  // The directory reading always applies: gitignore's `build` matches `build/main.css`. The file
  // reading applies unless a trailing slash ruled it out.
  res.push(globToRegex(`${body}/**`));
  if (!dirOnly) res.push(globToRegex(body));
  return { negated, res };
}

/**
 * Turns a pattern list into `(path) => boolean`, true when the path is excluded.
 *
 * Order matters, so this is a fold and not a `.some()`: a later `!keep/this.png` has to be able
 * to win against an earlier `keep/`. An unparseable or empty pattern is skipped rather than
 * thrown on — `exclude` is validated where it is read, and this is also handed raw `.gitignore`
 * lines.
 */
export function makeExcluder(patterns: Iterable<string>): (path: string) => boolean {
  const compiled: Compiled[] = [];
  for (const p of patterns) {
    const c = compile(p);
    if (c !== undefined) compiled.push(c);
  }
  if (compiled.length === 0) return () => false;
  return (path: string): boolean => {
    const p = path.replace(/^\.?\//, "");
    let excluded = false;
    for (const c of compiled) {
      // A plain pattern can only turn exclusion on, a `!` one can only turn it off; when the
      // answer is already what the pattern would say, there is nothing to test.
      if (c.negated !== excluded) continue;
      if (c.res.some((re) => re.test(p))) excluded = !c.negated;
    }
    return excluded;
  };
}

/**
 * The excluder a render uses: the built-in defaults, then the folder's own `exclude`, then
 * whatever the caller worked out that the folder cannot state itself — today, the paths git says
 * are ignored.
 *
 * Defaults first so that `!.well-known/` in `article.yaml` can override one, which is the only
 * reason a fixed list is safe to have at all.
 */
export function articleExcluder(config: readonly string[], extra: readonly string[] = []): (path: string) => boolean {
  return makeExcluder([...DEFAULT_EXCLUDE, ...config, ...extra]);
}
