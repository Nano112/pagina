import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The four layers `pagina.css` declares, in cascade order. */
export const PAGINA_LAYERS = ["pagina.reset", "pagina.tokens", "pagina.reading", "pagina.chrome"] as const;

export const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Strips comments, so a `@layer` mentioned in prose is never mistaken for a statement. */
export const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The first statement of a stylesheet, comments ignored: `@layer a, b;` for a layer
 * declaration. Returns the text up to and including the first `;` or `{`.
 */
export function firstStatement(css: string): string {
  return (/^\s*([^{;]*[;{])/.exec(stripComments(css))?.[1] ?? "").trim();
}

/** The layer names a declaration statement lists, in order. */
export function declaredLayers(css: string): string[] {
  const m = /^@layer\s+([^{;]+);$/.exec(firstStatement(css));
  return m === null ? [] : m[1]!.split(",").map((s) => s.trim());
}

/** Body of the `@layer <name> { … }` block, found by brace matching. */
export function layerBody(css: string, name: string): string | undefined {
  const src = stripComments(css);
  const open = new RegExp(`@layer\\s+${name.replace(".", "\\.")}\\s*\\{`).exec(src);
  if (open === null) return undefined;
  let depth = 1;
  let i = open.index + open[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return src.slice(start, i - 1);
}

/** Every `--pg-*` custom property *defined* (not merely used) in a chunk of CSS. */
export function definedTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/(^|[{;\s])(--pg-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!out.has(m[2]!)) out.set(m[2]!, m[3]!.trim());
  }
  return out;
}

/** Text outside every top-level `@layer … { … }` block — i.e. rules that escaped the layers. */
export function outsideLayers(css: string): string {
  const src = stripComments(css);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const open = /@layer\s+[a-z.\s]+\{/.exec(src.slice(i));
    if (open === undefined || open === null) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, i + open.index);
    let depth = 1;
    let j = i + open.index + open[0].length;
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
    }
    i = j;
  }
  return out;
}
