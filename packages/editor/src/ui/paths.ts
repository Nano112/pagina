/**
 * Folder-relative path arithmetic.
 *
 * Everything the store holds is addressed from the article root (`guide/figures.md`,
 * `scenes/demo.mjs`), but everything the *markdown* holds is addressed from the page that contains
 * it (`../scenes/demo.mjs`) — that is what the browser resolves a `data-scene` or a `<model-viewer
 * src>` against. So the editor is permanently translating between the two, and it does it here
 * rather than inline, because getting it wrong is silent: the figure simply never loads.
 *
 * These are pure string functions on `/`-separated paths. No `node:path`: this module is bundled
 * for the browser.
 */

/** `guide/figures.md` → `guide`; a root-level file → `""`. */
export function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** Collapses `.` and `..` segments. A `..` that escapes the root is kept, as the fs would. */
function normalise(segments: readonly string[]): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(segment);
  }
  return out;
}

/**
 * Resolves `href` as written *inside* `from` into an article-root path.
 *
 * `resolvePath("guide/figures.md", "../scenes/demo.mjs")` → `scenes/demo.mjs`. Absolute and
 * external references are returned untouched: they do not name a file in the folder.
 */
export function resolvePath(from: string, href: string): string {
  if (href === "" || href.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  return normalise([...dirOf(from).split("/"), ...href.split("/")]).join("/");
}

/**
 * Writes `target` the way `from` has to spell it.
 *
 * `relativePath("guide/figures.md", "scenes/demo.mjs")` → `../scenes/demo.mjs`. A sibling gets a
 * bare name rather than `./name`, which is what the dialect's existing sources use.
 */
export function relativePath(from: string, target: string): string {
  const here = normalise(dirOf(from).split("/"));
  const there = normalise(target.split("/"));
  let shared = 0;
  while (shared < here.length && shared < there.length && here[shared] === there[shared]) shared += 1;
  const up = Array.from({ length: here.length - shared }, () => "..");
  return [...up, ...there.slice(shared)].join("/");
}

/** `Some Title!` → `some-title`, the character set spec ids and file names both accept. */
export function slugify(text: string): string {
  // NFKD splits an accented letter into its base plus a combining mark, and the combining mark is
  // then swallowed by the `[^a-z0-9]` pass — so `Café` slugs to `cafe`, not `caf-`.
  const slug = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "figure" : slug;
}
