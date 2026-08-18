import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdown, expandSnippets, renderMarkdown, type ContentFs } from "@pagina/core";
import { parseMarkdown, serializeMarkdown } from "../src/model/index.js";
import { DEMO_SEED } from "../src/demo.js";

/**
 * The round-trip guarantee, verbatim from plan A's global constraints. For every source:
 *
 *  1. `serialize(parse(…))` is a **fixed point** after one pass — one save normalises, later saves
 *     change nothing, so a page under editing does not drift;
 *  2. re-parsing yields the **same document**, so nothing the editor can show is lost;
 *  3. core renders the **same HTML** from the original and from the saved markdown — including
 *     after `expandSnippets`, since that is what the site actually builds.
 *
 * Sources are the fixture's three pages, two real Nucleation pages, and one synthetic sample per
 * custom node, mark and block construct.
 *
 * The Nucleation pages are **vendored** into `fixtures/nucleation/`, not read out of a sibling
 * checkout. Reading a sibling checkout made this suite prove nothing anywhere else (it skipped
 * itself when the path was absent) and made it fail here whenever someone edited an unrelated
 * repository. `scripts/sync-nucleation-fixtures.mjs` refreshes the copies, explicitly and by hand.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../core/test/fixture");
const nucleationDocs = resolve(here, "../../../fixtures/nucleation/docs");

const FRONT_MATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** `ContentFs` over a real folder — the same shape `@pagina/vite`'s `NodeContentFs` provides. */
function nodeFs(root: string): ContentFs {
  const abs = (p: string): string => resolve(root, p);
  return {
    read: async (p) => readFileSync(abs(p), "utf8"),
    readBinary: async (p) => new Uint8Array(readFileSync(abs(p))),
    exists: async (p) => existsSync(abs(p)),
    list: async () => [],
  };
}

interface Source {
  readonly name: string;
  readonly markdown: string;
  /** Folder snippet refs resolve against, plus the roots from the page's `article.yaml`. */
  readonly root: string;
  readonly roots: readonly string[];
}

const serialize = (markdown: string): string => {
  const { doc, frontMatter } = parseMarkdown(markdown);
  return serializeMarkdown(doc, frontMatter === undefined ? {} : { frontMatter });
};

/** The HTML the site would build from this page: front matter dropped, snippets expanded. */
async function html(source: Source, markdown: string): Promise<string> {
  const body = markdown.replace(FRONT_MATTER, "");
  const { text } = await expandSnippets(body, { fs: nodeFs(source.root), roots: source.roots, pagePath: source.name });
  return renderMarkdown(createMarkdown(), text).html;
}

/** Line-based LCS, so a failure shows the few lines that moved rather than two whole pages. */
function unifiedDiff(a: string, b: string): string {
  const left = a.split("\n");
  const right = b.split("\n");
  const lcs: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      lcs[i]![j] = left[i] === right[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { out.push(`  ${left[i]!}`); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push(`- ${left[i++]!}`);
    else out.push(`+ ${right[j++]!}`);
  }
  while (i < left.length) out.push(`- ${left[i++]!}`);
  while (j < right.length) out.push(`+ ${right[j++]!}`);
  return out.filter((line, k) => line.startsWith("- ") || line.startsWith("+ ") || out.slice(Math.max(0, k - 2), k + 3).some((l) => !l.startsWith("  "))).join("\n");
}

/** `expect(actual).toBe(expected)`, but reporting the diff instead of two walls of text. */
function expectSame(actual: string, expected: string, what: string): void {
  if (actual === expected) return;
  throw new Error(`${what}\n${unifiedDiff(expected, actual)}`);
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

const fixturePage = (page: string): Source => ({
  name: page,
  markdown: readFileSync(join(fixtureRoot, page), "utf8"),
  root: fixtureRoot,
  roots: [".", "../outside"],
});

const nucleationPage = (page: string): Source => ({
  name: `nucleation/${page}`,
  markdown: readFileSync(join(nucleationDocs, page), "utf8"),
  root: nucleationDocs,
  roots: [".", ".."],
});

const synthetic = (name: string, markdown: string): Source => ({ name, markdown, root: fixtureRoot, roots: [".", "../outside"] });

const SYNTHETIC: readonly Source[] = [
  synthetic(
    "front matter and headings",
    `---
title: Sample
tags: [a, b]
---

# Title

## Explicit id {#custom-anchor}

### Slugged heading

Paragraph with a soft
break across two lines, and a hard break\\
after this one.
`,
  ),
  synthetic(
    "front matter carrying page metadata, comments and all",
    `---
# Which page this is, and how it should look when it is shared.
title: Overridden
description: A one-line summary that is read but never rewritten.
cover: ../media/hero.png
author: 'Ada Lovelace'
published: 2026-08-17
noindex: true
tags:
  - one   # a comment on a list item
  - two
---

# Real heading

The body, which the renderer sees and the front matter block, which it does not.
`,
  ),
  synthetic(
    "inline marks",
    `Text with **bold**, *italic*, ~~strike~~, \`code\`, a [link](target.md), a
[titled link](target.md "Tooltip"), a [button](target.md){ .pg-button .pg-button--primary },
<mark style="background:#ffd54f">highlighted</mark> and <span style="color:#b00020">coloured</span>
text, plus a literal <kbd>Ctrl</kbd> that no node models.

An image: ![alt text](media/static.svg){ width="480" .zoomable } and one with a
title ![plain](media/static.svg "Tooltip").
`,
  ),
  synthetic(
    "blocks",
    `- tight one
- tight two

* loose one

* loose two

3. third
4. fourth

> A quote with **emphasis**.
>
> Second paragraph.

---

\`\`\`ts
const x: number = 1;

const y = \`template\`;
\`\`\`

| Left | Centre | Right | Plain |
|:---|:---:|---:|---|
| a | b | c | d |
| \`x\\|y\` | [l](a.md) | **bold** | |
`,
  ),
  synthetic(
    "tabs with a nested admonition and fence",
    `=== "Python"

    !!! note "Inside a tab"

        \`\`\`python
        def main() -> None:
            print("hi")

            print("after a blank line")
        \`\`\`

        A paragraph after the fence.

=== "Rust"

    Plain body text.

    | A | B |
    |---|---|
    | 1 | 2 |
`,
  ),
  synthetic(
    "admonitions",
    `!!! note "Heads up"
    With a title.

!!! warning
    Title omitted, so core capitalises the kind.

!!! quote ""
    An explicitly empty title.

??? tip "Collapsible"
    Body of a collapsible admonition.
`,
  ),
  /**
   * Every kind, both markers, titled and not.
   *
   * The redesign gave each kind a glyph, an ink and a ground of its own, none of which the
   * markdown knows about — so the thing that has to be proved is that it still *doesn't*: seven
   * kinds × `!!!`/`???` × title/no title must come back as the bytes they went in as. An omitted
   * title is the case with a trap in it, because core resolves it to the capitalised kind and the
   * serializer has to recognise that and write nothing.
   */
  synthetic(
    "every admonition kind, titled, untitled and collapsible",
    `${["note", "tip", "info", "warning", "danger", "example", "quote"]
      .flatMap((kind) => [
        `!!! ${kind}\n    Untitled ${kind}: the title resolves to the kind.`,
        `!!! ${kind} "A ${kind} with a title"\n    Titled ${kind}.`,
        `??? ${kind} "Collapsible ${kind}"\n    Collapsible, titled.`,
        `??? ${kind}\n    Collapsible, untitled.`,
      ])
      .join("\n\n")}
`,
  ),
  synthetic(
    "snippets",
    `Before.

--8<-- "snippets/hello.py:main"

=== "Rust"

    --8<-- "../outside/hello.rs"

After.
`,
  ),
  synthetic(
    "kineglyph figures",
    `<figure class="kg" data-scene="scenes/demo.mjs" data-controls="false" data-readout="false"></figure>

<figure class="kg" data-scene="scenes/lab.mjs" data-instrument="true"><figcaption>An instrument, opted in.</figcaption></figure>

<figure class="kg" id="inline-demo"><script type="text/kineglyph">
export default { id: "inline-demo" };
</script></figure>

<figure class="kg" data-static="media/static.svg"><img src="media/static.svg" alt="static"></figure>
`,
  ),
  /**
   * The attribute shapes hand-written `<model-viewer>` and `<figure>` markup actually uses, each
   * of which the serializer once flattened into a canonical form of its own:
   *
   *  - a modelled attribute (`src`, `alt`) written *after* an unmodelled one, so re-emitting the
   *    modelled ones first reorders the tag — the defect that made Nucleation's landing page fail;
   *  - a bare boolean (`camera-controls`), which is not the same bytes as `camera-controls=""`;
   *  - single quotes, and a value that contains a double quote only single quotes can hold;
   *  - an unquoted value;
   *  - attributes split across lines (with the closing `>` kept off column one, where markdown
   *    would read it as a blockquote), and doubled spaces between them;
   *  - a self-closing tag, which has no closing tag to write;
   *  - fallback content inside the element, which no attribute models;
   *  - a `<figure markdown="span">` carrying an `id` and a `class` the node does not model.
   */
  synthetic(
    "attribute shapes, kept as written",
    `<model-viewer class="nu-model" src="media/a.glb" alt="Written after the class" camera-controls="" touch-action="pan-y"></model-viewer>

<model-viewer src="media/b.glb" camera-controls autoplay ar></model-viewer>

<model-viewer src='media/c.glb' alt='He said "hello"' loading=lazy></model-viewer>

<model-viewer
  src="media/d.glb"
  alt="Across several lines"
  reveal="interaction"></model-viewer>

<model-viewer src="media/e.glb"  alt="Two spaces before this" ></model-viewer>

<model-viewer src="media/f.glb" alt="Self-closing" />

<model-viewer src="media/g.glb" alt="With a poster"><img slot="poster" src="media/poster.png" alt="Poster"></model-viewer>

<figure markdown="span" id="plan" class="wide">
  ![A figure with attributes of its own](media/static.svg){ width="480" }
  <figcaption>Kept.</figcaption>
</figure>

<figure class="kg" data-scene="scenes/demo.mjs" id="scene-first" data-static="media/static.svg" hidden></figure>
`,
  ),
  synthetic(
    "html figures, model viewer and raw html",
    `<figure markdown="span">
  ![A captioned image](media/static.svg){ width="480" }
  <figcaption>The caption.</figcaption>
</figure>

<figure markdown="span">
  ![No caption, no width](media/static.svg)
</figure>

<model-viewer src="media/model.glb" alt="A model" camera-controls="" auto-rotate=""></model-viewer>

<div class="callout">
  <p>Raw HTML no node models.</p>
</div>
`,
  ),
];

const FIXTURE: readonly Source[] = ["index.md", "guide/tabs.md", "guide/figures.md"].map(fixturePage);
const NUCLEATION: readonly Source[] = ["index.md", "features/basics.md"].map(nucleationPage);

/**
 * The live demo's seed, held to the same guarantee as everything else.
 *
 * These are the first three files most people ever open in this editor, and they are seeded from a
 * TypeScript module rather than from disk — so nothing else in the suite would ever notice if a
 * line of that seed stopped surviving a save. Only the markdown pages: `article.yaml` is YAML, and
 * the round trip is about the dialect.
 */
const DEMO: readonly Source[] = Object.entries(DEMO_SEED)
  .filter(([path]) => path.endsWith(".md"))
  .map(([path, markdown]) => synthetic(`demo seed: ${path}`, markdown));

// ---------------------------------------------------------------------------------------------
// The guarantee
// ---------------------------------------------------------------------------------------------

describe.each([...FIXTURE, ...NUCLEATION, ...DEMO, ...SYNTHETIC])("round trip: $name", (source) => {
  it("serializes to a fixed point after one pass", () => {
    const once = serialize(source.markdown);
    expectSame(serialize(once), once, "second pass changed the markdown");
  });

  it("re-parses to the same document", () => {
    const before = parseMarkdown(source.markdown).doc.toJSON();
    const after = parseMarkdown(serialize(source.markdown)).doc.toJSON();
    expect(after).toEqual(before);
  });

  it("renders byte-identical HTML", async () => {
    const before = await html(source, source.markdown);
    const after = await html(source, serialize(source.markdown));
    expectSame(after, before, "rendered HTML changed");
  });

  /**
   * The strongest form, and the one a WYSIWYG editor is actually judged by: opening a hand-written
   * file and saving it without touching anything gives back the same bytes. Identical HTML is not
   * enough on its own — a diff nobody asked for is still a diff in the author's git history.
   */
  it("round-trips to the same bytes", () => {
    expectSame(serialize(source.markdown), source.markdown, "markdown changed");
  });
});

describe("normalisation footprint", () => {
  it.each(["index.md", "features/basics.md"])("reports how far serialize(parse(md)) drifts from Nucleation's %s", (page) => {
    const source = nucleationPage(page);
    const round = serialize(source.markdown);
    const diff = unifiedDiff(source.markdown, round).split("\n").filter((l) => l.startsWith("- ") || l.startsWith("+ "));
    // Informational: the guarantee is about rendered HTML, not about byte equality with the source.
    console.log(`[roundtrip] ${source.name}: ${source.markdown.length} → ${round.length} chars, ${diff.length} changed lines`);
    if (diff.length > 0) console.log(diff.join("\n"));
    expect(round.length).toBeGreaterThan(0);
  });
});
