/**
 * Reading time, and the four things that used to inflate it.
 *
 * The number is computed once, in the build, from *rendered prose* — so the tests that matter are
 * the exclusions. A page that is 90% fenced code, a page whose figure carries a kilobyte of
 * kineglyph spec, and a page built out of raw HTML blocks must all report the reading time of the
 * sentences in them, not of the bytes. Front matter needs no test here: it is split off before the
 * markdown is parsed, so it never reaches rendered HTML at all — `render-page.test.ts` pins that.
 */
import { describe, expect, it } from "vitest";
import { WORDS_PER_MINUTE, countWords, prose, readingMinutes } from "../src/reading-time.js";

/** `n` words of prose, wrapped in a paragraph, as markdown-it would have rendered them. */
const words = (n: number): string => `<p>${Array.from({ length: n }, (_, i) => `word${String(i)}`).join(" ")}</p>`;

describe("prose", () => {
  it("keeps the text and drops the markup", () => {
    expect(prose(`<h1 id="a">Title</h1><p>Some <em>emphatic</em> text.</p>`)).toBe("Title Some emphatic text.");
  });

  it("decodes entities, and does not re-strip what they decode to", () => {
    // `&lt;div&gt;` is a reader's four characters, not a tag: decoding after stripping is what
    // keeps it from being swallowed as markup on a second pass.
    expect(prose("<p>Write &lt;div&gt; and &amp; carefully</p>")).toBe("Write <div> and & carefully");
  });

  it("counts inline code, because a sentence with a symbol in it is still a sentence", () => {
    expect(prose("<p>The <code>id</code> field</p>")).toBe("The id field");
  });
});

describe("countWords", () => {
  it("ignores a fenced code block entirely", () => {
    const code = `<pre><code class="language-ts">${Array.from({ length: 400 }, (_, i) => `const x${String(i)} = ${String(i)};`).join("\n")}</code></pre>`;
    expect(countWords(code)).toBe(0);
    expect(countWords(`${words(12)}${code}`)).toBe(12);
  });

  it("ignores a figure's kineglyph spec", () => {
    const figure = `<figure id="f"><script type="text/kineglyph">${JSON.stringify({ scene: "demo", nodes: Array.from({ length: 200 }, (_, i) => ({ id: i, label: `node ${String(i)}` })) })}</script><figcaption>A caption of five words</figcaption></figure>`;
    // The caption is prose a reader reads; the spec is a JSON document nobody does.
    expect(countWords(figure)).toBe(5);
  });

  it("ignores a raw HTML block's tag names and attribute values", () => {
    expect(countWords(`<div class="a b c d e f g" data-note="one two three four five"></div>`)).toBe(0);
    expect(countWords(`<div class="a b c d e">${words(4)}</div>`)).toBe(4);
  });

  it("ignores comments, styles, templates and inline SVG", () => {
    expect(countWords("<!-- one two three four five six -->")).toBe(0);
    expect(countWords("<style>.a { content: 'one two three'; }</style>")).toBe(0);
    expect(countWords("<template><p>one two three</p></template>")).toBe(0);
    expect(countWords(`<svg viewBox="0 0 1 1"><text>one two three</text></svg>`)).toBe(0);
  });

  it("is zero for a page with no prose at all", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("<p>   </p>")).toBe(0);
  });
});

describe("readingMinutes", () => {
  it("rounds to whole minutes at the documented rate", () => {
    expect(readingMinutes(words(WORDS_PER_MINUTE * 5))).toBe(5);
    expect(readingMinutes(words(WORDS_PER_MINUTE * 5 + 20))).toBe(5);
    expect(readingMinutes(words(WORDS_PER_MINUTE * 5 + 150))).toBe(6);
  });

  it("never claims less than a minute for a page that has prose", () => {
    // Rounding a real page down to "0 min read" reads as a bug, not as brevity.
    expect(readingMinutes(words(3))).toBe(1);
    expect(readingMinutes(words(1))).toBe(1);
  });

  it("is absent — not zero — for a page with no prose", () => {
    expect(readingMinutes("")).toBeUndefined();
    expect(readingMinutes(`<pre><code>const a = 1;</code></pre>`)).toBeUndefined();
  });

  it("does not let a wall of code buy a twenty-minute read", () => {
    // The regression this whole file exists for: 4,400 words of code and 30 of prose.
    const code = `<pre><code>${Array.from({ length: 4400 }, (_, i) => `tok${String(i)}`).join(" ")}</code></pre>`;
    expect(readingMinutes(`${words(30)}${code}`)).toBe(1);
  });
});
