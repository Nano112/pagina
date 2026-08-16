import type { Diagnostic, FigureRef } from "./types.js";

export interface FigureRewriteOptions { readonly pageSlug: string; readonly themes: readonly string[]; readonly staticBaseUrl: (id: string) => string }
/** A figure id becomes a URL path segment, a DOM id and a manifest key, so keep it boring. */
const ID_RE = /^[A-Za-z0-9_.-]+$/;
const FIGURE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/g;
const attr = (attrs: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
const isKg = (attrs: string): boolean => {
  const cls = attr(attrs, "class");
  return cls !== undefined && /(^|\s)kg(\s|$)/.test(cls);
};

export function extractFigures(html: string, opts: FigureRewriteOptions): { html: string; figures: FigureRef[]; diagnostics: Diagnostic[] } {
  const figures: FigureRef[] = [];
  const diagnostics: Diagnostic[] = [];
  let n = 0;
  const out = html.replace(FIGURE, (whole, attrs: string, inner: string) => {
    if (!isKg(attrs)) return whole;
    n++;
    const authored = attr(attrs, "id");
    const generated = `kg-${opts.pageSlug}-${n}`;
    // An author-supplied id ends up in a file path and a URL; anything outside this alphabet
    // would either escape the figures directory or need escaping everywhere it is interpolated.
    const usable = authored !== undefined && ID_RE.test(authored);
    if (authored !== undefined && !usable)
      diagnostics.push({ severity: "warning", code: "figure-id-invalid", message: `figure id "${authored}" is not [A-Za-z0-9_.-]+; using "${generated}" instead` });
    const id = usable ? authored : generated;
    // Keep the DOM id in step with the manifest key when a bad one was replaced.
    const fixedAttrs = authored === undefined ? attrs : usable ? attrs : attrs.replace(/\bid="[^"]*"/, `id="${id}"`);
    const scene = attr(attrs, "data-scene");
    const script = /<script\b[^>]*type="text\/kineglyph"[^>]*>([\s\S]*?)<\/script>/.exec(inner);
    if (script === null && scene === undefined) {
      figures.push({ id, kind: "static", ...(attr(attrs, "data-static") === undefined ? {} : { static: attr(attrs, "data-static")! }) });
      return fixedAttrs === attrs ? whole : `<figure${fixedAttrs}>${inner}</figure>`;
    }
    const base = opts.staticBaseUrl(id);
    const [first, ...rest] = opts.themes as [string, ...string[]];
    const sources = rest.map((t) => `<source${t === "dark" ? ` media="(prefers-color-scheme: dark)"` : ""} srcset="${base}.${t}.svg">`).join("");
    const picture = `<picture class="kg-static">${sources}<img src="${base}.${first}.svg" alt="" loading="lazy"></picture>`;
    const withId = authored === undefined ? `${attrs} id="${id}"` : fixedAttrs;
    figures.push(script !== null ? { id, kind: "inline", source: script[1]!.trim() } : { id, kind: "module", scene: scene! });
    return `<figure${withId}>${picture}${inner}</figure>`;
  });
  return { html: out, figures, diagnostics };
}
