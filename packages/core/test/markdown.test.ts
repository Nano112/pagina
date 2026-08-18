import { describe, expect, it } from "vitest";
import { createMarkdown, renderMarkdown } from "../src/markdown.js";
import { expandSnippets } from "../src/plugins/snippets.js";
import { ADMONITION_KINDS } from "../src/plugins/admonition.js";
import type { ContentFs } from "../src/types.js";

const md = createMarkdown();

function memFs(files: Record<string, string>): ContentFs {
  const norm = (p: string) => p.replace(/^\.\//, "").split("/").filter((s) => s !== ".").reduce<string[]>((a, s) => (s === ".." ? (a.pop(), a) : (a.push(s), a)), []).join("/");
  return {
    read: async (p) => { const k = norm(p); if (!(k in files)) throw new Error(`ENOENT ${p}`); return files[k]!; },
    readBinary: async (p) => new TextEncoder().encode(files[norm(p)] ?? ""),
    exists: async (p) => norm(p) in files,
    list: async () => Object.keys(files),
  };
}

describe("expandSnippets", () => {
  const fs = memFs({
    "snippets/a.py": "# --8<-- [start:x]\n    print(1)\n    print(2)\n# --8<-- [end:x]\nprint(3)\n",
    "outside/b.rs": "fn main() {}\n",
    "crlf.py": "line1\r\nline2\r\n",
  });
  it("includes a named section, dedented then re-indented to the directive", async () => {
    const r = await expandSnippets(`    \`\`\`python\n    --8<-- "snippets/a.py:x"\n    \`\`\``, { fs, roots: ["."], pagePath: "index.md" });
    expect(r.text).toBe("    ```python\n    print(1)\n    print(2)\n    ```");
    expect(r.diagnostics).toEqual([]);
  });
  it("searches roots in order and includes whole files", async () => {
    const r = await expandSnippets(`--8<-- "b.rs"`, { fs, roots: [".", "outside"], pagePath: "index.md" });
    expect(r.text).toBe("fn main() {}");
  });
  it("reports missing files and sections", async () => {
    const r = await expandSnippets(`--8<-- "nope.py"\n--8<-- "snippets/a.py:zzz"`, { fs, roots: ["."], pagePath: "p.md" });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["snippet-missing", "snippet-missing"]);
    expect(r.text).toContain("<!-- snippet missing");
  });
  it("normalizes CRLF line endings so re-indented lines carry no stray \\r", async () => {
    const r = await expandSnippets(`  --8<-- "crlf.py"`, { fs, roots: ["."], pagePath: "index.md" });
    expect(r.text).toBe("  line1\n  line2");
  });
});

describe("tabs", () => {
  it("renders consecutive === blocks as one tab group with rendered bodies", () => {
    const src = `=== "Python"\n\n    \`\`\`python\n    x = 1\n    \`\`\`\n\n=== "Rust"\n\n    let x = 1;\n\nAfter.`;
    const { html } = renderMarkdown(md, src);
    expect(html.match(/data-pg-tabs/g)).toHaveLength(1);
    expect(html).toContain(`role="tab" aria-selected="true"`);
    expect(html).toContain(">Python<");
    expect(html).toContain(`<code class="language-python">`);
    expect(html).toContain("<p>let x = 1;</p>");
    expect(html).toContain("<p>After.</p>");
  });
});

describe("live Kineglyph fences", () => {
  const source = `import { defineScene } from "kineglyph";\nexport default defineScene({});`;
  it("renders a live fence as a prerenderable inline figure", () => {
    const html = renderMarkdown(md, `\`\`\`kineglyph live view=preview height=520 id=editable autoplay=true\n${source}\n\`\`\``).html;
    expect(html).toContain('class="kg kg-lab"');
    expect(html).toContain("data-kineglyph-lab");
    expect(html).toContain('data-view="preview"');
    expect(html).toContain('data-height="520"');
    expect(html).toContain('id="editable"');
    expect(html).toContain('data-autoplay="true"');
    expect(html).toContain(`<script type="text/kineglyph">${source}</script>`);
  });
  it("keeps ordinary Kineglyph fences as highlighted code", () => {
    const html = renderMarkdown(md, `\`\`\`kineglyph\n${source}\n\`\`\``).html;
    expect(html).toContain('<code class="language-kineglyph">');
    expect(html).not.toContain("data-kineglyph-lab");
  });
  it("falls back safely for unsupported metadata", () => {
    const html = renderMarkdown(md, `\`\`\`kineglyph live view=sideways height=9999 id="not an id"\n${source}\n\`\`\``).html;
    expect(html).toContain('data-view="split"');
    expect(html).not.toContain("data-height");
    expect(html).not.toContain('id="not an id"');
  });
});

describe("admonitions", () => {
  it("renders !!! with a title and ??? as details", () => {
    const note = renderMarkdown(md, `!!! note "Heads up"\n    Body **here**.`).html;
    expect(note).toContain(`<aside class="pg-admonition pg-admonition--note"><p class="pg-admonition__title">`);
    expect(note).toContain(`<span class="pg-admonition__label">Heads up</span>`);
    expect(renderMarkdown(md, `!!! warning\n    B`).html).toContain(`<span class="pg-admonition__label">Warning</span>`);
    expect(renderMarkdown(md, `??? tip "More"\n    B`).html)
      .toMatch(/<details class="[^"]*pg-admonition--collapsible"><summary class="pg-admonition__title">/);
  });

  /**
   * The kind has to be *legible*, not merely present in a class name.
   *
   * A stripe in a colour is what `danger` and `note` used to have in common, and it is the whole
   * of what a reader skimming, or a reader who cannot separate the hues, was given. Each kind
   * therefore carries a glyph of its own and a label, and the glyphs must actually differ.
   */
  it("gives every kind its own glyph and a label a reader can see", () => {
    const glyphs = new Map<string, string>();
    for (const kind of ADMONITION_KINDS) {
      const html = renderMarkdown(md, `!!! ${kind}\n    B`).html;
      expect(html, kind).toContain(`pg-admonition--${kind}`);
      expect(html, kind).toContain(`<span class="pg-admonition__label">${kind.charAt(0).toUpperCase()}${kind.slice(1)}</span>`);
      const icon = /<svg class="pg-admonition__icon"[^>]*>([\s\S]*?)<\/svg>/.exec(html)?.[1];
      expect(icon, `${kind} has an icon`).toBeDefined();
      glyphs.set(kind, icon!);
    }
    expect(new Set(glyphs.values()).size, "every kind's glyph is distinct").toBe(ADMONITION_KINDS.length);
    // The glyph is decoration beside a label, so it must not be announced.
    expect(renderMarkdown(md, `!!! danger\n    B`).html).toContain('aria-hidden="true"');
  });

  it("keeps a kind it does not know, and falls back to note's glyph", () => {
    const html = renderMarkdown(md, `!!! spoiler "Ending"\n    B`).html;
    expect(html).toContain("pg-admonition--spoiler");
    expect(html).toContain(`<span class="pg-admonition__label">Ending</span>`);
    expect(html).toContain(`d="m15 5 4 4"`); // note's pencil
  });

  it("drops the label but keeps the bar for an explicitly empty title", () => {
    const aside = renderMarkdown(md, `!!! quote ""\n    B`).html;
    expect(aside).toContain("pg-admonition--untitled");
    expect(aside).not.toContain("pg-admonition__label");
    // A `<details>` with no summary cannot be opened, so the bar — and the chevron — stay.
    const details = renderMarkdown(md, `??? quote ""\n    B`).html;
    expect(details).toContain("<summary class=\"pg-admonition__title\">");
    expect(details).toContain("pg-admonition__chevron");
  });
});

describe("anchors + title", () => {
  it("ids headings, dedupes, and returns the first h1 as title", () => {
    const r = renderMarkdown(md, `# Basics\n\n## Build a beacon\n\n## Build a beacon\n\n### Sub & things`);
    expect(r.title).toBe("Basics");
    expect(r.headings).toEqual([
      { id: "basics", text: "Basics", level: 1 },
      { id: "build-a-beacon", text: "Build a beacon", level: 2 },
      { id: "build-a-beacon-2", text: "Build a beacon", level: 2 },
      { id: "sub-things", text: "Sub & things", level: 3 },
    ]);
    expect(r.html).toContain(`<h2 id="build-a-beacon-2">`);
  });
  it("keeps an explicit {#custom-id} instead of the slug", () => {
    const r = renderMarkdown(md, `## Custom Heading {#my-id}`);
    expect(r.html).toContain(`<h2 id="my-id">`);
    expect(r.headings[0]).toEqual({ id: "my-id", text: "Custom Heading", level: 2 });
  });
  it("keeps an explicit id out of a later slug's way", () => {
    const r = renderMarkdown(md, `## Later {#later}\n\n## Later`);
    expect(r.headings.map((h) => h.id)).toEqual(["later", "later-2"]);
  });
  it("lists headings nested in tabs and admonitions in document order", () => {
    const r = renderMarkdown(md, `# A\n\n=== "T"\n\n    ## Inside\n\n## After`);
    expect(r.headings.map((h) => h.id)).toEqual(["a", "inside", "after"]);
    const r2 = renderMarkdown(md, `# A\n\n!!! note "N"\n\n    ## Inside\n\n## After`);
    expect(r2.headings.map((h) => h.id)).toEqual(["a", "inside", "after"]);
  });
  it("dedupes slugs in document order across tab and admonition bodies", () => {
    // Before tabs/admonitions emitted structured tokens their bodies were rendered during the
    // outer *block parse*, so a nested heading claimed the bare slug and the earlier outer
    // heading got the `-2` suffix. Now every heading is deduped where it appears.
    const r = renderMarkdown(md, `## Same\n\n=== "T"\n\n    ## Same\n\n!!! note\n\n    ## Same\n`);
    expect(r.headings.map((h) => h.id)).toEqual(["same", "same-2", "same-3"]);
  });
  it("passes raw HTML through", () => {
    expect(renderMarkdown(md, `<figure class="kg" data-scene="x.mjs"></figure>`).html).toContain(`<figure class="kg"`);
  });
  it("supports {.class key=val} attributes on links and images", () => {
    const h = renderMarkdown(md, '[x](y.md){ .pg-button }\n\n![a](b.png){ width="480" }').html;
    expect(h).toContain('class="pg-button"');
    expect(h).toContain('width="480"');
  });
});

describe("pgAnchors env flag", () => {
  it("assigns heading ids by default", () => {
    const headings = md.parse("# One\n\n## Two\n", {}).filter((t) => t.type === "heading_open");
    expect(headings.map((t) => t.attrGet("id"))).toEqual(["one", "two"]);
  });

  it("assigns none when the parse opts out with pgAnchors: false", () => {
    const headings = md.parse("# One\n\n## Two {#kept}\n", { pgAnchors: false }).filter((t) => t.type === "heading_open");
    // Only markdown-it-attrs' explicit `{#kept}` survives, which is what lets the editor tell an
    // author's id apart from a generated slug.
    expect(headings.map((t) => t.attrGet("id"))).toEqual([null, "kept"]);
  });

  it("leaves the instance unchanged for the next parse", () => {
    md.parse("# One\n", { pgAnchors: false });
    expect(md.parse("# One\n", {}).find((t) => t.type === "heading_open")!.attrGet("id")).toBe("one");
  });
});

describe("md_in_html", () => {
  it('renders markdown="span" content inline, stripping the attribute', () => {
    const src = '<figure markdown="span">\n  ![A](../media/x.gif){ width="480" }\n  <figcaption>Cap.</figcaption>\n</figure>';
    const h = renderMarkdown(md, src).html;
    expect(h).toContain('<img src="../media/x.gif" alt="A" width="480">');
    expect(h).toContain("<figcaption>Cap.</figcaption>");
    expect(h).not.toContain("![A]");
    expect(h).not.toContain('markdown="span"');
  });
  it('renders markdown="1" content as block-level markdown', () => {
    const h = renderMarkdown(md, '<div markdown="1">\n\n**bold**\n\n</div>').html;
    expect(h).toContain("<p><strong>bold</strong></p>");
  });
  it("leaves an html_block without a markdown attribute untouched", () => {
    const h = renderMarkdown(md, `<figure class="kg" data-scene="x.mjs"></figure>`).html;
    expect(h).toContain(`<figure class="kg" data-scene="x.mjs"></figure>`);
  });
});
