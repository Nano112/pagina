import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { parseMarkdown } from "../src/model/parser.js";
import { INNER_HTML_KEY } from "../src/model/raw-html.js";

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const fixture = (name: string): string => readFileSync(repo(`packages/core/test/fixture/${name}`), "utf8");
const nucleation = (name: string): string => readFileSync(`/Users/harrison/RustroverProjects/Nucleation/docs/${name}`, "utf8");

/** Every node in the document, in document order, excluding the doc node itself. */
function nodes(doc: ProseMirrorNode): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  doc.descendants((node) => {
    out.push(node);
    return true;
  });
  return out;
}

const ofType = (doc: ProseMirrorNode, type: string): ProseMirrorNode[] => nodes(doc).filter((n) => n.type.name === type);
/** The shape of the document's top level: `[[nodeName, textContent], …]`. */
const outline = (doc: ProseMirrorNode): string[] => doc.children.map((n) => n.type.name);

describe("parseMarkdown — fixture pages", () => {
  it("parses index.md into a heading, a paragraph with links and an admonition", () => {
    const { doc, frontMatter } = parseMarkdown(fixture("index.md"));
    expect(frontMatter).toBeUndefined();
    expect(outline(doc)).toEqual(["heading", "paragraph", "admonition"]);

    const heading = doc.child(0);
    expect(heading.attrs["level"]).toBe(1);
    expect(heading.attrs["explicitId"]).toBeNull();
    expect(heading.textContent).toBe("Fixture");

    const hrefs = ofType(doc, "paragraph")
      .flatMap((p) => p.content.content)
      .flatMap((n) => n.marks.filter((m) => m.type.name === "link").map((m) => m.attrs["href"]));
    expect(hrefs).toEqual(["guide/tabs.md", "guide/figures.md#second"]);

    const admonition = doc.child(2);
    expect(admonition.attrs).toMatchObject({ kind: "note", title: "Heads up", collapsible: false });
    expect(admonition.child(0).type.name).toBe("paragraph");
    expect(admonition.textContent).toBe("Admonitions render as <aside>.");
    const code = admonition.child(0).children.filter((n) => n.marks.some((m) => m.type.name === "code"));
    expect(code.map((n) => n.text)).toEqual(["<aside>"]);
  });

  it("parses guide/tabs.md into a tabs group whose panels hold code blocks", () => {
    const { doc } = parseMarkdown(fixture("guide/tabs.md"));
    expect(outline(doc)).toEqual(["heading", "tabs", "paragraph"]);

    const tabs = doc.child(1);
    expect(tabs.childCount).toBe(2);
    expect(tabs.children.map((t) => t.attrs["label"])).toEqual(["Python", "Rust"]);
    for (const tab of tabs.children) {
      expect(tab.child(0).type.name).toBe("codeBlock");
    }
    expect(tabs.child(0).child(0).attrs["language"]).toBe("python");
    expect(tabs.child(0).child(0).textContent).toBe('--8<-- "snippets/hello.py:main"');
    expect(tabs.child(1).child(0).attrs["language"]).toBe("rust");
  });

  it("parses guide/figures.md into the three kinds of Kineglyph figure", () => {
    const { doc } = parseMarkdown(fixture("guide/figures.md"));
    expect(outline(doc)).toEqual(["heading", "heading", "figureKg", "heading", "figureKg", "figureKg"]);

    const [module, inline, still] = ofType(doc, "figureKg");
    expect(module!.attrs).toMatchObject({ kind: "module", scene: "../scenes/demo.mjs", source: null, id: null });
    expect(inline!.attrs["kind"]).toBe("inline");
    expect(inline!.attrs["id"]).toBe("inline-demo");
    expect(inline!.attrs["source"]).toContain('defineScene({ schemaVersion: 2, id: "inline-demo"');
    expect(still!.attrs).toMatchObject({ kind: "static", static: "../media/static.svg" });
    // The `<img>` inside the static figure is not modelled by an attribute, so it is kept verbatim.
    expect(JSON.parse(String(still!.attrs["extraAttrs"]))[INNER_HTML_KEY]).toBe('<img src="../media/static.svg" alt="static">');
  });
});

describe("parseMarkdown — one synthetic sample per custom node", () => {
  it("tabs and tab", () => {
    const { doc } = parseMarkdown('=== "One"\n\n    first\n\n=== "Two"\n\n    second\n');
    const tabs = doc.child(0);
    expect(tabs.type.name).toBe("tabs");
    expect(tabs.children.map((t) => [t.type.name, t.attrs["label"], t.textContent])).toEqual([
      ["tab", "One", "first"],
      ["tab", "Two", "second"],
    ]);
  });

  it("admonition, including the collapsible marker", () => {
    const { doc } = parseMarkdown('!!! warning "Careful"\n    body\n\n??? tip\n    more\n');
    expect(doc.child(0).attrs).toMatchObject({ kind: "warning", title: "Careful", collapsible: false });
    expect(doc.child(1).attrs).toMatchObject({ kind: "tip", title: "Tip", collapsible: true });
    expect(doc.child(1).textContent).toBe("more");
  });

  it("snippet", () => {
    const { doc } = parseMarkdown('Before\n\n--8<-- "shared/note.md:intro"\n\nAfter\n');
    expect(outline(doc)).toEqual(["paragraph", "snippet", "paragraph"]);
    expect(doc.child(1).attrs["ref"]).toBe("shared/note.md:intro");
  });

  it("figureKg — inline source, module scene and static asset", () => {
    const { doc } = parseMarkdown(
      '<figure class="kg" id="a" data-controls="false"><script type="text/kineglyph">export default 1;</script></figure>\n\n' +
        '<figure class="kg kg--wide" data-scene="s.mjs" data-lazy="true"></figure>\n\n' +
        '<figure class="kg" data-static="a.svg"></figure>\n',
    );
    const [inline, module, still] = ofType(doc, "figureKg");
    expect(inline!.attrs).toMatchObject({ kind: "inline", id: "a", controls: "false", source: "export default 1;" });
    expect(module!.attrs).toMatchObject({ kind: "module", scene: "s.mjs" });
    expect(JSON.parse(String(module!.attrs["extraAttrs"]))).toEqual({ class: "kg kg--wide", "data-lazy": "true" });
    expect(still!.attrs).toMatchObject({ kind: "static", static: "a.svg", extraAttrs: null });
  });

  it("figureImage", () => {
    const { doc } = parseMarkdown('<figure markdown="span">\n  ![Alt text](img/a.png){ width="480" }\n  <figcaption>The caption.</figcaption>\n</figure>\n');
    expect(doc.child(0).type.name).toBe("figureImage");
    expect(doc.child(0).attrs).toMatchObject({ src: "img/a.png", alt: "Alt text", width: "480", caption: "The caption." });
  });

  it("modelViewer", () => {
    const { doc } = parseMarkdown('<model-viewer src="media/x.glb" alt="A model" camera-controls auto-rotate></model-viewer>\n');
    expect(doc.child(0).type.name).toBe("modelViewer");
    expect(doc.child(0).attrs).toMatchObject({ src: "media/x.glb", alt: "A model" });
    expect(JSON.parse(String(doc.child(0).attrs["attrs"]))).toEqual({ "camera-controls": "", "auto-rotate": "" });
  });

  it("htmlBlock, for HTML the dialect does not model", () => {
    const { doc } = parseMarkdown('<div class="grid">\n  <p>raw</p>\n</div>\n');
    expect(doc.child(0).type.name).toBe("htmlBlock");
    expect(doc.child(0).attrs["html"]).toBe('<div class="grid">\n  <p>raw</p>\n</div>');
  });
});

describe("parseMarkdown — standard markdown", () => {
  it("keeps an author's explicit heading id and drops core's generated slug", () => {
    const { doc } = parseMarkdown("# Generated slug\n\n## Explicit {#custom-id}\n");
    expect(doc.child(0).attrs["explicitId"]).toBeNull();
    expect(doc.child(1).attrs["explicitId"]).toBe("custom-id");
  });

  it("returns front matter verbatim and keeps it out of the document", () => {
    const { doc, frontMatter } = parseMarkdown("---\ntitle: Page\ntags: [a, b]\n---\n\n# Body\n");
    expect(frontMatter).toBe("title: Page\ntags: [a, b]");
    expect(outline(doc)).toEqual(["heading"]);
  });

  it("parses lists, rules, blockquotes and fenced code", () => {
    const { doc } = parseMarkdown("- one\n- two\n\n1. first\n1. second\n\n---\n\n> quoted\n\n```ts\nconst a = 1;\n```\n");
    expect(outline(doc)).toEqual(["bulletList", "orderedList", "horizontalRule", "blockquote", "codeBlock"]);
    expect(doc.child(0).childCount).toBe(2);
    expect(doc.child(0).child(0).type.name).toBe("listItem");
    expect(doc.lastChild!.attrs["language"]).toBe("ts");
    expect(doc.lastChild!.textContent).toBe("const a = 1;");
  });

  it("parses tables into rows of cells that hold blocks", () => {
    const { doc } = parseMarkdown("| A | B |\n|:--|--:|\n| 1 | 2 |\n");
    const table = doc.child(0);
    expect(table.type.name).toBe("table");
    expect(table.children.map((r) => r.children.map((c) => c.type.name))).toEqual([
      ["tableHeader", "tableHeader"],
      ["tableCell", "tableCell"],
    ]);
    expect(table.child(0).child(0).attrs["align"]).toBe("left");
    expect(table.child(0).child(1).attrs["align"]).toBe("right");
    expect(table.child(1).child(0).child(0).type.name).toBe("paragraph");
    expect(table.child(1).textContent).toBe("12");
  });

  it("keeps image and link attributes written with markdown-it-attrs", () => {
    const { doc } = parseMarkdown('![Alt](a.png){ width="480" .wide }\n\n[Go](b.md){ .pg-button }\n');
    const image = ofType(doc, "image")[0]!;
    expect(image.attrs).toMatchObject({ src: "a.png", alt: "Alt", width: "480", class: "wide" });
    const link = doc.child(1).child(0).marks.find((m) => m.type.name === "link")!;
    expect(link.attrs).toMatchObject({ href: "b.md", class: "pg-button" });
  });

  it("parses emphasis, strong, strike and inline code as marks", () => {
    const { doc } = parseMarkdown("*a* **b** ~~c~~ `d`\n");
    const marks = doc.child(0).children.map((n) => n.marks.map((m) => m.type.name).join(",")).filter((m) => m !== "");
    expect(marks).toEqual(["italic", "bold", "strike", "code"]);
  });

  it("turns coloured inline HTML into highlight and text-colour marks", () => {
    const { doc } = parseMarkdown('<mark style="background:#ffd">lit</mark> and <span style="color: #f00">red</span>\n');
    const marked = doc.child(0).children.filter((n) => n.marks.length > 0);
    expect(marked.map((n) => [n.textContent, n.marks[0]!.type.name, n.marks[0]!.attrs["color"]])).toEqual([
      ["lit", "highlight", "#ffd"],
      ["red", "textStyle", "#f00"],
    ]);
  });

  it("keeps inline HTML it does not model as literal text", () => {
    const { doc } = parseMarkdown("a <kbd>b</kbd> c\n");
    expect(doc.child(0).textContent).toBe("a <kbd>b</kbd> c");
  });

  it("keeps soft line breaks as newlines rather than collapsing them to spaces", () => {
    const { doc } = parseMarkdown("one\ntwo\n");
    expect(doc.child(0).textContent).toBe("one\ntwo");
  });
});

describe("parseMarkdown — Nucleation pages", () => {
  it("parses docs/index.md, falling back to raw HTML only for the hero <figure>", () => {
    const { doc, frontMatter } = parseMarkdown(nucleation("index.md"));
    expect(frontMatter).toBe("title: Nucleation");
    const raw = ofType(doc, "htmlBlock");
    // The one genuinely raw block: the hero `<figure>` holding an `<img>` and a `<figcaption>`
    // written as HTML (no `markdown="span"`, no `class="kg"`), so no node models it.
    expect(raw).toHaveLength(1);
    expect(raw[0]!.attrs["html"]).toContain('<img src="media/hero.gif"');
    expect(ofType(doc, "figureKg")).toHaveLength(1);
    expect(ofType(doc, "figureKg")[0]!.attrs).toMatchObject({ kind: "module", scene: "scenes/formats-and-io.mjs", controls: "false", readout: "false" });
    expect(ofType(doc, "tabs")).toHaveLength(1);
    expect(ofType(doc, "admonition")[0]!.attrs).toMatchObject({ kind: "quote", title: "" });
  });

  it("parses docs/features/basics.md into three captioned images and seven tab groups", () => {
    const { doc } = parseMarkdown(nucleation("features/basics.md"));
    expect(ofType(doc, "figureImage")).toHaveLength(3);
    expect(ofType(doc, "tabs")).toHaveLength(7);
    expect(ofType(doc, "tabs").flatMap((t) => t.children.map((c) => c.attrs["label"]))).toEqual(
      Array.from({ length: 7 }, () => ["Python", "JavaScript", "Rust"]).flat(),
    );
    expect(ofType(doc, "htmlBlock")).toHaveLength(0);
    expect(ofType(doc, "figureImage")[0]!.attrs).toMatchObject({ src: "../media/readme/basics/beacon.gif", width: "480" });
    expect(ofType(doc, "figureImage")[0]!.attrs["caption"]).toBe("Nine gold blocks arrive in loop order, followed by the beacon.");
  });
});
