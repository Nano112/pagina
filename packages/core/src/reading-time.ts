/**
 * How long a page takes to read, computed once at build time.
 *
 * The old schemati article system computed a `reading_time` and the move to pagina lost it. It
 * comes back **here**, in the build, rather than in any consumer: the static shell, the Laravel
 * host and an index card all read `manifest.pages[href].readingMinutes` and therefore cannot
 * disagree about it. A number computed in three places is three numbers.
 *
 * ## Counted from rendered prose, not from markdown
 *
 * Counting the source would count the things a reader does not read at reading speed: a fenced
 * code block, a figure's kineglyph spec, a raw HTML block's tag names and attribute values, and
 * the front matter. A page that is 90% code block would claim a twenty-minute read. So the input
 * is the *rendered* HTML — front matter is already gone by then, having been split off before the
 * markdown was parsed — and {@link prose} removes what is left.
 */

/**
 * Words per minute, for prose in a technical document.
 *
 * Brysbaert's 2019 meta-analysis of 190 studies puts silent reading of English non-fiction at
 * roughly 238 wpm. Documentation is read slower than that: the reader stops at code, follows
 * links, re-reads a definition. 220 is that figure rounded down — deliberately a slight
 * *under*-estimate, because a reading time that turns out optimistic is a small lie to a reader
 * who trusted it, and one that turns out generous is a pleasant surprise.
 *
 * A host that disagrees does not have to fight this: it can ignore `readingMinutes` and count
 * `manifest` prose itself. But then it owns the number everywhere, not in one place.
 */
export const WORDS_PER_MINUTE = 220;

/**
 * Elements whose text is not prose, removed with their contents.
 *
 * `pre` is a fenced code block (markdown-it renders one as `<pre><code>`). `script` covers both
 * a raw HTML script and a figure's `<script type="text/kineglyph">` spec, which is a JSON
 * document an author never reads. `style`, `template` and `svg` are markup that happens to
 * contain words. Inline `<code>` is deliberately *not* here: `the `id` field` is one sentence and
 * a reader reads all of it.
 */
const NON_PROSE = /<(pre|script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1>|<(pre|script|style|template|svg)\b[^>]*\/>/gi;

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

/**
 * The readable text of a fragment of rendered HTML.
 *
 * Tags go before entities are decoded, so a decoded `&lt;div&gt;` can never be mistaken for
 * markup and stripped a second time.
 */
export function prose(html: string): string {
  return html
    .replace(NON_PROSE, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#?\w+);/g, (whole, name: string) => ENTITY[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

/** The number of words in a fragment of rendered HTML, by the definition above. */
export function countWords(html: string): number {
  const text = prose(html);
  return text === "" ? 0 : text.split(" ").length;
}

/**
 * Whole minutes to read `html`, or `undefined` when it carries no prose at all.
 *
 * Never zero: a page with three words is a one-minute read, because "0 min read" is not a claim
 * anyone wants to make and rounding a real page down to nothing reads as a bug. A page with *no*
 * prose — a gallery, a page that is one diagram — gets no number rather than a false minimum,
 * which is why the field is absent from the manifest rather than present and meaningless.
 */
export function readingMinutes(html: string): number | undefined {
  const words = countWords(html);
  return words === 0 ? undefined : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
