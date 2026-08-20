/**
 * Which pages get a card, and what each one is a picture of.
 *
 * This is the half of card generation that has no rasteriser in it at all: the precedence rules
 * (an author's image wins; `og: false` opts out), the palette ladder, the copy, the glyph, and the
 * content hash that names the file. What is left over — turning a {@link CardSpec} into pixels and
 * putting the pixels somewhere — is the only part the two paths do differently.
 *
 * It lives here rather than beside either of them because a build and a browser publish must agree
 * about *every* input to {@link cardCacheKey}. They are not two implementations that happen to
 * match today; they are one function called twice, with the two things that genuinely differ —
 * how you read a file, and what a font digest is — passed in.
 */
import { sha256Hex } from "./bundle.js";
import { cardAltText, resolveOgConfig, type ResolvedOgConfig } from "./og.js";
import { composeCardPalette, type CardPaletteSources } from "./og-palette.js";
import { cardContentFor, cardFileName, cardCacheKey, type CardSpec } from "./og-spec.js";
import type { ArticleConfig, Diagnostic, RenderedArticle } from "./types.js";

/** One card the plan wants, named and hashed but not yet drawn. */
export interface PlannedCardSpec {
  readonly href: string;
  readonly spec: CardSpec;
  /** `twitter:image:alt`, and the glyph's alt inside the card. */
  readonly alt: string;
  /** Where the PNG goes, relative to the site root: `_pagina/og/<slug>.<hash>.png`. */
  readonly rel: string;
  /** The glyph's source text, when the card has one — already read, so nobody reads it twice. */
  readonly glyphSource?: string;
}

/** How the planner reads a file out of the article folder. `undefined` means "there is no such file". */
export type ReadArticleText = (path: string) => Promise<string | undefined>;

export interface PlanCardsOptions {
  readonly article: RenderedArticle;
  readonly config: ArticleConfig;
  /** `client/tokens.css` as the shell ships it, when it ships one. */
  readonly tokensCss?: string;
  /** A digest of the font files the cards are set in, so a font swap invalidates every card. */
  readonly fontDigest: string;
  readonly fontFamily: string;
  /** pagina's own version: the composition is an input too, and it changes between releases. */
  readonly pagina: string;
  readonly readText: ReadArticleText;
}

/** Joins folder-relative path segments, resolving `.` and `..`, with no `node:path` in sight. */
export function joinArticlePath(...parts: readonly string[]): string {
  const out: string[] = [];
  for (const segment of parts.join("/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * Every card this article wants drawn.
 *
 * Deliberately says nothing about what is already on disk or already uploaded: the plan is what the
 * article *is*, and each path compares that against what it happens to have. Keeping the cache
 * decision out of here is what lets a build skip on `existsSync` and a publish skip on the URL the
 * manifest is already carrying, without either of them owning the other's notion of "present".
 */
export async function planCards(o: PlanCardsOptions): Promise<{ readonly planned: PlannedCardSpec[]; readonly diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const planned: PlannedCardSpec[] = [];
  const manifest = o.article.manifest;
  const glyphSources = new Map<string, string>();

  for (const [href, page] of Object.entries(manifest.pages)) {
    const rendered = Object.values(o.article.pages).find((p) => p.href === href);
    const og: ResolvedOgConfig = resolveOgConfig(o.config.og, rendered?.frontMatter.og);
    if (!og.enabled) continue;
    // Someone who drew a card gets their card, and pagina does not spend a rasteriser on a picture
    // it is not going to reference.
    if ((page.cover ?? manifest.article.cover) !== undefined) continue;

    const sources: CardPaletteSources = {
      ...(o.tokensCss === undefined ? {} : { tokensCss: o.tokensCss }),
      ...(o.config.theme === undefined ? {} : { articleTheme: o.config.theme }),
      ...(rendered?.frontMatter.theme === undefined ? {} : { pageTheme: rendered.frontMatter.theme }),
      ...(rendered?.path === undefined ? {} : { pagePath: rendered.path }),
    };
    const { palette, diagnostics: paletteDiagnostics } = await composeCardPalette(og.scheme, sources, async (rel, dir) =>
      o.readText(joinArticlePath(dir, rel)),
    );
    // Reported once per distinct message rather than once per page: a host whose accent is
    // `oklch(…)` does not need that said forty times.
    for (const d of paletteDiagnostics) if (!diagnostics.some((seen) => seen.message === d.message)) diagnostics.push(d);

    const content = cardContentFor(manifest, href, page, o.config.slug);
    const alt = cardAltText({
      title: page.title,
      ...(page.description === undefined ? {} : { description: page.description }),
      siteName: manifest.article.title,
      ...(og.alt === undefined ? {} : { alt: og.alt }),
    });

    let glyph: CardSpec["glyph"] | undefined;
    let glyphSource: string | undefined;
    if (og.glyph !== undefined) {
      const file = joinArticlePath(og.glyph);
      let source = glyphSources.get(file);
      if (source === undefined) {
        source = await o.readText(file);
        if (source !== undefined) glyphSources.set(file, source);
      }
      if (source === undefined) {
        diagnostics.push({
          severity: "warning",
          code: "og-glyph-missing",
          message: `og.glyph names ${og.glyph}, which is not in the article folder — the card is drawn without it.`,
          page: href,
        });
      } else {
        glyphSource = source;
        glyph = { file, alt, time: og.time };
      }
    }

    const spec: CardSpec = {
      page: href,
      content,
      palette,
      template: og.template,
      width: og.width,
      height: og.height,
      slotWidth: og.glyphWidth,
      glyphPosition: og.glyphPosition,
      ...(glyph === undefined ? {} : { glyph }),
    };
    const hash = await sha256Hex(new TextEncoder().encode(cardCacheKey({
      spec,
      ...(glyphSource === undefined ? {} : { glyphSource }),
      fontDigest: o.fontDigest,
      fontFamily: o.fontFamily,
      pagina: o.pagina,
    })));
    planned.push({
      href,
      spec,
      alt,
      rel: cardFileName(href, hash),
      ...(glyphSource === undefined ? {} : { glyphSource }),
    });
  }
  return { planned, diagnostics };
}
