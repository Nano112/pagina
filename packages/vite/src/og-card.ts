/**
 * The card, as a picture: type, palette, and the slot the illustration goes in.
 *
 * pagina composes; Kineglyph draws. That division is the whole point — a card is editorial and a
 * diagram is data — and it is expressed here by building the card as a Kineglyph *scene* whose
 * typography pagina owns, with one node reserved for whatever fills the slot. A glyph, a procedural
 * mark, or (for `template: "full"`) the entire canvas: one composition function, three uses.
 *
 * ## What survives being 300 pixels wide
 *
 * A card is drawn at 1200×630 and read at a quarter of that, in a timeline, next to nine others. At
 * that size the eyebrow is 5px and the footer is 5px: they are texture, not text, and treating them
 * as text is the mistake that produces a card of six evenly-sized grey lines. Three things carry at
 * 300px — the ground colour, the coloured slot, and the title — so the title is set as large as it
 * can be for its length (see {@link titleSize}) and everything else is allowed to be small.
 *
 * ## Why the type scale is in pixels
 *
 * Kineglyph's `lineHeight` token is a pixel advance, not a multiplier. Passing `1.1` there does not
 * make a tight card; it makes every wrapped line land on top of the last one.
 */
import {
  createTheme, defaultTheme, figure, linearGradient, withAlpha, withFontFamily,
  type SceneDefinition, type ThemeOverride, type ThemeTokens,
} from "@kineglyph/core";
import { OG_CARD_HEIGHT, OG_CARD_WIDTH, OG_DESCRIPTION_BUDGET, OG_TITLE_BUDGET, clampWords, type OgGlyphPosition, type OgTemplate } from "@pagina/core";
import type { CardPalette } from "./og-theme.js";

/** The one family a card is set in, shipped with the package. See `fonts/OFL.txt`. */
export const CARD_FONT_FAMILY = "Instrument Sans";

/** What a card is drawn from, after the config, the manifest and the theme have all been read. */
export interface CardContent {
  /** The page title — the one thing that has to survive being small. */
  readonly title: string;
  readonly description?: string;
  /** The article title, set as the eyebrow: whose documentation this is. */
  readonly siteName?: string;
  /** The line under the rule: category and reading time, already assembled. */
  readonly footer?: string;
  /** Seeds the procedural mark. The page's href, so one page always draws the same card. */
  readonly slug: string;
}

export interface CardComposition {
  readonly content: CardContent;
  readonly palette: CardPalette;
  readonly template: OgTemplate;
  readonly width: number;
  readonly height: number;
  readonly slotWidth: number;
  readonly glyphPosition: OgGlyphPosition;
  /** A `data:image/png;base64,…` glyph, already rendered, or nothing for the procedural mark. */
  readonly glyph?: { readonly dataUri: string; readonly alt: string };
}

/* ---------------------------------------------------------------------------------------------
 * Type
 * ------------------------------------------------------------------------------------------- */

const face = (size: number, weight: number, lineHeight: number, letterSpacing = 0): ThemeTokens["typography"]["body"] =>
  ({ family: CARD_FONT_FAMILY, size, weight, lineHeight, letterSpacing });

/**
 * How big the title is set, from how long it is.
 *
 * A one-word title at the size a fifteen-word title needs looks like a mistake — the card is mostly
 * empty and the word is lost in it — so the scale is chosen for the string rather than fixed. The
 * steps are wide because the alternative, a continuous fit, makes every card a slightly different
 * size and the set stops looking like a set.
 */
export function titleSize(title: string, scale = 1): number {
  const n = title.length;
  const size = n <= 18 ? 86 : n <= 40 ? 70 : n <= 70 ? 60 : 52;
  return Math.round(size * scale);
}

/**
 * The card's palette as Kineglyph colour roles.
 *
 * Every role is asserted (`declareColors: "all"`): a card has no page to inherit from, which is the
 * whole decision recorded in `og-theme.ts`. Left unasserted, Kineglyph emits `var(--kg-color-*)`
 * references that a raster renderer resolves to nothing, and the card comes out black.
 */
function cardColors(palette: CardPalette, canvas?: string): ThemeOverride {
  return {
    declareColors: "all",
    colors: {
      canvas: canvas ?? palette.bg,
      surface: palette.raised,
      surfaceRaised: palette.raised,
      surfaceMuted: palette.sunken,
      border: palette.line,
      text: palette.fg,
      textMuted: palette.muted,
      accent: palette.accent,
      accentContrast: palette.accentFg,
      connector: palette.muted,
      // The mark's three translucencies. Kineglyph paints take a colour, not a colour and an
      // alpha, and a *node* opacity is not usable here: an isolated group whose geometry misses
      // the canvas is the one input that makes resvg abort rather than throw. So the alpha is
      // mixed into the colour, and the marks stay ordinary opaque strokes.
      chart1: withAlpha(palette.accentFg, 0.62),
      chart2: withAlpha(palette.accentFg, 0.36),
      chart3: withAlpha(palette.accentFg, 0.19),
    },
  };
}

/**
 * The theme a **glyph** is drawn with: the card's colours, Kineglyph's own type scale, the card's
 * font.
 *
 * Colours, because a slot illustration in Kineglyph's default palette next to a card in the
 * article's would be two designs sharing a rectangle. `canvas` is the slot's ground rather than the
 * page's, so the drawing sits on the panel instead of on its own rectangle inside it.
 *
 * But *not* the card's type scale, which is the mistake that produced a diagram whose labels were
 * set at the card's 25px body and burst out of every box they were measured for. A diagram's
 * typography belongs to the diagram. Only the family is imposed, because the family has to be one
 * of the files embedded in the export — including the monospace slot, since pagina ships one face
 * and a code run drawn in a font nobody loaded is drawn in nothing.
 */
export function glyphTheme(palette: CardPalette, canvas?: string): ThemeTokens {
  return withFontFamily(createTheme(cardColors(palette, canvas), defaultTheme), CARD_FONT_FAMILY, CARD_FONT_FAMILY);
}

/** The Kineglyph theme a card is painted with — literal colours, and pagina's own type scale. */
export function cardTheme(palette: CardPalette, title: string, scale: number): ThemeTokens {
  const display = titleSize(title, scale);
  const px = (n: number): number => Math.round(n * scale);
  return createTheme({
    ...cardColors(palette),
    typography: {
      display: face(display, 700, Math.round(display * 1.08), -Math.round(display * 0.26) / 10),
      // The `figure` template's title strip: big enough to read small, small enough that the
      // drawing above it stays the subject.
      title: face(px(40), 700, px(46), -0.8),
      body: face(px(25), 400, px(35)),
      caption: face(px(19), 600, px(24), px(2.8)),
      label: face(px(20), 500, px(26)),
    },
    ornament: { grid: "none", surface: "flat", eyebrow: true },
  }, defaultTheme);
}

/* ---------------------------------------------------------------------------------------------
 * The procedural mark
 * ------------------------------------------------------------------------------------------- */

/** FNV-1a over the slug. Small, stable, and the same in every language anyone reimplements this in. */
export function slugSeed(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift32. Deterministic, seeded, and not a source of anything that needs to be unguessable. */
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

/** The parameters of one page's mark. Pure, exported, and the thing the stability test pins. */
export interface ProceduralMark {
  /** Gradient angle of the panel, in degrees. */
  readonly angle: number;
  /** Where the rings are centred, as a fraction of the panel. */
  readonly center: readonly [number, number];
  /** Ring radii, as a fraction of the panel's width. */
  readonly radii: readonly number[];
  /** Which ring is drawn heavy. The one deliberate accent in an otherwise even set. */
  readonly emphasis: number;
  /** Whether the innermost ring is filled. Two marks that differ only in radius look identical. */
  readonly disc: boolean;
}

/**
 * The mark for a slug: a gradient field in the article's accent, and a set of rings on it.
 *
 * It has to look like a decision rather than a placeholder, which rules out the two obvious
 * answers. An identicon grid reads as "we did not know who you were"; a redacted-paragraph
 * skeleton reads as "this has not finished loading". Rings on a colour field read as artwork,
 * they survive being cropped by every consumer's slightly different aspect ratio, and at 300px
 * wide the whole thing resolves to a confident band of colour — which is all a card can ask for
 * at 300px, and more than a grey rectangle gives.
 *
 * Every ring is centred inside the panel with a radius under two thirds of its width, so the
 * geometry always intersects the panel it is clipped to. That is not a nicety: a clipped group
 * whose contents miss the clip entirely makes resvg abort the process rather than raise an error.
 */
export function proceduralMark(slug: string): ProceduralMark {
  const r = rng(slugSeed(slug));
  // A full turn, quantised to 15°, so two cards next to each other are visibly lit from different
  // directions rather than from two angles nobody could tell apart.
  const angle = Math.floor(r() * 24) * 15;
  const center: readonly [number, number] = [
    Number((0.20 + r() * 0.60).toFixed(4)),
    Number((0.22 + r() * 0.56).toFixed(4)),
  ];
  const count = 4 + Math.floor(r() * 4);
  const base = 0.09 + r() * 0.17;
  // Two characters of mark, chosen by the seed: a few wide rings, or a tight nest of them. One
  // spread produced ten cards that were the same picture, which is the failure this exists for.
  const outer = base + (0.26 + r() * 0.42);
  const step = (outer - base) / count;
  const radii = Array.from({ length: count }, (_, i) => Number((base + i * step).toFixed(4)));
  return { angle, center, radii, emphasis: Math.floor(r() * count), disc: r() > 0.35 };
}

/* ---------------------------------------------------------------------------------------------
 * The composition
 * ------------------------------------------------------------------------------------------- */

/**
 * Ratio of the card's height that the glyph band takes on a `figure` card.
 *
 * Exported because the glyph is *resolved* for that box before the composition places it: two
 * numbers for one band is a drawing measured for a box it does not go in.
 */
export const FIGURE_BAND = 0.62;

/**
 * The card as a scene definition, ready to resolve and rasterise.
 *
 * `template: "full"` hands the whole canvas to the slot, which is the design's "full-scene card" —
 * the same mechanism with the slot grown to the edges, rather than a second code path.
 */
export function cardScene(c: CardComposition): { readonly scene: SceneDefinition; readonly theme: ThemeTokens } {
  const { width, height, palette } = c;
  // Everything below is measured for a 1200×630 card. A card asked for at another size is the same
  // composition scaled, rather than a different one — the alternative is a second set of numbers
  // that is only ever exercised by whoever asked for the other size.
  const scale = Math.min(width / OG_CARD_WIDTH, height / OG_CARD_HEIGHT);
  const px = (n: number): number => Math.round(n * scale);
  const title = clampWords(c.content.title, OG_TITLE_BUDGET);
  const description = c.content.description === undefined ? undefined : clampWords(c.content.description, OG_DESCRIPTION_BUDGET);
  const theme = cardTheme(palette, title, scale);
  const full = c.template === "full";
  const band = c.template === "figure" ? Math.round(height * FIGURE_BAND) : height;
  const spineWidth = full ? 0 : px(10);
  const slotWidth = full ? width : c.template === "figure" ? width - spineWidth : Math.min(c.slotWidth, width - px(320));
  const slotHeight = full ? height : band;

  const scene = figure(
    "og-card",
    {
      title: c.content.title,
      ...(description === undefined ? {} : { description }),
      padding: 0,
      background: "canvas",
      // The card is one fixed size, so it is always the wide layout: a scene that decided to become
      // a column because 392 is a narrow container would be a different picture than the one this
      // composition describes.
      breakpoints: { wide: 1, compact: 1 },
    },
    (f) => {
      /** The slot: a glyph on the card's own ground, or the procedural field. */
      const slot = (): ReturnType<typeof f.stack> => {
        if (c.glyph !== undefined) {
          return f.stack(
            [f.image(c.glyph.dataUri, c.glyph.alt, {
              id: "glyph",
              fit: "contain",
              width: slotWidth - px(full ? 96 : 64),
              height: slotHeight - px(full ? 96 : 56),
            })],
            { id: "slot", width: slotWidth, height: slotHeight, padding: [px(full ? 48 : 28), px(full ? 48 : 32)], align: "center", justify: "center", frame: { radius: 0, fill: "surface" } },
          );
        }
        const mark = proceduralMark(c.content.slug);
        const rings = mark.radii.map((radius, i) => f.circle({
          id: `ring-${i}`,
          radius: radius * slotWidth,
          fill: "none",
          stroke: i === mark.emphasis ? "chart1" : i % 2 === 0 ? "chart2" : "chart3",
          strokeWidth: i === mark.emphasis ? px(9) : Math.max(1, px(2.5)),
          position: { x: mark.center[0], y: mark.center[1] },
        }));
        return f.coordinates(
          [
            ...(mark.disc
              ? [f.circle({ id: "disc", radius: mark.radii[0]! * slotWidth * 0.86, fill: "chart3", stroke: "none", position: { x: mark.center[0], y: mark.center[1] } })]
              : []),
            ...rings,
          ],
          {
            id: "slot", width: slotWidth, height: slotHeight, clip: true, allowOverflow: true,
            frame: {
              radius: 0,
              // Both stops are the accent, a third of a step apart: enough that the panel has a
              // direction and not so much that it fades to a pastel and stops carrying at 300px.
              fill: linearGradient(
                [{ at: 0, color: "accent", opacity: 1 }, { at: 1, color: "accent", opacity: 0.68 }],
                { angle: mark.angle },
              ),
            },
          },
        );
      };

      if (full) { f.root(f.overlay([slot()], { id: "root", width, height })); return; }

      const eyebrow = f.text(c.content.siteName ?? "", {
        id: "eyebrow", textStyle: "caption", tone: "accent", transform: "uppercase", width: "fill", maxLines: 1,
      });
      // Every node a figure builds has to end up under the root, so each branch builds only what it
      // uses. A node left over from the other template is a build error, not a stray rectangle.
      if (c.template === "figure") {
        // Glyph-led: the illustration takes the top two thirds and the type is a strip under it.
        // Same slot, same palette, same eyebrow; what changes is which of the two is the subject.
        f.root(f.row([
          f.rect({ id: "spine", width: spineWidth, height, fill: "accent" }),
          f.stack([
          slot(),
          f.row([
            f.stack([
              eyebrow,
              f.text(title, { id: "title-strip", textStyle: "title", tone: "text", wrap: true, maxLines: 2, width: "fill" }),
            ], { id: "strip-copy", gap: px(10), grow: 1 }),
            f.text(c.content.footer ?? "", { id: "footer", textStyle: "label", tone: "textMuted", maxLines: 1, align: "end" }),
          ], {
            id: "strip", gap: px(32), width: slotWidth, height: height - band, padding: [px(26), px(48)], justify: "between", align: "center",
          }),
        ], { id: "figure-body", gap: 0, width: slotWidth, height, align: "stretch" }),
        ], { id: "root", gap: 0, width, height, align: "stretch", justify: "start" }));
        return;
      }

      const lede = f.stack([
        f.text(title, { id: "title", textStyle: "display", tone: "text", wrap: true, maxLines: 3, width: "fill" }),
        ...(description === undefined ? [] : [f.text(description, { id: "desc", textStyle: "body", tone: "textMuted", wrap: true, maxLines: 2, width: "fill" })]),
      ], { id: "lede", gap: px(22), width: "fill" });
      const foot = f.stack([
        f.rect({ id: "rule", height: px(3), width: px(72), fill: "accent" }),
        f.text(c.content.footer ?? "", { id: "footer", textStyle: "label", tone: "textMuted", width: "fill", maxLines: 1 }),
      ], { id: "foot", gap: px(18), width: "fill" });

      // `editorial`: the type is the subject and the slot is a band beside it.
      const copy = f.stack([eyebrow, lede, foot], {
        id: "copy", gap: px(40), padding: [px(56), px(60)], grow: 1, height, align: "start", justify: "between",
      });
      const spine = f.rect({ id: "spine", width: spineWidth, height, fill: "accent" });
      f.root(f.row(
        c.glyphPosition === "left" ? [slot(), copy, spine] : [spine, copy, slot()],
        { id: "root", gap: 0, width, height, align: "stretch", justify: "start" },
      ));
    },
  );
  return { scene, theme };
}
