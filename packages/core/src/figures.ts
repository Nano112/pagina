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
/**
 * The container widths a figure is drawn at when the article does not say.
 *
 * A frame shows the widest drawing that is no wider than it is, so a drawing is only ever scaled
 * *up* — a label can end up larger than it was measured at, never smaller, which is what makes the
 * author's type size a floor. The cost of that guarantee is the gap between two widths: a frame
 * just under one of them wears the next one down scaled up by the ratio between them.
 *
 * So the widths are chosen to keep that ratio near 1.5, against the containers pagina actually
 * puts a figure in rather than against a list of handset sizes:
 *
 *   - **960** — a figure that has broken out of the reading measure on a wide page.
 *   - **640** — a full reading column.
 *   - **440** — a column with a table of contents beside it, which is most docs pages.
 *   - **320** — the narrowest container worth drawing for: a 390px phone, less the page's own
 *     padding, leaves a figure about 326px, and a drawing measured at 320 fits it at full size.
 *
 * Three would be cheaper and was tried first; it left 320 covering everything up to 639, so a
 * 576px column — an ordinary desktop docs page — showed the phone drawing at 1.8x, with 22px
 * labels next to 16px prose. The fourth copy costs well under a kilobyte gzipped and removes the
 * whole band.
 */
export const FIGURE_WIDTHS: readonly number[] = [960, 640, 440, 320];

/** One drawing of a figure, measured for containers at least `containerWidth` wide. */
export interface FigureVariant {
  readonly containerWidth: number;
  readonly svg: string;
}

export interface DrawnFigure {
  readonly svg: string;
  readonly needsRuntime?: boolean;
  /**
   * The same figure drawn at several container widths, widest first.
   *
   * A figure's geometry is measured once, at publish time, because SVG cannot wrap text — which is
   * what makes a single drawing wrong on a phone: shrink it and the labels go with it, scroll it
   * and the reader is dragging a diagram sideways to read a sentence. Drawing it more than once
   * answers that at the only moment the text can be measured, and lets the page choose between
   * finished pictures rather than scale one of them.
   *
   * When present and longer than one, every variant is inlined and CSS picks exactly one.
   */
  readonly variants?: readonly FigureVariant[];
}
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
  const widths = new Set<number>();
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
      const variants = typeof drawn === "string" ? undefined : drawn.variants;
      const many = variants !== undefined && variants.length > 1;
      if (many) for (const v of variants) widths.add(v.containerWidth);
      const drawings = many ? variants.map(tagVariant) : [svg];
      // The figure's own `--kg-w`/`--kg-h` stay the widest drawing's, because the two things that
      // read them off the figure — the empty stage's reservation and the mount width — are both
      // about the picture before CSS has picked one, and the widest is the one a wide page keeps.
      const box = VIEW_BOX.exec(svg);
      const size = box === null ? undefined : `--kg-w:${box[1]};--kg-h:${box[2]}`;
      const sized = size === undefined ? open : withStyle(open, size);
      // `data-kg-variants` is how the rest of the page knows this figure answers for its own width:
      // the stylesheet stops applying the single-drawing legibility floor to the live stage, and
      // the client stops pinning the mount to one width. Both would otherwise hold a figure that
      // is now responsive to the widest drawing's geometry.
      const marked = many ? withAttr(sized, "data-kg-variants", String(drawings.length)) : sized;
      return `${marked}${frame(id, drawings.join(""))}`;
    },
  );
  return { html: variantStyle(widths) + out, diagnostics };
}

/**
 * The container queries that pick one variant, for the widths this page actually drew.
 *
 * One `@container` per width, narrowest first, each claiming itself from its own width upward and
 * switching off every wider drawing that follows it in the markup. The variants are inlined widest
 * first, so at any frame width the last rule that matches is the widest drawing that fits, and the
 * narrowest survives untouched below them all — which is the right answer for a container narrower
 * than anything that was drawn.
 *
 * The narrowest width needs no rule of its own: the base rule in `reading.css` already leaves it
 * showing, and a `min-width: 320px` query would only re-state that.
 *
 * `@supports` is not decoration. In a browser without container queries every `@container` block
 * is dropped, so nothing here applies and `reading.css`'s unconditional
 * `:not(:first-of-type) { display: none }` leaves the widest drawing alone — the single figure such
 * a browser has always been shown.
 */
function variantStyle(widths: ReadonlySet<number>): string {
  if (widths.size < 2) return "";
  const ordered = [...widths].sort((a, b) => a - b);
  const rules = ordered
    .map((w, i) => {
      // The narrowest claims every container down to zero: below the smallest drawing there is
      // still a smallest drawing, and showing it is a better answer than showing none.
      const at = i === 0 ? 0 : w;
      return (
        `@container kg-frame (min-width:${at}px){` +
        `.kg-frame>svg[data-kg-variant]{display:none}` +
        `.kg-frame>svg[data-kg-variant="${w}"]{display:block}}`
      );
    })
    .join("");
  return `<style>@supports (container-type:inline-size){${rules}}</style>`;
}

/**
 * Marks one variant's root `<svg>` so the stylesheet can pick it, and stamps its own geometry on it.
 *
 * `data-kg-variant` is the container width the drawing was measured for; the container query in
 * `reading.css` compares the frame's width against it. `--kg-w`/`--kg-h` go on the drawing rather
 * than only on the `<figure>` because each variant has its own size, and the legibility floor is a
 * fraction of *that* drawing's width — read off the figure it would be the widest variant's, and a
 * narrow drawing would be floored to a width it was never measured at.
 */
function tagVariant(variant: FigureVariant): string {
  const open = /^\s*<svg\b[^>]*>/.exec(variant.svg);
  if (open === null) return variant.svg;
  const box = VIEW_BOX.exec(variant.svg);
  const geometry = box === null ? undefined : `--kg-w:${box[1]};--kg-h:${box[2]}`;
  // The root tag already carries a `style` — the theme's palette — so the geometry is merged into
  // it rather than added beside it: two `style` attributes are one attribute and a silent loss.
  const tagged = withAttr(open[0], "data-kg-variant", String(variant.containerWidth));
  const styled = geometry === undefined ? tagged : withStyle(tagged, geometry);
  return styled + variant.svg.slice(open[0].length);
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
