import type { FigureRef } from "./types.js";

export interface FigureRewriteOptions { readonly pageSlug: string; readonly themes: readonly string[]; readonly staticBaseUrl: (id: string) => string }
const FIGURE = /<figure\b([^>]*\bclass="[^"]*\bkg\b[^"]*"[^>]*)>([\s\S]*?)<\/figure>/g;
const attr = (attrs: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

export function extractFigures(html: string, opts: FigureRewriteOptions): { html: string; figures: FigureRef[] } {
  const figures: FigureRef[] = [];
  let n = 0;
  const out = html.replace(FIGURE, (_whole, attrs: string, inner: string) => {
    n++;
    const existingId = attr(attrs, "id");
    const id = existingId ?? `kg-${opts.pageSlug}-${n}`;
    const scene = attr(attrs, "data-scene");
    const script = /<script\b[^>]*type="text\/kineglyph"[^>]*>([\s\S]*?)<\/script>/.exec(inner);
    if (script === null && scene === undefined) {
      figures.push({ id, kind: "static", ...(attr(attrs, "data-static") === undefined ? {} : { static: attr(attrs, "data-static")! }) });
      return _whole;
    }
    const base = opts.staticBaseUrl(id);
    const [first, ...rest] = opts.themes as [string, ...string[]];
    const sources = rest.map((t) => `<source${t === "dark" ? ` media="(prefers-color-scheme: dark)"` : ""} srcset="${base}.${t}.svg">`).join("");
    const picture = `<picture class="kg-static">${sources}<img src="${base}.${first}.svg" alt="" loading="lazy"></picture>`;
    const withId = existingId === undefined ? `${attrs} id="${id}"` : attrs;
    figures.push(script !== null ? { id, kind: "inline", source: script[1]!.trim() } : { id, kind: "module", scene: scene! });
    return `<figure${withId}>${picture}${inner}</figure>`;
  });
  return { html: out, figures };
}
