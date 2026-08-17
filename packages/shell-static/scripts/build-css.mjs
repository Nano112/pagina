/**
 * The shell's CSS artefacts.
 *
 * `client/*.css` is *source*: `pagina.css` is three files held together by two `@import`s, so
 * the reading layer can be shared with `@pagina/editor` and the tokens layer can also ship on
 * its own. A host must never see that structure. It gets, in `dist/`:
 *
 *   pagina.css          the whole sheet, imports inlined — one file, one hash, no extra request
 *   pagina.tokens.css   reset + tokens only, for `theme: "tokens"`
 *   pagina.reading.css  the content column only, for a host that assembles its own combination
 *
 * Why inline rather than ship the `@import`: an imported sheet has no URL of its own for a
 * host's cache-busting to stamp. A tokens-only edit changes nothing about `pagina.css`, so its
 * content hash is unchanged and every browser keeps the stale tokens — schemat.io had to fold
 * pagina's relative imports into its own asset version to compensate. It also costs a second
 * blocking round trip, because an `@import` is not discovered until the importing sheet lands.
 *
 * A hand-rolled inliner rather than a bundler because the input is ours and tiny: relative
 * `@import "./x.css";` statements, one level deep, no media queries or `supports()` conditions.
 * `assertFlat()` below fails the build rather than let anything more elaborate through silently.
 * The output stays unminified: a host reads it, diffs it, and overrides from it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = fileURLToPath(new URL("../client/", import.meta.url));
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

/** Only the shape we actually write: a relative path, no conditions, on its own statement. */
const IMPORT = /^[ \t]*@import\s+"(\.[^"]*\.css)"\s*;[ \t]*$/gm;
/** The layer-order declaration every pagina sheet repeats; one copy survives inlining. */
const LAYER_DECL = /^[ \t]*@layer\s+pagina\.[^{;]*;[ \t]*$/gm;

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function assertFlat(css, file) {
  // Comments talk *about* `@import`; only statements count.
  const stray = stripComments(css).replace(IMPORT, "").match(/@import/);
  if (stray !== null) {
    throw new Error(`${file}: @import that build-css.mjs cannot inline (only relative "./x.css" is supported)`);
  }
}

/**
 * Reads `entry` and replaces each relative `@import` with the imported file, recursively.
 * Every sheet repeats the layer-order declaration, so all but the first are dropped: a second
 * declaration would be a no-op for the cascade but a lie about where the order comes from.
 */
export async function flattenCss(entry, seen = new Set()) {
  const css = await readFile(entry, "utf8");
  assertFlat(css, entry);
  const parts = [];
  let last = 0;
  for (const m of css.matchAll(IMPORT)) {
    parts.push(css.slice(last, m.index));
    const target = resolve(dirname(entry), m[1]);
    parts.push(seen.has(target) ? "" : await flattenCss(target, seen.add(target)));
    last = m.index + m[0].length;
  }
  parts.push(css.slice(last));
  let out = parts.join("");
  let first = true;
  out = out.replace(LAYER_DECL, (line) => (first ? ((first = false), line) : ""));
  return `${out.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Published name → source file. The published names are what `docs/theming.md` tells hosts to link. */
export const CSS_OUTPUTS = Object.freeze({
  "pagina.css": "pagina.css",
  "pagina.tokens.css": "tokens.css",
  "pagina.reading.css": "reading.css",
});

/** Writes every artefact into `outDir`. Returns the names written. */
export async function buildCss(outDir = DIST) {
  await mkdir(outDir, { recursive: true });
  for (const [out, src] of Object.entries(CSS_OUTPUTS)) {
    const css = await flattenCss(resolve(CLIENT, src));
    if (stripComments(css).includes("@import")) throw new Error(`${out}: an @import survived inlining`);
    await writeFile(resolve(outDir, out), css);
  }
  return Object.keys(CSS_OUTPUTS);
}

// `node scripts/build-css.mjs [outDir]` — the package's build step, and the suite's, which runs
// it as a subprocess into a temp directory. (Importing it from a test instead would put the file
// through vitest's transform, where `import.meta.url` is no longer a `file:` URL.)
await buildCss(process.argv[2] === undefined ? undefined : resolve(process.argv[2]));
