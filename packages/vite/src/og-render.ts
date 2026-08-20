/**
 * Turning one {@link CardJob} into one PNG.
 *
 * Everything reproducible about a card is decided here. Fonts are explicit files with the machine's
 * own switched off (`loadSystemFonts: false`), because a card built in CI and a card built on a
 * laptop have to be the same bytes — and a system font makes that untrue in a way that only shows
 * up months later, as a card nobody can reproduce. The same font files do double duty: HarfBuzz
 * shapes with them to decide where the lines break, and resvg draws with them, so layout and pixels
 * come from one set of outlines rather than two guesses at the same face.
 *
 * The glyph takes a detour that is worth naming. It is rendered to a **PNG** and embedded, rather
 * than spliced in as SVG, because a Kineglyph drawing paints through `var(--kg-color-*)` and those
 * references are resolved by the export package's own raster pass — a pass that runs on the
 * document it is given and cannot reach inside a nested `<image>`. An SVG glyph therefore rasters
 * as a black rectangle. Two rasters cost a few milliseconds and buy a slot that renders.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { exportPng, createEmbeddedFontMeasurer, rewriteImports, type EmbeddedFontMeasurer } from "@kineglyph/export";
import { resolveFigure, resolveScene, seekTimeline } from "@kineglyph/core";
import { FIGURE_BAND, cardScene, glyphTheme, sha256Hex, type CardSpec } from "@pagina/core";
import { resolveKineglyphBundle } from "./kineglyph.js";

/** The font files a card is set in: one variable family, shipped with this package. */
export const CARD_FONT_FILES: readonly string[] = [
  new URL("../fonts/InstrumentSans-VF.ttf", import.meta.url).pathname,
];

/**
 * One card for *this* rasteriser to draw: the shared {@link CardSpec}, plus where the PNG goes.
 *
 * The spec is `@pagina/core`'s and the destination is this file's, which is the whole shape of the
 * split. A browser publishing the same card builds the same spec and hands it somewhere else.
 * Serialisable, because it crosses a process boundary; `glyph.file` is an absolute path here.
 */
export interface CardJob extends CardSpec {
  /** Absolute path to write the PNG to. */
  readonly out: string;
}

/**
 * The fonts, loaded once per process.
 *
 * HarfBuzz face loading is the expensive part of drawing a card, and it is the same work for every
 * card in a build.
 */
let fontsOnce: Promise<EmbeddedFontMeasurer> | undefined;
export function cardFonts(): Promise<EmbeddedFontMeasurer> {
  fontsOnce ??= createEmbeddedFontMeasurer(CARD_FONT_FILES.map((file) => ({ file, fallback: true })));
  return fontsOnce;
}

/** A digest of the font files themselves, so a font swap invalidates every cached card. */
let fontDigestOnce: Promise<string> | undefined;
export function cardFontDigest(): Promise<string> {
  fontDigestOnce ??= (async () => {
    const parts = await Promise.all(CARD_FONT_FILES.map((f) => readFile(f)));
    return sha256Hex(Buffer.concat(parts));
  })();
  return fontDigestOnce;
}

/**
 * How much bigger than its slot a glyph is rasterised.
 *
 * The glyph is drawn to pixels and then composited into the card, so it is resampled once. At 1×
 * that resampling is visible on hairlines and small labels — the two things a diagram is made of.
 */
const GLYPH_OVERSAMPLE = 2;

/**
 * Evaluates a scene module and draws one frame of it as a PNG data URI.
 *
 * The import rewriting is the same technique `prerender` uses and `loadThemeModule` copies: a bare
 * `kineglyph` becomes the runtime bundle's URL and relative specifiers resolve against the module's
 * own location, then the rewritten source is evaluated as a data URL. It is spelt out again here
 * rather than delegated to `prerender`, because a card needs the one thing `prerender` does not
 * offer: which frame of a timeline to stop on.
 */
async function renderGlyph(
  job: CardJob,
  box: { readonly width: number; readonly height: number },
  fonts: EmbeddedFontMeasurer,
): Promise<string> {
  const glyph = job.glyph!;
  const source = await readFile(glyph.file, "utf8");
  const baseUrl = pathToFileURL(glyph.file).href;
  const runtime = pathToFileURL(resolveKineglyphBundle("import")).href;
  const rewritten = rewriteImports(source, (specifier) => {
    if (specifier === "kineglyph") return runtime;
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) return new URL(specifier, baseUrl).href;
    return specifier;
  });
  const mod = (await import(`data:text/javascript;base64,${Buffer.from(rewritten, "utf8").toString("base64")}`)) as { default?: unknown };
  if (mod.default === null || typeof mod.default !== "object")
    throw new Error(`${glyph.file} must default-export a Kineglyph scene definition`);
  const theme = glyphTheme(job.palette, job.palette.raised);
  const scene = resolveFigure(mod.default as Parameters<typeof resolveFigure>[0], { width: box.width, theme, textMeasurer: fonts });
  const errors = (scene.diagnostics ?? []).filter((d) => d.severity === "error");
  if (errors.length > 0) throw new Error(`${glyph.file}: ${errors.map((d) => `${d.code}: ${d.message}`).join("; ")}`);
  const duration = scene.timeline?.duration ?? 0;
  const at = glyph.time === "end" ? duration : glyph.time === "start" ? 0 : Math.min(glyph.time, duration);
  const frame = seekTimeline(scene, at);
  const png = await exportPng(frame, {
    scale: GLYPH_OVERSAMPLE,
    // The slot already paints the ground the glyph sits on, and a second opaque rectangle over it
    // would be a rectangle with a visible edge rather than an illustration on a panel.
    background: "transparent",
    idPrefix: "og-glyph",
    fonts: { files: [...fonts.files], loadSystemFonts: false },
  });
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

/** Draws one card. Throws with a message naming the page when anything in it cannot be drawn. */
export async function renderCard(job: CardJob): Promise<Uint8Array> {
  const fonts = await cardFonts();
  let glyph: { dataUri: string; alt: string } | undefined;
  if (job.glyph !== undefined) {
    const box = job.template === "editorial"
      ? { width: job.slotWidth, height: job.height }
      : { width: job.width, height: job.template === "full" ? job.height : Math.round(job.height * FIGURE_BAND) };
    glyph = { dataUri: await renderGlyph(job, box, fonts), alt: job.glyph.alt };
  }
  const { scene, theme } = cardScene({
    content: job.content,
    palette: job.palette,
    template: job.template,
    width: job.width,
    height: job.height,
    slotWidth: job.slotWidth,
    glyphPosition: job.glyphPosition,
    ...(glyph === undefined ? {} : { glyph }),
  });
  const resolved = resolveScene(scene, { width: job.width, theme, textMeasurer: fonts, layout: "wide" });
  const errors = (resolved.diagnostics ?? []).filter((d) => d.severity === "error");
  if (errors.length > 0) throw new Error(`card for ${job.page}: ${errors.map((d) => `${d.code}: ${d.message}`).join("; ")}`);
  return exportPng(resolved, {
    width: job.width,
    height: job.height,
    fonts: { files: [...fonts.files], loadSystemFonts: false },
  });
}
