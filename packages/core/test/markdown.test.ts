import { describe, expect, it } from "vitest";
import { createMarkdown, renderMarkdown } from "../src/markdown.js";
import { expandSnippets } from "../src/plugins/snippets.js";
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

describe("admonitions", () => {
  it("renders !!! with a title and ??? as details", () => {
    expect(renderMarkdown(md, `!!! note "Heads up"\n    Body **here**.`).html)
      .toContain(`<aside class="pg-admonition pg-admonition--note"><p class="pg-admonition__title">Heads up</p>`);
    expect(renderMarkdown(md, `!!! warning\n    B`).html).toContain(`pg-admonition__title">Warning</p>`);
    expect(renderMarkdown(md, `??? tip "More"\n    B`).html).toMatch(/<details[^>]*><summary>More<\/summary>/);
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
  it("passes raw HTML through", () => {
    expect(renderMarkdown(md, `<figure class="kg" data-scene="x.mjs"></figure>`).html).toContain(`<figure class="kg"`);
  });
  it("supports {.class key=val} attributes on links and images", () => {
    const h = renderMarkdown(md, '[x](y.md){ .pg-button }\n\n![a](b.png){ width="480" }').html;
    expect(h).toContain('class="pg-button"');
    expect(h).toContain('width="480"');
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
