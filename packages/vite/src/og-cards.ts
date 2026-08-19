/**
 * Social cards, from the manifest to files on disk and back into the manifest.
 *
 * Three things happen here and they are worth telling apart.
 *
 * **Planning.** For every page, the article's `og:` and the page's are merged, the palette is baked
 * (`og-theme.ts`), and the whole lot is hashed. The hash goes in the file name, so a card is
 * content-addressed: nothing about a page changed means the file this build wants is the file that
 * is already there, and a crawler that re-fetches after a change gets a URL it has never seen.
 * The design's list — title, description, theme, template, glyph source, dimensions, fonts — is
 * {@link cardCacheKey}, and the glyph enters it as its *bytes* rather than its path.
 *
 * **Drawing.** Handed to a child process, for the reason `og-worker.ts` explains at length: a
 * glyph can abort the renderer, and an abort is not a thing a `try` can hold. One process draws
 * every card; if it dies, the parent knows which card was in flight, retries that one without its
 * glyph — the degradation the design asks for — and carries on with the rest.
 *
 * **Reporting.** A page whose card could not be drawn simply has no card, and `og:image` falls back
 * to whatever it was before cards existed. One bad figure taking down a docs deploy is a worse
 * failure than one plain card.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  cardAltText, resolveOgConfig, sha256Hex,
  type ArticleConfig, type Diagnostic, type Manifest, type PageMeta, type RenderedArticle, type ResolvedOgConfig,
} from "@pagina/core";
import { PAGINA_VERSION } from "./bundle.js";
import { CARD_FONT_FAMILY } from "./og-card.js";
import { cardFontDigest, type CardJob } from "./og-render.js";
import { runCardJobs } from "./og-worker.js";
import { resolveCardPalette, type CardPalette } from "./og-theme.js";
import { paginaTempRoot } from "./tmp.js";

/** Where cards are written, under the output root. Beside the other things the build emits. */
export const OG_CARD_DIR = "_pagina/og";

/** A name this build's cards take, so a rebuild in place can clear the ones it no longer wants. */
const CARD_FILE = /^[a-z0-9-]+\.[0-9a-f]{8}\.png$/;

/** Hex characters of the cache key that go in the file name — the same 32 bits the assets use. */
const CARD_HASH_CHARS = 8;

export interface OgCardResult {
  /** Page href → the card's site URL and its alt text, for {@link withOgCards}. */
  readonly cards: Map<string, { readonly url: string; readonly alt: string }>;
  /** Paths written, relative to `outDir`. */
  readonly files: string[];
  readonly diagnostics: Diagnostic[];
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

/**
 * Everything that can change the picture, in one string.
 *
 * Every field of it is something a reader would see change. What is deliberately *not* in it: the
 * page's href beyond the slug that already seeds the mark, the build's base URL, and the time. A
 * key that moves when nothing visible moved is a cache that never hits.
 */
export function cardCacheKey(o: {
  readonly job: Omit<CardJob, "out">;
  readonly glyphSource?: string;
  readonly fontDigest: string;
  readonly fontFamily: string;
  /** pagina's own version: the composition is an input too, and it changes between releases. */
  readonly pagina: string;
}): string {
  return JSON.stringify({
    v: 1,
    pagina: o.pagina,
    content: o.job.content,
    palette: o.job.palette,
    template: o.job.template,
    width: o.job.width,
    height: o.job.height,
    slotWidth: o.job.slotWidth,
    glyphPosition: o.job.glyphPosition,
    // The glyph by its *bytes*: a scene edited in place must redraw the card that shows it.
    glyph: o.job.glyph === undefined ? null : { source: o.glyphSource ?? "", time: o.job.glyph.time, alt: o.job.glyph.alt },
    font: { digest: o.fontDigest, family: o.fontFamily },
  });
}

/** The footer line: what kind of article this is, and how long the page takes to read. */
function footerLine(article: Manifest["article"], page: PageMeta): string {
  const parts: string[] = [];
  if (article.category !== undefined && article.category !== "") parts.push(article.category);
  if (page.readingMinutes !== undefined) parts.push(`${page.readingMinutes} min read`);
  return parts.join(" · ");
}

interface PlannedCard {
  readonly href: string;
  readonly job: CardJob;
  readonly alt: string;
  readonly rel: string;
  readonly url: string;
  /** True when the file this build wants is already on disk. */
  readonly cached: boolean;
}

export interface PlanOgCardsOptions {
  readonly article: RenderedArticle;
  readonly config: ArticleConfig;
  readonly folder: string;
  readonly outDir: string;
  readonly base: string;
  /** `client/tokens.css` as the shell ships it, when it ships one. */
  readonly tokensCss?: string;
}

/**
 * What this build would draw, and what it can skip.
 *
 * Separated from the drawing so the plan is testable without a rasteriser, and so the cache
 * decision is a pure comparison of names rather than a side effect of rendering.
 */
export async function planOgCards(o: PlanOgCardsOptions): Promise<{ readonly planned: PlannedCard[]; readonly diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const planned: PlannedCard[] = [];
  const manifest = o.article.manifest;
  const fontDigest = await cardFontDigest();
  const glyphSources = new Map<string, string>();

  for (const [href, page] of Object.entries(manifest.pages)) {
    const rendered = Object.values(o.article.pages).find((p) => p.href === href);
    const og: ResolvedOgConfig = resolveOgConfig(o.config.og, rendered?.frontMatter.og);
    if (!og.enabled) continue;
    // Someone who drew a card gets their card, and pagina does not spend a rasteriser on a picture
    // it is not going to reference.
    if ((page.cover ?? manifest.article.cover) !== undefined) continue;

    const { palette, diagnostics: paletteDiagnostics } = await resolveCardPalette(o.folder, og.scheme, {
      ...(o.tokensCss === undefined ? {} : { tokensCss: o.tokensCss }),
      ...(o.config.theme === undefined ? {} : { articleTheme: o.config.theme }),
      ...(rendered?.frontMatter.theme === undefined ? {} : { pageTheme: rendered.frontMatter.theme }),
      ...(rendered?.path === undefined ? {} : { pagePath: rendered.path }),
    });
    // Reported once per distinct message rather than once per page: a host whose accent is
    // `oklch(…)` does not need that said forty times.
    for (const d of paletteDiagnostics) if (!diagnostics.some((seen) => seen.message === d.message)) diagnostics.push(d);

    const content = {
      title: page.title,
      ...(page.description === undefined ? {} : { description: page.description }),
      siteName: manifest.article.title,
      footer: footerLine(manifest.article, page),
      slug: `${o.config.slug}${href}`,
    };
    const alt = cardAltText({
      title: page.title,
      ...(page.description === undefined ? {} : { description: page.description }),
      siteName: manifest.article.title,
      ...(og.alt === undefined ? {} : { alt: og.alt }),
    });

    let glyph: CardJob["glyph"] | undefined;
    let glyphSource: string | undefined;
    if (og.glyph !== undefined) {
      const file = resolve(o.folder, og.glyph);
      try {
        let source = glyphSources.get(file);
        if (source === undefined) { source = await readFile(file, "utf8"); glyphSources.set(file, source); }
        glyphSource = source;
        glyph = { file, alt, time: og.time };
      } catch {
        diagnostics.push({
          severity: "warning",
          code: "og-glyph-missing",
          message: `og.glyph names ${og.glyph}, which is not in the article folder — the card is drawn without it.`,
          page: href,
        });
      }
    }

    const job: Omit<CardJob, "out"> = {
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
    const hash = (await sha256Hex(Buffer.from(cardCacheKey({
      job,
      ...(glyphSource === undefined ? {} : { glyphSource }),
      fontDigest,
      fontFamily: CARD_FONT_FAMILY,
      pagina: PAGINA_VERSION,
    }), "utf8"))).slice(0, CARD_HASH_CHARS);
    const rel = `${OG_CARD_DIR}/${cardSlug(href)}.${hash}.png`;
    planned.push({
      href,
      job: { ...job, out: join(o.outDir, rel) },
      alt,
      rel,
      url: `${o.base.replace(/\/$/, "")}/${rel}`,
      cached: existsSync(join(o.outDir, rel)),
    });
  }
  return { planned, diagnostics };
}

/** One line of the worker's NDJSON. */
type WorkerLine = { start: number } | { index: number; ok: true; bytes: number } | { index: number; ok: false; error: string };

/**
 * The compiled worker: next to this module, or in `dist/` when this module is the source.
 *
 * `@pagina/vite` publishes a `development` export condition that points at `src/`, and vitest and
 * pagina's own dev server both take it. There is no `src/og-worker.js` to spawn in that tree, so
 * the built sibling is the fallback — the child has to be a file Node can run on its own, which a
 * `.ts` is not.
 */
function workerPath(): string {
  const sibling = fileURLToPath(new URL("./og-worker.js", import.meta.url));
  if (existsSync(sibling)) return sibling;
  return fileURLToPath(new URL("../dist/og-worker.js", import.meta.url));
}

/**
 * Runs `jobs` in a child process, answering with one result per job.
 *
 * `undefined` in the returned array means the job never reported: the process stopped before it
 * could, which is the abort case. Everything else — a bad module, a scene with an error, a file
 * that cannot be written — comes back as a string.
 */
async function drawInChild(jobs: readonly CardJob[], jobsFile: string): Promise<(true | string | undefined)[]> {
  await writeFile(jobsFile, JSON.stringify(jobs));
  const results: (true | string | undefined)[] = new Array<undefined>(jobs.length).fill(undefined);
  await new Promise<void>((done) => {
    const child = spawn(process.execPath, [workerPath(), jobsFile], { stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let inFlight: number | undefined;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        let parsed: WorkerLine;
        try { parsed = JSON.parse(line) as WorkerLine; } catch { continue; }
        if ("start" in parsed) { inFlight = parsed.start; continue; }
        results[parsed.index] = parsed.ok ? true : parsed.error;
        inFlight = undefined;
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const finish = (why: string): void => {
      // The job that was announced and never answered is the one that took the process down. Its
      // own stderr is the only clue anyone gets, so it is carried into the message.
      if (inFlight !== undefined && results[inFlight] === undefined)
        results[inFlight] = `${why}${stderr.trim() === "" ? "" : `: ${stderr.trim().split("\n").slice(0, 3).join(" / ")}`}`;
      done();
    };
    child.on("error", (e) => { finish(`the card renderer could not be started (${e.message})`); });
    child.on("close", (code, signal) => {
      finish(signal !== null
        ? `the card renderer was killed by ${signal}`
        : `the card renderer exited with code ${code ?? "?"}`);
    });
  });
  return results;
}

export interface GenerateOgCardsOptions extends PlanOgCardsOptions {
  /**
   * Draw in this process instead of a child.
   *
   * For tests, which want a stack trace and not a second Node. It gives up the one property the
   * child buys — surviving an abort — so it is not what a build uses.
   */
  readonly inProcess?: boolean;
}

/**
 * Draws every card this build needs and answers with what to put in the manifest.
 *
 * A job that fails with its glyph is retried without it exactly once. That is the design's
 * degradation, and once is the right number: the second failure is not the glyph's fault, and a
 * loop that keeps trying is a build that hangs on a bad card instead of shipping a plain one.
 */
export async function generateOgCards(o: GenerateOgCardsOptions): Promise<OgCardResult> {
  const { planned, diagnostics } = await planOgCards(o);
  const cards = new Map<string, { url: string; alt: string }>();
  const files: string[] = [];
  for (const card of planned) {
    cards.set(card.href, { url: card.url, alt: card.alt });
    files.push(card.rel);
  }
  const todo = planned.filter((p) => !p.cached);
  if (todo.length > 0) {
    await mkdir(join(o.outDir, OG_CARD_DIR), { recursive: true });
    // Scratch, not output. It goes in a temp directory rather than beside the cards so that a
    // build interrupted mid-render leaves nothing behind in the site it was writing.
    const scratch = await mkdtemp(join(paginaTempRoot(), "pagina-og-"));
    const jobsFile = join(scratch, "jobs.json");
    const run = async (jobs: readonly CardJob[]): Promise<(true | string | undefined)[]> => {
      if (o.inProcess !== true) return drawInChild(jobs, jobsFile);
      const out: (true | string)[] = [];
      await writeFile(jobsFile, JSON.stringify(jobs));
      await runCardJobs(jobsFile, (line) => {
        const parsed = JSON.parse(line) as WorkerLine;
        if ("start" in parsed) return;
        out[parsed.index] = parsed.ok ? true : parsed.error;
      });
      return out;
    };

    let outcomes = await run(todo.map((p) => p.job));
    // Second pass: everything that failed *and had a glyph* is worth one attempt without it.
    const retry = todo
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => outcomes[i] !== true && p.job.glyph !== undefined);
    if (retry.length > 0) {
      const stripped = retry.map(({ p }) => {
        const rest: Record<string, unknown> = { ...p.job };
        delete rest["glyph"];
        return rest as unknown as CardJob;
      });
      const second = await run(stripped);
      retry.forEach(({ i }, k) => {
        const before = outcomes[i];
        if (second[k] === true) {
          diagnostics.push({
            severity: "warning",
            code: "og-glyph-failed",
            message: `the glyph for this page's card could not be drawn (${String(before ?? "the renderer stopped")}), so the card was drawn without it.`,
            page: todo[i]!.href,
          });
          outcomes = outcomes.map((v, j) => (j === i ? true : v));
        }
      });
    }
    outcomes.forEach((outcome, i) => {
      if (outcome === true) return;
      const card = todo[i]!;
      cards.delete(card.href);
      const at = files.indexOf(card.rel);
      if (at >= 0) files.splice(at, 1);
      diagnostics.push({
        severity: "warning",
        code: "og-card-failed",
        message: `no social card could be drawn for this page (${String(outcome ?? "the renderer stopped")}), so it shares without an image.`,
        page: card.href,
      });
    });
    await rm(scratch, { recursive: true, force: true });
  }
  // Last build's cards, cleared once this build's are known — `emptyOutDir` is off, so without
  // this a directory rebuilt in place keeps every card it has ever had.
  const dir = join(o.outDir, OG_CARD_DIR);
  if (existsSync(dir)) {
    const keep = new Set(planned.map((p) => p.rel.slice(`${OG_CARD_DIR}/`.length)));
    for (const entry of await readdir(dir)) {
      if (CARD_FILE.test(entry) && !keep.has(entry)) await rm(join(dir, entry), { force: true });
    }
  }
  return { cards, files: files.sort(), diagnostics };
}

/** The manifest again, with each page carrying the card drawn for it. */
export function withOgCards(manifest: Manifest, cards: OgCardResult["cards"]): Manifest {
  if (cards.size === 0) return manifest;
  const pages: Record<string, PageMeta> = {};
  for (const [href, page] of Object.entries(manifest.pages)) {
    const card = cards.get(href);
    pages[href] = card === undefined ? page : { ...page, card: card.url, cardAlt: card.alt };
  }
  return { ...manifest, pages };
}

export type { CardPalette };
