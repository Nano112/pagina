import type { Diagnostic, FigureRef, RenderedArticle } from "./types.js";

export interface FigureRewriteOptions { readonly pageSlug: string }
/** A figure id becomes a URL path segment, a DOM id and a manifest key, so keep it boring. */
const ID_RE = /^[A-Za-z0-9_.-]+$/;
const FIGURE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/g;
const attr = (attrs: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
const isKg = (attrs: string): boolean => {
  const cls = attr(attrs, "class");
  return cls !== undefined && /(^|\s)kg(\s|$)/.test(cls);
};

/**
 * The empty frame a figure gets at render time, filled in by `inlineFigureSvgs` once the figure
 * has actually been drawn.
 *
 * It is a `<div>` holding the SVG itself rather than a `<picture>` holding an `<img>`, and that is
 * the whole point: an image is a separate document. Nothing crosses that boundary — not the host's
 * `--kg-color-*`, not its fonts, and not the SVG's own `<title>`/`<desc>`, which is why the `<img>`
 * this replaces had to carry `alt=""` and made every figure invisible to a screen reader. Inlined,
 * the SVG's `role="img"` and its title and description are simply part of the page.
 *
 * `data-kg-static` is Kineglyph's mark for "this is the frame the live stage replaces", so
 * `mountAll` still hides it on hydration.
 */
const frame = (id: string, inner = ""): string =>
  `<div class="kg-frame" data-kg-static data-kg-frame="${id}">${inner}</div>`;

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
    const withId = authored === undefined ? `${attrs} id="${id}"` : fixedAttrs;
    figures.push(script !== null ? { id, kind: "inline", source: script[1]!.trim() } : { id, kind: "module", scene: scene! });
    return `<figure${withId}>${frame(id)}${inner}</figure>`;
  });
  return { html: out, figures, diagnostics };
}

/** `viewBox="0 0 W H"` — the figure's natural size, which is what the frame reserves. */
const VIEW_BOX = /\bviewBox="0 0 ([\d.]+) ([\d.]+)"/;
/** The accessible description Kineglyph writes when the scene has one. */
const HAS_DESC = /<desc\b/;

export interface InlineFiguresResult { readonly html: string; readonly diagnostics: Diagnostic[] }

/**
 * A drawn figure, and what the page needs to know about it beyond its pixels.
 *
 * `needsRuntime` is Kineglyph's `sceneNeedsRuntime` answer for the resolved scene: whether a live
 * mount could show a reader anything this SVG cannot. It is settled here, at publish time, rather
 * than in the browser — deciding it in the browser would mean fetching and resolving the scene
 * module first, which is the whole of the cost the decision exists to avoid.
 */
export interface DrawnFigure { readonly svg: string; readonly needsRuntime?: boolean }
/** A bare string is a figure with no opinion about hydration, which is how it always behaved. */
export type FigureSvg = string | DrawnFigure;
const svgOf = (drawn: FigureSvg): string => (typeof drawn === "string" ? drawn : drawn.svg);

/**
 * Drops each pre-rendered SVG into the frame `extractFigures` left for it.
 *
 * This runs after the figures are drawn and before the page is written, so the SVG is part of the
 * served HTML — server-rendered, no JavaScript involved, and reachable by the host's CSS.
 *
 * The `<figure>` also gains the figure's natural size as `--kg-w`/`--kg-h`. Three rules need it and
 * all three run before any script does: the frame reserves that aspect ratio, so does the live
 * stage that replaces it — which is what keeps hydration from shoving the page around — and the
 * scroll rule works out how far the figure may shrink before its type stops being legible. It goes
 * on the `<figure>` rather than the frame because the stage is the frame's *sibling*, and a custom
 * property has to be on a shared ancestor for both to read it.
 *
 * A figure whose scene has nothing to drive also gains `data-kg-inert="true"`. That is a fact about
 * the scene, not an instruction: it says "the live runtime would redraw this frame and nothing
 * more". pagina's client reads it and skips hydrating, which keeps the server-rendered SVG — the
 * one a screen reader can already read and CSS already themes — instead of replacing it with an
 * identical picture built in JavaScript.
 */
export function inlineFigureSvgs(
  html: string,
  svgFor: (id: string) => FigureSvg | undefined,
  page?: string,
): InlineFiguresResult {
  const diagnostics: Diagnostic[] = [];
  const out = html.replace(
    /(<figure\b[^>]*>)<div class="kg-frame" data-kg-static data-kg-frame="([^"]+)"><\/div>/g,
    (whole, openTag: string, id: string) => {
      const drawn = svgFor(id);
      if (drawn === undefined) return whole;
      const svg = svgOf(drawn);
      const inert = typeof drawn !== "string" && drawn.needsRuntime === false;
      const open = inert ? withAttr(openTag, "data-kg-inert", "true") : openTag;
      if (!HAS_DESC.test(svg))
        diagnostics.push({
          severity: "warning",
          code: "figure-no-description",
          // The builder collects this in a field labelled "Read out to assistive technology"; a
          // figure without one is a picture a screen reader can only announce by its title.
          message: `figure "${id}" has no description, so assistive technology gets only its title; add \`description\` to the scene`,
          ...(page === undefined ? {} : { page }),
        });
      const box = VIEW_BOX.exec(svg);
      const size = box === null ? undefined : `--kg-w:${box[1]};--kg-h:${box[2]}`;
      return `${size === undefined ? open : withStyle(open, size)}${frame(id, svg)}`;
    },
  );
  return { html: out, diagnostics };
}

/** Adds declarations to a start tag's `style`, keeping any the author wrote. */
function withStyle(open: string, declarations: string): string {
  const existing = /\bstyle="([^"]*)"/.exec(open);
  if (existing === null) return `${open.replace(/\s*\/?>$/, "")} style="${declarations}">`;
  return open.replace(existing[0], `style="${declarations};${existing[1]!}"`);
}

/** Adds an attribute to a start tag, leaving one the author already wrote alone. */
function withAttr(open: string, name: string, value: string): string {
  if (new RegExp(`\\b${name}=`).test(open)) return open;
  return `${open.replace(/\s*\/?>$/, "")} ${name}="${value}">`;
}

/**
 * Every page of `article` with its figures inlined. The article is not mutated.
 *
 * `svgFor` is asked for one SVG per figure, not one per theme, because a figure no longer needs a
 * variant per theme: colour is decided by CSS at view time now, so a single rendered geometry
 * serves every theme a reader might pick. The per-theme files a build writes alongside the page
 * remain what they always were — standalone image assets, for anything that wants the figure
 * outside a page.
 */
export function inlineArticleFigures(
  article: RenderedArticle,
  svgFor: (id: string) => FigureSvg | undefined,
): { article: RenderedArticle; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const pages = Object.fromEntries(
    Object.entries(article.pages).map(([key, page]) => {
      const inlined = inlineFigureSvgs(page.html, svgFor, page.path);
      diagnostics.push(...inlined.diagnostics);
      return [key, { ...page, html: inlined.html }];
    }),
  );
  return { article: { ...article, pages }, diagnostics };
}
