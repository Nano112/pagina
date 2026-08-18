/**
 * Search: an index built where the article is rendered, queried in the browser.
 *
 * ## Why this is hand-rolled
 *
 * The obvious answer for a static site is Pagefind, and for a big site it is the right answer: it
 * chunks its index so a thousand-page manual costs one 20 kB fetch to answer a query. But it is a
 * platform binary that post-processes a *directory of built HTML*, and pagina's output is not
 * always a directory — the Laravel package serves `.rendered/` fragments out of a bundle, and a
 * post-processor pointed at a folder of files cannot see them. Running it would also mean a second
 * build tool, a second definition of "what a page is", and a second place for the `exclude` rules
 * to be applied and forgotten.
 *
 * A client-side library (MiniSearch, Lunr) fixes the binary problem and keeps the second
 * definition: it wants documents, and deciding what a document *is* — which is the whole quality
 * question for docs search — is work this file has to do either way. What it would add is a
 * serialised inverted index that is larger than the one below and a runtime in the reading bundle.
 *
 * What is left after that work is done is small, so it is done here. pagina already knows things a
 * generic indexer has to guess at: every heading with its anchor and level, a resolved description
 * per page, nav order, and — because figures are inlined SVG by the time a page is rendered — the
 * `<title>`/`<desc>` an author wrote *about a diagram*, which is the one part of a page that a text
 * indexer scraping rendered HTML cannot read at all.
 *
 * ## The shape
 *
 * A **document is a section**, not a page: everything under one `h2`/`h3` up to the next one, plus
 * a lead document for the prose above the first. A docs page is a list of topics and a result that
 * says only "Theming" has told the reader nothing they did not know from the sidebar.
 *
 * The index is a term list plus posting lists — enough to pick candidates in one binary search per
 * query token, including prefix tokens, which is what makes an as-you-type box feel instant. Scoring
 * and snippets then re-scan only the candidates, where the exact field and the exact character
 * offsets are in hand. Postings carry no positions and no weights, because re-reading twelve short
 * strings is cheaper than storing that for every term in the corpus.
 */
import type { RenderedArticle } from "./types.js";

/** The format version. Bumped when a reader written for the old shape would misread the new one. */
export const SEARCH_INDEX_VERSION = 1;

/** Where a static build writes the index, relative to the output root. */
export const SEARCH_INDEX_PATH = "_pagina/search.json";

/** Where a bundle carries it, inside `.rendered/`. See `bundle.ts`. */
export const SEARCH_INDEX_BUNDLE_PATH = "search.json";

/**
 * One indexed section.
 *
 * The keys are short because they repeat once per section and a reader downloads all of them; they
 * are still keys rather than tuple positions because an index someone can open and read is worth
 * the two kilobytes, and gzip removes most of the difference anyway.
 */
export interface SearchDoc {
  /** The page's href, exactly as the manifest keys it — without `base`, which the client adds. */
  readonly h: string;
  /** The section's anchor id. Absent on a page's lead document. */
  readonly a?: string;
  /** The page's title. */
  readonly p: string;
  /** The section's title — the page title on a lead document. */
  readonly t: string;
  /** The heading level: 1 for the lead, else 2 or 3. */
  readonly l: number;
  /**
   * The section's prose, as plain text, **truncated** — this is what a snippet is cut from, not
   * what was indexed. Every word of the section is in {@link SearchIndex.terms} regardless; see
   * {@link BuildSearchIndexOptions.maxBodyChars} for why the two differ.
   */
  readonly b: string;
  /** The page's resolved description. Lead documents only. */
  readonly d?: string;
  /** `<title>`/`<desc>` of the figures in this section — what the author said a diagram shows. */
  readonly f?: string;
  /** The page's position in nav order, so equal matches break towards the front of the article. */
  readonly o: number;
}

export interface SearchIndex {
  readonly v: number;
  /** The article's title, for the dialog's empty state. */
  readonly title: string;
  readonly docs: readonly SearchDoc[];
  /** Every term in the corpus, sorted, so a prefix is one binary-searched range. */
  readonly terms: readonly string[];
  /**
   * Posting lists, parallel to {@link terms}: ascending document ids, delta-encoded (the first
   * entry is absolute, each later one is the gap from the one before). Deltas rather than ids
   * because they are one or two digits where an id is three, which is most of the file.
   */
  readonly post: readonly (readonly number[])[];
}

// --- text extraction --------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", times: "×", middot: "·",
};

/** Decodes the entities a markdown renderer actually emits, plus numeric ones. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Elements whose text is markup's business and not the reader's. */
const DROPPED = /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** A whole `<svg>` subtree — replaced by only the parts of it that are prose. See {@link svgProse}. */
const SVG = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
/** The two elements inside an SVG that say, in words, what the picture shows. */
const SVG_PROSE = /<(title|desc)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** The `<title>`/`<desc>` of every figure in a fragment, joined — the diagram's own description. */
export function svgProse(html: string): string {
  const out: string[] = [];
  for (const svg of html.match(SVG) ?? []) {
    for (const m of svg.matchAll(SVG_PROSE)) out.push(text(m[2] ?? ""));
  }
  return out.filter((s) => s !== "").join(" ");
}

/** A fragment of rendered HTML as the plain text a reader sees. */
export function text(html: string): string {
  return decodeEntities(
    html
      .replace(DROPPED, " ")
      .replace(SVG, " ")
      // A block boundary is a word boundary: `<p>one</p><p>two</p>` is two words, not "onetwo".
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// --- tokenising -------------------------------------------------------------------------------

/**
 * The one tokeniser. The index and the query must agree exactly, so there is no second one.
 *
 * Words split on anything that is not a letter or a digit, which covers `-`, `_`, `.` and every
 * punctuation mark. A camelCase or PascalCase run *additionally* yields its parts, because
 * `buildSearchIndex` is how the identifier is written and `search` is how it is looked for. The
 * whole run is kept as well, so an exact spelling still outranks its pieces.
 */
export function tokenize(s: string): string[] {
  const out = new Set<string>();
  for (const run of s.split(/[^\p{L}\p{N}]+/u)) {
    if (run === "") continue;
    out.add(run.toLowerCase());
    // The camel split needs the original case, which is why this is one pass and not two.
    if (!/[a-z][A-Z]/.test(run)) continue;
    for (const part of run.split(/(?<=[a-z0-9])(?=[A-Z])/)) {
      if (part !== "") out.add(part.toLowerCase());
    }
  }
  return [...out];
}

// --- building ---------------------------------------------------------------------------------

/** An `<h1>`–`<h6>` opening tag that carries an id — which every heading pagina renders does. */
const HEADING = /<h([1-6])\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi;
/** A fenced code block. Indexed, never quoted back at a reader — see the note in `push` below. */
const CODE_BLOCK = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi;

export interface BuildSearchIndexOptions {
  /**
   * Longest **stored** section body, in characters. Default {@link DEFAULT_MAX_BODY}.
   *
   * The index has two jobs and they want different amounts of text. *Finding* a section wants
   * every word in it, and a word costs nothing extra once its term is in the list — the posting is
   * one small integer whether the word occurs once or fifty times. *Showing* a section wants a
   * couple of lines of context, and storing the other four thousand characters to maybe cut a
   * different sentence out of them is what makes an index enormous: on a 29-page reference with
   * long API sections, the whole-prose version was 1.0 MB where this one is 331 kB.
   *
   * So the terms come from the entire section and the stored text is cut here. What a reader loses
   * is only that a match past the cut is shown with the section's opening lines instead of the
   * matching sentence — the result is still found, still ranked, and still lands on the right
   * anchor. What they gain is an index they can download on a phone.
   */
  readonly maxBodyChars?: number;
  /** Hrefs to leave out entirely. For a host that publishes a subset of the article. */
  readonly exclude?: readonly string[];
}

/**
 * 700 characters: about four lines of prose, or three snippet windows' worth of room to find a
 * match in. Measured against pagina's own docs and a 29-page Nucleation reference — below this the
 * fallback-to-opening case starts happening on ordinary sections, above it the file grows without
 * changing what a reader sees.
 */
export const DEFAULT_MAX_BODY = 700;

/**
 * Builds the index from a **rendered** article — after `inlineArticleFigures`, so the figures'
 * `<title>`/`<desc>` are in the HTML and can be read. Building from the un-inlined article is not
 * an error; it just quietly indexes no diagrams.
 */
export function buildSearchIndex(article: RenderedArticle, options: BuildSearchIndexOptions = {}): SearchIndex {
  const maxBody = options.maxBodyChars ?? DEFAULT_MAX_BODY;
  const excluded = new Set(options.exclude ?? []);
  const docs: SearchDoc[] = [];
  /** Parallel to {@link docs}: everything the section says, which is what the terms come from. */
  const indexed: string[] = [];
  // Nav order, which is the order `manifest.pages` is built in — the pager walks it and so does the
  // 404's index, so a search result agreeing with both costs nothing but reading the same list.
  const order = Object.keys(article.manifest.pages);

  order.forEach((href, o) => {
    if (excluded.has(href)) return;
    const page = article.pages[href];
    const meta = article.manifest.pages[href];
    if (page === undefined || meta === undefined) return;
    const html = page.html;

    // Every h2/h3 with an id, in document order, with where it starts and ends.
    const cuts: { id: string; title: string; level: number; from: number; titleEnd: number }[] = [];
    for (const m of html.matchAll(HEADING)) {
      const level = Number(m[1]);
      if (level !== 2 && level !== 3) continue;
      cuts.push({
        id: m[2] ?? "", title: text(m[3] ?? ""), level,
        from: m.index, titleEnd: m.index + m[0].length,
      });
    }

    const push = (
      from: number, to: number, title: string, level: number, id?: string, description?: string,
    ): void => {
      const fragment = html.slice(from, to);
      // Two readings of the same fragment. `full` is everything, and is what the terms come from —
      // an API name only a code block contains is exactly the thing a reader searches for. `prose`
      // is the same fragment with the code blocks taken out, and is what a *snippet* is cut from:
      // three lines of somebody's `let mut schematic = …` is not how a reader decides which of ten
      // results they want, and on a code-heavy reference it is half of the index by weight.
      const full = text(fragment);
      const prose = text(fragment.replace(CODE_BLOCK, " "));
      const figures = svgProse(fragment);
      // A section with a heading is worth a result even when it is only a heading — it is a place
      // in the document. A *lead* with nothing in it is not: it is the gap above the first h2.
      if (id === undefined && full === "" && figures === "" && (description ?? "") === "") return;
      docs.push({
        h: href, p: meta.title, t: title === "" ? meta.title : title, l: level,
        b: prose.slice(0, maxBody), o,
        ...(id === undefined ? {} : { a: id }),
        ...(description === undefined || description === "" ? {} : { d: description }),
        ...(figures === "" ? {} : { f: figures }),
      });
      indexed.push(full);
    };

    // The lead: everything above the first h2/h3, including the h1. Carries the page description,
    // because that is a sentence about the page and this is the document that *is* the page.
    push(0, cuts[0]?.from ?? html.length, meta.title, 1, undefined, meta.description);
    cuts.forEach((cut, i) => {
      push(cut.titleEnd, cuts[i + 1]?.from ?? html.length, cut.title, cut.level, cut.id);
    });
  });

  // One posting list per term. A term appears once per document however often it occurs in it:
  // frequency is re-derived from the stored text at score time, where the field is known too.
  const postings = new Map<string, number[]>();
  docs.forEach((doc, id) => {
    const seen = new Set<string>();
    for (const field of [doc.t, doc.p, indexed[id] ?? "", doc.d ?? "", doc.f ?? ""]) {
      for (const term of tokenize(field)) seen.add(term);
    }
    for (const term of seen) {
      const list = postings.get(term);
      if (list === undefined) postings.set(term, [id]);
      else list.push(id);
    }
  });
  const terms = [...postings.keys()].sort();
  const post = terms.map((term) => {
    const ids = postings.get(term)!;
    let last = 0;
    return ids.map((id) => {
      const delta = id - last;
      last = id;
      return delta;
    });
  });

  return { v: SEARCH_INDEX_VERSION, title: article.manifest.article.title, docs, terms, post };
}

/** The index as the bytes a build writes. Compact — it is downloaded, not read by hand daily. */
export function serializeSearchIndex(index: SearchIndex): string {
  return `${JSON.stringify(index)}\n`;
}

/**
 * Reads an index, refusing anything that is not one.
 *
 * A search box that renders whatever JSON it was handed is a search box that will one day render a
 * stale index from a cache against a page whose hrefs have all changed. Structure is checked here so
 * the caller's only failure mode is "the index did not load", which it already has to handle.
 */
export function parseSearchIndex(json: string): SearchIndex {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) throw new Error("search index: not an object");
  const o = raw as Record<string, unknown>;
  if (o["v"] !== SEARCH_INDEX_VERSION) throw new Error(`search index: version ${String(o["v"])}, expected ${String(SEARCH_INDEX_VERSION)}`);
  if (!Array.isArray(o["docs"]) || !Array.isArray(o["terms"]) || !Array.isArray(o["post"]))
    throw new Error("search index: missing docs/terms/post");
  if (o["terms"].length !== o["post"].length) throw new Error("search index: terms and postings disagree");
  return raw as SearchIndex;
}

// --- querying ---------------------------------------------------------------------------------

/** A run of snippet text, and whether it matched. Ranges rather than HTML: the caller escapes. */
export interface SnippetPart { readonly text: string; readonly mark: boolean }

export interface SearchHit {
  /** The page href, without `base`. */
  readonly href: string;
  /** The section's anchor id, when the hit is a section rather than a whole page. */
  readonly anchor?: string;
  /** The page's title — the kicker above the result. */
  readonly page: string;
  /** The section's title — the result's own heading. */
  readonly title: string;
  /** Which of the title's characters matched, so the heading can be marked like the snippet is. */
  readonly titleParts: readonly SnippetPart[];
  readonly snippet: readonly SnippetPart[];
  /** True when the text under the title came from a figure's `<title>`/`<desc>`. */
  readonly fromFigure: boolean;
  readonly score: number;
}

export interface SearchOptions {
  /** Most hits to return. Default 12. */
  readonly limit?: number;
  /** Characters of context around a match. Default 140. */
  readonly snippetChars?: number;
}

/**
 * The half-open range of `terms` whose entries start with `prefix`.
 *
 * Two binary searches over one sorted array, which is the whole reason the terms are sorted: an
 * as-you-type query is a prefix query on every keystroke, and this makes each one ~17 comparisons
 * on a 100 000-term corpus instead of a scan.
 */
function prefixRange(terms: readonly string[], prefix: string): [number, number] {
  let lo = 0;
  let hi = terms.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (terms[mid]! < prefix) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  // From `start` on, "starts with prefix" is true then false and never true again, so it is
  // itself a binary-searchable predicate.
  hi = terms.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (terms[mid]!.startsWith(prefix)) lo = mid + 1;
    else hi = mid;
  }
  return [start, lo];
}

function docsFor(index: SearchIndex, from: number, to: number): Set<number> {
  const out = new Set<number>();
  for (let i = from; i < to; i += 1) {
    let id = 0;
    for (const delta of index.post[i] ?? []) {
      id += delta;
      out.add(id);
    }
  }
  return out;
}

/** Field weights. Ratios, not magic: a title match is worth about four body matches. */
const W = { title: 12, page: 5, description: 4, figure: 4, body: 3 } as const;
/** A term the reader finished typing, matched whole, beats the same term matched as a prefix. */
const PREFIX_PENALTY = 0.45;

/** Where `term` occurs in `hay` as a whole word, or as a word prefix. `-1` for neither. */
function findWord(hay: string, term: string, prefixOk: boolean): { at: number; whole: boolean } {
  let from = 0;
  let prefixAt = -1;
  for (;;) {
    const at = hay.indexOf(term, from);
    if (at === -1) break;
    const before = at === 0 ? "" : hay[at - 1]!;
    const after = hay[at + term.length] ?? "";
    const startsWord = at === 0 || !/[\p{L}\p{N}]/u.test(before);
    if (startsWord) {
      const endsWord = after === "" || !/[\p{L}\p{N}]/u.test(after);
      if (endsWord) return { at, whole: true };
      if (prefixAt === -1) prefixAt = at;
    }
    from = at + 1;
  }
  return prefixOk && prefixAt !== -1 ? { at: prefixAt, whole: false } : { at: -1, whole: false };
}

/**
 * `hay` lowercased, but only when that leaves every character where it was.
 *
 * Case folding is not length-preserving for every script (`İ` folds to two code units), and this
 * whole file addresses matches by offset *into the original string*. Rather than mis-slice a word
 * in some language nobody tested, the offset-using callers ask for this and do nothing when it is
 * `undefined` — an unhighlighted result, never a corrupted one.
 */
function foldable(hay: string): string | undefined {
  const low = hay.toLowerCase();
  return low.length === hay.length ? low : undefined;
}

/** Splits `hay` into marked/unmarked runs at every place one of `terms` starts a word. */
function mark(hay: string, terms: readonly string[], prefixLast: boolean): SnippetPart[] {
  const low = foldable(hay);
  if (low === undefined) return hay === "" ? [] : [{ text: hay, mark: false }];
  const spans: [number, number][] = [];
  terms.forEach((term, i) => {
    const prefixOk = prefixLast && i === terms.length - 1;
    let from = 0;
    for (;;) {
      const hit = findWord(low.slice(from), term, prefixOk);
      if (hit.at === -1) break;
      const at = from + hit.at;
      // A prefix match highlights the whole word it began, not the typed fragment: half a
      // highlighted word reads as a rendering bug.
      let end = at + term.length;
      if (!hit.whole) while (end < hay.length && /[\p{L}\p{N}]/u.test(hay[end]!)) end += 1;
      spans.push([at, end]);
      from = end;
    }
  });
  if (spans.length === 0) return hay === "" ? [] : [{ text: hay, mark: false }];
  spans.sort((a, b) => a[0] - b[0]);
  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const [from, to] of spans) {
    if (to <= cursor) continue;
    const start = Math.max(from, cursor);
    if (start > cursor) parts.push({ text: hay.slice(cursor, start), mark: false });
    parts.push({ text: hay.slice(start, to), mark: true });
    cursor = to;
  }
  if (cursor < hay.length) parts.push({ text: hay.slice(cursor), mark: false });
  return parts;
}

/**
 * A window of `body` around the first match, cut on word boundaries and ellipsised where it was cut.
 *
 * The match is put a third of the way in rather than centred: a reader scans left to right, and the
 * words *after* the term are the ones that say whether this is the passage they wanted.
 */
function excerpt(body: string, terms: readonly string[], prefixLast: boolean, width: number): string {
  if (body.length <= width) return body;
  const low = foldable(body);
  let at = -1;
  if (low !== undefined) {
    terms.forEach((term, i) => {
      if (at !== -1) return;
      const hit = findWord(low, term, prefixLast && i === terms.length - 1);
      if (hit.at !== -1) at = hit.at;
    });
  }
  // No match in this field — the hit was in the title, or in text past the body cap. The opening
  // of the section is the honest thing to show.
  if (at === -1) {
    const space = body.lastIndexOf(" ", width);
    return `${body.slice(0, space === -1 ? width : space)}…`;
  }
  let from = Math.max(0, at - Math.floor(width / 3));
  if (from > 0) {
    const space = body.indexOf(" ", from);
    if (space !== -1 && space < at) from = space + 1;
  }
  const to = Math.min(body.length, from + width);
  return `${from > 0 ? "…" : ""}${body.slice(from, to)}${to < body.length ? "…" : ""}`;
}

/**
 * Runs a query.
 *
 * Every token must match somewhere in a document (AND, not OR): a reader typing two words is
 * narrowing, and a result matching only the second one is noise dressed as recall. The last token is
 * matched as a prefix, because the reader is probably still typing it.
 */
export function searchIndex(index: SearchIndex, query: string, options: SearchOptions = {}): SearchHit[] {
  const limit = options.limit ?? 12;
  const width = options.snippetChars ?? 140;
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  // The trailing token is a prefix only if the reader did not put a boundary after it.
  const prefixLast = /[\p{L}\p{N}]$/u.test(query);

  // Candidates: documents matching every token. Start from the rarest token's postings so the
  // intersection shrinks as fast as it can.
  const perTerm = terms.map((term, i) => {
    const [from, to] = prefixRange(index.terms, term);
    // Only the last token expands to its whole prefix range; an earlier one the reader has already
    // finished typing means the word they wrote, not every word that begins with it. An exact term
    // sorts first inside its own prefix range, so it is at `from` when it exists at all.
    if (prefixLast && i === terms.length - 1) return docsFor(index, from, to);
    return index.terms[from] === term ? docsFor(index, from, from + 1) : new Set<number>();
  });
  if (perTerm.some((s) => s.size === 0)) return [];
  perTerm.sort((a, b) => a.size - b.size);
  const candidates = [...perTerm[0]!].filter((id) => perTerm.every((s) => s.has(id)));

  const hits: SearchHit[] = [];
  for (const id of candidates) {
    const doc = index.docs[id];
    if (doc === undefined) continue;
    const fields: [string, number][] = [
      [doc.t.toLowerCase(), W.title],
      [doc.p.toLowerCase(), W.page],
      [(doc.d ?? "").toLowerCase(), W.description],
      [(doc.f ?? "").toLowerCase(), W.figure],
      [doc.b.toLowerCase(), W.body],
    ];
    let score = 0;
    terms.forEach((term, i) => {
      const prefixOk = prefixLast && i === terms.length - 1;
      let best = 0;
      for (const [hay, weight] of fields) {
        const hit = findWord(hay, term, prefixOk);
        if (hit.at === -1) continue;
        // Earlier in a field is more likely to be what the field is *about*.
        const position = 1 + 0.25 / (1 + hit.at / 40);
        best = Math.max(best, weight * (hit.whole ? 1 : PREFIX_PENALTY) * position);
      }
      score += best;
    });
    // The whole query as a phrase, in order, in one field: the strongest signal there is.
    const phrase = terms.join(" ");
    if (terms.length > 1) {
      for (const [hay, weight] of fields) if (hay.includes(phrase)) { score += weight; break; }
    }
    // An h2 is a bigger place in the document than an h3, and a page's lead is the page itself.
    score += doc.l === 1 ? 2 : doc.l === 2 ? 1 : 0;
    // Nav order as a tiebreak only — never enough to move a result past a better match.
    score += Math.max(0, 0.5 - doc.o * 0.01);

    const fromFigure = doc.b === "" && (doc.f ?? "") !== "";
    const source = fromFigure ? doc.f! : doc.b !== "" ? doc.b : (doc.d ?? doc.f ?? "");
    hits.push({
      href: doc.h, page: doc.p, title: doc.t, score, fromFigure,
      titleParts: mark(doc.t, terms, prefixLast),
      snippet: mark(excerpt(source, terms, prefixLast, width), terms, prefixLast),
      ...(doc.a === undefined ? {} : { anchor: doc.a }),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
