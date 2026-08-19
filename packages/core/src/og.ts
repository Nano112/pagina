/**
 * The social-card contract: what an author writes, and what the builder is handed.
 *
 * A page with no `cover:` used to emit no `og:image`, which means it shared as a bare text link and
 * its Twitter card collapsed from `summary_large_image` to the small imageless `summary`. Most
 * pages have no cover. So pagina draws one, and this file is the surface an author steers that
 * with — kept here, in `@pagina/core`, because both places it is written from (`article.yaml` and a
 * page's front matter) are parsed here, and because a host reading `manifest.json` should be able
 * to see the same fields without depending on the builder.
 *
 * Nothing in this file draws anything. The composition lives in `@pagina/vite`, next to the
 * renderer that needs Node, fonts and a rasteriser; what crosses the boundary is a resolved
 * {@link OgConfig} and nothing else.
 */
import type { Diagnostic } from "./types.js";

/** Which composition a card uses. */
export type OgTemplate = "editorial" | "figure" | "full";

/** Every template, in the order the documentation introduces them. */
export const OG_TEMPLATES: readonly OgTemplate[] = ["editorial", "figure", "full"];

/** Which half of the theme is baked into the picture. See {@link OgConfig.scheme}. */
export type OgScheme = "light" | "dark";

export const OG_SCHEMES: readonly OgScheme[] = ["light", "dark"];

/** Which side of an `editorial` card the glyph slot sits on. */
export type OgGlyphPosition = "left" | "right";

export const OG_GLYPH_POSITIONS: readonly OgGlyphPosition[] = ["left", "right"];

/**
 * A card's configuration, as far along as a parser can take it.
 *
 * Every field is optional at every level: `article.yaml` sets the article's answer, a page's front
 * matter overrides field by field, and {@link resolveOgConfig} is the only place those two are
 * combined. `enabled: false` — written `og: false` — is the opt-out, and it is a field rather than
 * an absence so that a page can switch a card back on for an article that turned them off.
 */
export interface OgConfig {
  readonly enabled?: boolean;
  readonly template?: OgTemplate;
  /**
   * Which half of the resolved theme the card is painted in.
   *
   * A card is a PNG a crawler fetches with no page, no stylesheet and no `prefers-color-scheme`, so
   * unlike a figure it cannot decide this at view time — see `docs/design/2026-08-19-og-cards.md`.
   * Default `"light"`, because that is the scheme a card is composited onto in every timeline that
   * matters and the one a reader who has expressed no preference sees.
   */
  readonly scheme?: OgScheme;
  /** A Kineglyph scene module, relative to the article folder, drawn into the card's slot. */
  readonly glyph?: string;
  /** How wide the slot is on an `editorial` card. Ignored by `figure` and `full`. */
  readonly glyphWidth?: number;
  readonly glyphPosition?: OgGlyphPosition;
  /**
   * Which frame of an animated glyph is drawn: `"end"` (the default), `"start"`, or milliseconds.
   *
   * A card is one picture, so a timeline has to be sampled somewhere, and the last frame is the one
   * that shows the finished state a still image should be showing.
   */
  readonly time?: "start" | "end" | number;
  /** Overrides the alt text derived from the card's own content. */
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}

/** A card configuration with every default filled in — what the builder actually draws from. */
export interface ResolvedOgConfig {
  readonly enabled: boolean;
  readonly template: OgTemplate;
  readonly scheme: OgScheme;
  readonly glyph?: string;
  readonly glyphWidth: number;
  readonly glyphPosition: OgGlyphPosition;
  readonly time: "start" | "end" | number;
  readonly alt?: string;
  readonly width: number;
  readonly height: number;
}

/**
 * 1200×630, the size every consumer of `og:image` is built around.
 *
 * Facebook, LinkedIn and X all crop to roughly 1.91:1, and a card drawn at another ratio is
 * cropped by each of them differently. It is configurable because a host may have a reason; it has
 * one default because having one is what makes the cards look like a set.
 */
export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

/** How wide the slot is on an `editorial` card when nothing says otherwise. */
export const OG_SLOT_WIDTH = 392;

/** The card configuration for an article and page that both said nothing. */
export const DEFAULT_OG_CONFIG: ResolvedOgConfig = {
  enabled: true,
  template: "editorial",
  scheme: "light",
  glyphWidth: OG_SLOT_WIDTH,
  glyphPosition: "right",
  time: "end",
  width: OG_CARD_WIDTH,
  height: OG_CARD_HEIGHT,
};

/**
 * The article's answer overlaid with the page's, field by field.
 *
 * The same precedence `cover` and `theme` already have, and for the same reason: an article-wide
 * decision that a page can nudge without restating. A page that only writes `glyph:` keeps the
 * article's template, scheme and dimensions.
 */
export function resolveOgConfig(article?: OgConfig, page?: OgConfig): ResolvedOgConfig {
  const merged: OgConfig = { ...article, ...page };
  const glyph = merged.glyph;
  return {
    ...DEFAULT_OG_CONFIG,
    ...(merged.enabled === undefined ? {} : { enabled: merged.enabled }),
    ...(merged.template === undefined ? {} : { template: merged.template }),
    ...(merged.scheme === undefined ? {} : { scheme: merged.scheme }),
    ...(glyph === undefined ? {} : { glyph }),
    ...(merged.glyphWidth === undefined ? {} : { glyphWidth: merged.glyphWidth }),
    ...(merged.glyphPosition === undefined ? {} : { glyphPosition: merged.glyphPosition }),
    ...(merged.time === undefined ? {} : { time: merged.time }),
    ...(merged.alt === undefined ? {} : { alt: merged.alt }),
    ...(merged.width === undefined ? {} : { width: merged.width }),
    ...(merged.height === undefined ? {} : { height: merged.height }),
  };
}

/** Largest card pagina will draw, per side. A 4000px social card is a mistake, not a request. */
const MAX_CARD_SIDE = 2400;
const MIN_CARD_SIDE = 200;

/**
 * Reads an `og:` block from `article.yaml` or from a page's front matter.
 *
 * `og: false` is the opt-out and parses to `{ enabled: false }`; `og: true` turns cards back on for
 * a page inside an article that switched them off. Anything wrong with a key is a **diagnostic and
 * a dropped field**, never a throw: a mistyped `glyph_position` should cost a page its slot side,
 * not a site its build. That is the same call {@link parseFrontMatter} makes, applied here so that
 * `article.yaml` and front matter agree — which matters because they are the same block.
 */
export function parseOgConfig(value: unknown, where: string): { readonly og?: OgConfig; readonly diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const bad = (message: string): void => {
    diagnostics.push({ severity: "warning", code: "og-invalid", message: `${where}: ${message}` });
  };
  if (value === undefined || value === null) return { diagnostics };
  if (typeof value === "boolean") return { og: { enabled: value }, diagnostics };
  if (typeof value !== "object" || Array.isArray(value)) {
    bad("og must be a mapping, or `false` to opt out");
    return { diagnostics };
  }
  const o = value as Record<string, unknown>;
  const og: Record<string, unknown> = {};

  const oneOf = <T extends string>(key: string, field: string, allowed: readonly T[]): void => {
    const v = o[key];
    if (v === undefined || v === null) return;
    if (typeof v !== "string" || !allowed.includes(v as T)) { bad(`og.${key} must be ${allowed.join("|")}`); return; }
    og[field] = v;
  };
  const size = (key: string, field: string): void => {
    const v = o[key];
    if (v === undefined || v === null) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_CARD_SIDE || v > MAX_CARD_SIDE) {
      bad(`og.${key} must be a number of pixels between ${MIN_CARD_SIDE} and ${MAX_CARD_SIDE}`);
      return;
    }
    og[field] = Math.round(v);
  };
  const text = (key: string, field: string): void => {
    const v = o[key];
    if (v === undefined || v === null) return;
    if (typeof v !== "string" || v === "") { bad(`og.${key} must be a non-empty string`); return; }
    og[field] = v;
  };

  if (o["enabled"] !== undefined && o["enabled"] !== null) {
    if (typeof o["enabled"] !== "boolean") bad("og.enabled must be true or false");
    else og["enabled"] = o["enabled"];
  }
  oneOf("template", "template", OG_TEMPLATES);
  oneOf("scheme", "scheme", OG_SCHEMES);
  oneOf("glyph_position", "glyphPosition", OG_GLYPH_POSITIONS);
  text("glyph", "glyph");
  text("alt", "alt");
  size("width", "width");
  size("height", "height");
  // The slot is measured against the card rather than the screen, so its bounds are the card's.
  if (o["glyph_width"] !== undefined && o["glyph_width"] !== null) {
    const v = o["glyph_width"];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_CARD_SIDE) bad(`og.glyph_width must be a positive number of pixels up to ${MAX_CARD_SIDE}`);
    else og["glyphWidth"] = Math.round(v);
  }
  if (o["time"] !== undefined && o["time"] !== null) {
    const v = o["time"];
    if (v === "start" || v === "end") og["time"] = v;
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0) og["time"] = v;
    else bad("og.time must be start|end or a number of milliseconds");
  }
  return { og: og as OgConfig, diagnostics };
}

/** Longest a card's title may be before the composition truncates it on a word boundary. */
export const OG_TITLE_BUDGET = 110;
/** Longest a card's description may be. Two lines at the card's body size, near enough. */
export const OG_DESCRIPTION_BUDGET = 130;

/**
 * `text` cut to `budget` characters on a word boundary, with an ellipsis.
 *
 * The renderer will truncate an overlong line by itself, but it does so mid-word — `bringing a
 * desig…` — because it is counting pixels and knows nothing about words. Doing it here first means
 * the ellipsis lands where a reader would have put it.
 */
export function clampWords(text: string, budget: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= budget) return clean;
  const cut = clean.slice(0, budget);
  const space = cut.lastIndexOf(" ");
  return `${(space > budget * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, "")}…`;
}

/**
 * What `twitter:image:alt` says when the author has not written one.
 *
 * A picture of a title and a description is described by that title and that description; there is
 * nothing else in it. Naming it as a card is the part a screen reader cannot infer — without it the
 * alt text reads as though the page had an illustration.
 */
export function cardAltText(o: { readonly title: string; readonly description?: string; readonly siteName?: string; readonly alt?: string }): string {
  if (o.alt !== undefined && o.alt !== "") return o.alt;
  const lede = o.description === undefined || o.description === "" ? "" : ` — ${clampWords(o.description, OG_DESCRIPTION_BUDGET)}`;
  const site = o.siteName === undefined || o.siteName === "" ? "" : ` from ${o.siteName}`;
  return `Card${site}: ${clampWords(o.title, OG_TITLE_BUDGET)}${lede}`;
}
