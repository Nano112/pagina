import { describe, expect, it } from "vitest";
import { isSelfClosing, parseAttributes, parseAttrSource, renderAttrs } from "../src/model/attr-source.js";
import { parseMarkdown, serializeMarkdown } from "../src/model/index.js";

/**
 * `roundtrip.test.ts` proves that an *untouched* file comes back unchanged. This proves the other
 * half, which round-tripping cannot reach: when the editor really does change something, only that
 * thing changes. A tag's other attributes keep their place, their quotes and their spacing, because
 * the serializer patches the author's text rather than regenerating it.
 */

describe("parseAttrSource", () => {
  it("keeps each attribute's own slice, including the whitespace in front of it", () => {
    const { attrs, tail } = parseAttrSource(` a="1"  b='2'\n  c=3 d `);
    expect(attrs.map((a) => [a.name, a.value])).toEqual([["a", "1"], ["b", "2"], ["c", "3"], ["d", ""]]);
    expect(attrs.map((a) => a.source).join("") + tail).toBe(` a="1"  b='2'\n  c=3 d `);
    expect(attrs[1]!.lead).toBe("  ");
  });

  it("leaves a self-closing slash in the tail rather than reading it as an attribute", () => {
    const { attrs, tail } = parseAttrSource(` src="a.glb" />`.slice(0, -1));
    expect(attrs.map((a) => a.name)).toEqual(["src"]);
    expect(tail).toBe(" /");
    expect(isSelfClosing(` src="a.glb" /`)).toBe(true);
    expect(isSelfClosing(` src="a.glb"`)).toBe(false);
    expect(isSelfClosing(null)).toBe(false);
  });

  it("resolves a repeated name to its first occurrence, as HTML does", () => {
    expect(parseAttributes(`id="first" id="second"`)).toEqual({ id: "first" });
  });
});

describe("renderAttrs", () => {
  const source = ` class="nu-model" src='a.glb' camera-controls  touch-action="pan-y"`;
  const now = (over: Record<string, string> = {}): [string, string][] =>
    Object.entries({ class: "nu-model", src: "a.glb", "camera-controls": "", "touch-action": "pan-y", ...over });

  it("replays the author's text byte for byte when nothing changed", () => {
    expect(renderAttrs(source, now())).toBe(source);
  });

  it("rewrites one value in place and leaves every other byte alone", () => {
    expect(renderAttrs(source, now({ src: "b.glb" }))).toBe(` class="nu-model" src="b.glb" camera-controls  touch-action="pan-y"`);
  });

  it("appends an attribute the author did not write, and drops one they did", () => {
    expect(renderAttrs(source, [...now(), ["alt", "New"]])).toBe(`${source} alt="New"`);
    expect(renderAttrs(source, now().filter(([n]) => n !== "camera-controls"))).toBe(` class="nu-model" src='a.glb'  touch-action="pan-y"`);
  });

  it("keeps attributes it was not told about only when asked to", () => {
    expect(renderAttrs(` markdown="span" id="plan"`, [], { keepUnknown: true })).toBe(` markdown="span" id="plan"`);
    expect(renderAttrs(` markdown="span" id="plan"`, [])).toBe("");
  });

  it("falls back to a canonical form for a node the UI created", () => {
    expect(renderAttrs(null, [["src", "a.glb"], ["alt", "A model"]])).toBe(` src="a.glb" alt="A model"`);
  });

  it("escapes a quote in a value it has to rewrite, and never touches one it does not", () => {
    expect(renderAttrs(` alt='He said "hi"'`, [["alt", 'He said "hi"']])).toBe(` alt='He said "hi"'`);
    expect(renderAttrs(` alt="plain"`, [["alt", 'Now with "quotes"']])).toBe(` alt="Now with &quot;quotes&quot;"`);
  });
});

describe("editing a page", () => {
  /** Parse, change one attribute the way a node view's `updateAttributes` would, serialize. */
  const edit = (markdown: string, change: Record<string, unknown>): string => {
    const { doc } = parseMarkdown(markdown);
    const patched = doc.type.schema.nodeFromJSON({
      ...doc.toJSON(),
      content: (doc.toJSON() as { content: Record<string, unknown>[] }).content.map((node) =>
        node["type"] === "modelViewer" ? { ...node, attrs: { ...(node["attrs"] as object), ...change } } : node,
      ),
    });
    return serializeMarkdown(patched);
  };

  it("changes the src the reader asked to change, and nothing else about the tag", () => {
    const before = `<model-viewer class="nu-model" src="media/a.glb" alt="A model" camera-controls="" touch-action="pan-y"></model-viewer>\n`;
    expect(edit(before, { src: "media/b.glb" })).toBe(
      `<model-viewer class="nu-model" src="media/b.glb" alt="A model" camera-controls="" touch-action="pan-y"></model-viewer>\n`,
    );
  });

  it("adds an alt where the author wrote none, at the end rather than in the middle", () => {
    const before = `<model-viewer class="nu-model" src="media/a.glb" camera-controls></model-viewer>\n`;
    expect(edit(before, { alt: "Described at last" })).toBe(
      `<model-viewer class="nu-model" src="media/a.glb" camera-controls alt="Described at last"></model-viewer>\n`,
    );
  });
});
