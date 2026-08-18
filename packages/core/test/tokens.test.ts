import { describe, expect, it } from "vitest";
import type Token from "markdown-it/lib/token.mjs";
import { createMarkdown, renderMarkdown } from "../src/markdown.js";

const md = createMarkdown();
const shape = (tokens: Token[]) => tokens.map((t) => [t.type, t.nesting, t.level] as const);

describe("structured tokens", () => {
  it("emits a tabs group whose panel bodies are ordinary block tokens", () => {
    const src = `=== "Python"\n\n    \`\`\`python\n    x = 1\n    \`\`\`\n\n=== "Rust & <friends>"\n\n    let x = 1;\n`;
    const tokens = md.parse(src, {});
    expect(shape(tokens)).toEqual([
      ["pg_tabs_open", 1, 0],
      ["pg_tab_open", 1, 1],
      ["fence", 0, 2],
      ["pg_tab_close", -1, 1],
      ["pg_tab_open", 1, 1],
      ["paragraph_open", 1, 2],
      ["inline", 0, 3],
      ["paragraph_close", -1, 2],
      ["pg_tab_close", -1, 1],
      ["pg_tabs_close", -1, 0],
    ]);
    expect(tokens.filter((t) => t.type === "pg_tab_open").map((t) => t.attrGet("label"))).toEqual(["Python", "Rust & <friends>"]);
    expect(tokens[0]!.meta).toEqual({ labels: ["Python", "Rust & <friends>"], group: 1 });
    expect(tokens[1]!.meta).toEqual({ group: 1, index: 0 });
    expect(tokens[2]!.content).toBe("x = 1\n");
    // `map` stays in outer-document lines: tab 2 opens on line 6, its paragraph is on line 8.
    expect(tokens[0]!.map).toEqual([0, 10]);
    expect(tokens[4]!.map).toEqual([6, 10]);
    expect(tokens[5]!.map).toEqual([8, 9]);
  });

  it("emits an admonition with kind, resolved title, collapsible and blankLine, around body tokens", () => {
    const tokens = md.parse(`??? tip "More"\n\n    ## Inside\n\n    Body.\n`, {});
    expect(shape(tokens)).toEqual([
      ["pg_admonition_open", 1, 0],
      ["heading_open", 1, 1],
      ["inline", 0, 2],
      ["heading_close", -1, 1],
      ["paragraph_open", 1, 1],
      ["inline", 0, 2],
      ["paragraph_close", -1, 1],
      ["pg_admonition_close", -1, 0],
    ]);
    expect(tokens[0]!.attrs).toEqual([["kind", "tip"], ["title", "More"], ["collapsible", "true"], ["blankLine", "true"]]);
    expect(tokens[0]!.markup).toBe("???");
    expect(tokens[0]!.map).toEqual([0, 6]);
    expect(tokens[1]!.tag).toBe("h2");
    // A titleless `!!!` resolves the title from the kind, and is not collapsible.
    const plain = md.parse(`!!! warning\n\n    B\n`, {})[0]!;
    expect(plain.attrs).toEqual([["kind", "warning"], ["title", "Warning"], ["collapsible", "false"], ["blankLine", "true"]]);
    expect(plain.markup).toBe("!!!");
  });

  /**
   * `blankLine` records whether the author left a line between the marker and the body. It changes
   * no HTML — both forms render identically — and exists only so the editor can save a page back
   * in the shape it was written; the assertion is here because nothing downstream would notice.
   */
  it("records whether the admonition's body started on the next line or after a blank one", () => {
    const withBlank = md.parse(`!!! note\n\n    B\n`, {})[0]!;
    const without = md.parse(`!!! note\n    B\n`, {})[0]!;
    expect(withBlank.attrGet("blankLine")).toBe("true");
    expect(without.attrGet("blankLine")).toBe("false");
    expect(renderMarkdown(md, `!!! note\n\n    B\n`).html).toBe(renderMarkdown(md, `!!! note\n    B\n`).html);
  });

  it("nests a tab group inside an admonition inside a tab", () => {
    const src = `=== "Outer"\n\n    !!! note\n\n        Inner.\n`;
    expect(shape(md.parse(src, {}))).toEqual([
      ["pg_tabs_open", 1, 0],
      ["pg_tab_open", 1, 1],
      ["pg_admonition_open", 1, 2],
      ["paragraph_open", 1, 3],
      ["inline", 0, 4],
      ["paragraph_close", -1, 3],
      ["pg_admonition_close", -1, 2],
      ["pg_tab_close", -1, 1],
      ["pg_tabs_close", -1, 0],
    ]);
  });
});

describe("mdInHtml option", () => {
  const src = '<figure markdown="span">\n  ![A](../media/x.gif){ width="480" }\n  <figcaption>Cap.</figcaption>\n</figure>';

  it("is on by default", () => {
    expect(renderMarkdown(createMarkdown(), src).html).toContain('<img src="../media/x.gif" alt="A" width="480">');
  });

  it("leaves the block raw when disabled", () => {
    const off = createMarkdown({ mdInHtml: false });
    const tokens = off.parse(src, {});
    expect(tokens.map((t) => t.type)).toEqual(["html_block"]);
    expect(tokens[0]!.content).toBe(src);
    expect(renderMarkdown(off, src).html).toBe(src);
  });
});
