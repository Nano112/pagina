import type { FigureRef } from "./types.js";

export interface FigureRewriteOptions { readonly pageSlug: string; readonly themes: readonly string[]; readonly staticBaseUrl: (id: string) => string }
const FIGURE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/g;
const attr = (attrs: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
const isKg = (attrs: string): boolean => {
  const cls = attr(attrs, "class");
  return cls !== undefined && /(^|\s)kg(\s|$)/.test(cls);
};

export function extractFigures(html: string, opts: FigureRewriteOptions): { html: string; figures: FigureRef[] } {
  const figures: FigureRef[] = [];
  let n = 0;
  const out = html.replace(FIGURE, (whole, attrs: string, inner: string) => {
    if (!isKg(attrs)) return whole;
    n++;
    const existingId = attr(attrs, "id");
    const id = existingId ?? `kg-${opts.pageSlug}-${n}`;
    const scene = attr(attrs, "data-scene");
    const script = /<script\b[^>]*type="text\/kineglyph"[^>]*>([\s\S]*?)<\/script>/.exec(inner);
    if (script === null && scene === undefined) {
      figures.push({ id, kind: "static", ...(attr(attrs, "data-static") === undefined ? {} : { static: attr(attrs, "data-static")! }) });
      return whole;
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
