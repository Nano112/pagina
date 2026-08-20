/**
 * What a card *is*, before anybody decides how to turn it into pixels.
 *
 * A {@link CardSpec} is the whole of one card as data: the copy, the baked palette, the template,
 * the box, and the glyph named by its bytes. It is deliberately serialisable — the build ships it
 * down a pipe to a child process, and the editor holds it in a page — and deliberately free of any
 * notion of *where* the PNG goes, because the two paths disagree about that and agree about
 * everything else.
 *
 * The rest of this file is the small set of decisions that must be identical on both paths or the
 * caching silently stops working:
 *
 *   - {@link cardCacheKey}, so a card redrawn by a build and a card redrawn by a publish are
 *     redrawn for the same reasons.
 *   - {@link cardSlug} and {@link cardFileName}, so both write the same name for the same page, and
 *     a publish therefore *overwrites* the build's card rather than leaving two of them behind
 *     under different hashes.
 *
 * Getting either of those to be nearly-the-same is worse than not sharing them at all: a key that
 * differs by a field means every publish redraws every card, and a name that differs means the
 * bucket fills up with orphans nobody ever deletes.
 */
import type { Manifest, PageMeta } from "./types.js";
import type { CardPalette } from "./og-palette.js";
import type { OgGlyphPosition, OgTemplate } from "./og.js";

/** Where cards are written, under the output root. Beside the other things the build emits. */
export const OG_CARD_DIR = "_pagina/og";

/** Hex characters of the cache key that go in the file name — the same 32 bits the assets use. */
export const CARD_HASH_CHARS = 8;

/** A name a card takes, so a rebuild in place can clear the ones it no longer wants. */
export const CARD_FILE_RE = /^[a-z0-9-]+\.[0-9a-f]{8}\.png$/;

/** The glyph a card carries, as the spec knows it: which scene, what it is called, which frame. */
export interface CardGlyphSpec {
  /** How the scene module is named — an absolute path in a build, a folder-relative path in a publish. */
  readonly file: string;
  readonly alt: string;
  readonly time: "start" | "end" | number;
}

/** One card to draw, fully resolved, minus wherever the bytes are going to land. */
export interface CardSpec {
  /** The page this card belongs to, for diagnostics. */
  readonly page: string;
  readonly content: CardContentSpec;
  readonly palette: CardPalette;
  readonly template: OgTemplate;
  readonly width: number;
  readonly height: number;
  readonly slotWidth: number;
  readonly glyphPosition: OgGlyphPosition;
  readonly glyph?: CardGlyphSpec;
}

/** The copy on a card. Mirrors `CardContent` in `og-card.ts`, which is what draws it. */
export interface CardContentSpec {
  readonly title: string;
  readonly description?: string;
  readonly siteName?: string;
  readonly footer?: string;
  readonly slug: string;
}

/**
 * A page's href as a file name: `/` → `index`, `/guide/nested/` → `guide-nested`.
 *
 * Flat, because `_pagina/og/` is a bucket of pictures rather than a second copy of the site tree,
 * and readable, because the one time anybody looks in this directory they are looking for one card.
 */
export function cardSlug(href: string): string {
  const trimmed = href.replace(/^\/+|\/+$/g, "");
  const name = trimmed === "" ? "index" : trimmed.replace(/[^a-zA-Z0-9]+/g, "-");
  return name.replace(/^-+|-+$/g, "").toLowerCase() || "index";
}

/** `_pagina/og/guide-nested.a1b2c3d4.png` — the path a card takes, relative to the site root. */
export function cardFileName(href: string, hash: string): string {
  return `${OG_CARD_DIR}/${cardSlug(href)}.${hash.slice(0, CARD_HASH_CHARS)}.png`;
}

/**
 * Everything that can change the picture, in one string.
 *
 * Every field of it is something a reader would see change. What is deliberately *not* in it: the
 * page's href beyond the slug that already seeds the mark, the build's base URL, and the time. A
 * key that moves when nothing visible moved is a cache that never hits.
 *
 * Nor is the *rasteriser* in it, and that is the load-bearing omission. Node and the browser draw
 * the same composition to within a wrapped line, and keying on which of them drew it would mean
 * every publish redrew every card the build had just written, and every build redrew every card the
 * author had just published — the two paths sawing at each other forever. A card is keyed on what
 * it is a picture *of*.
 */
export function cardCacheKey(o: {
  readonly spec: CardSpec;
  readonly glyphSource?: string;
  readonly fontDigest: string;
  readonly fontFamily: string;
  /** pagina's own version: the composition is an input too, and it changes between releases. */
  readonly pagina: string;
}): string {
  return JSON.stringify({
    v: 1,
    pagina: o.pagina,
    content: o.spec.content,
    palette: o.spec.palette,
    template: o.spec.template,
    width: o.spec.width,
    height: o.spec.height,
    slotWidth: o.spec.slotWidth,
    glyphPosition: o.spec.glyphPosition,
    // The glyph by its *bytes*: a scene edited in place must redraw the card that shows it.
    glyph: o.spec.glyph === undefined ? null : { source: o.glyphSource ?? "", time: o.spec.glyph.time, alt: o.spec.glyph.alt },
    font: { digest: o.fontDigest, family: o.fontFamily },
  });
}

/** A drawn card, as the manifest carries it. */
export interface DrawnCard {
  readonly url: string;
  readonly alt: string;
}

/** The manifest again, with each page carrying the card drawn for it. */
export function withOgCards(manifest: Manifest, cards: ReadonlyMap<string, DrawnCard>): Manifest {
  if (cards.size === 0) return manifest;
  const pages: Record<string, PageMeta> = {};
  for (const [href, page] of Object.entries(manifest.pages)) {
    const card = cards.get(href);
    pages[href] = card === undefined ? page : { ...page, card: card.url, cardAlt: card.alt };
  }
  return { ...manifest, pages };
}

/** The footer line: what kind of article this is, and how long the page takes to read. */
export function cardFooterLine(article: Manifest["article"], page: PageMeta): string {
  const parts: string[] = [];
  if (article.category !== undefined && article.category !== "") parts.push(article.category);
  if (page.readingMinutes !== undefined) parts.push(`${page.readingMinutes} min read`);
  return parts.join(" \u00b7 ");
}

/**
 * The copy on one page's card.
 *
 * Shared rather than written out at each call site because it feeds {@link cardCacheKey}: a build
 * and a publish that worded the footer differently would disagree about every hash, and each would
 * spend its life redrawing what the other had just drawn.
 */
export function cardContentFor(manifest: Manifest, href: string, page: PageMeta, articleSlug: string): CardContentSpec {
  return {
    title: page.title,
    ...(page.description === undefined ? {} : { description: page.description }),
    siteName: manifest.article.title,
    footer: cardFooterLine(manifest.article, page),
    slug: `${articleSlug}${href}`,
  };
}
