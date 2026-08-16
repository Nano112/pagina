import { describe, expect, it } from "vitest";
import { getEditorSchema } from "../src/model/schema.js";

describe("getEditorSchema", () => {
  const schema = getEditorSchema();

  it("declares every dialect node under its contract name", () => {
    for (const name of ["tabs", "tab", "admonition", "snippet", "figureKg", "figureImage", "modelViewer", "htmlBlock"]) {
      expect(schema.nodes[name], name).toBeDefined();
    }
  });

  it("declares the standard nodes and marks the parser targets", () => {
    for (const name of ["doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "codeBlock", "blockquote", "horizontalRule", "image", "table", "tableRow", "tableCell", "tableHeader", "hardBreak"]) {
      expect(schema.nodes[name], name).toBeDefined();
    }
    for (const name of ["bold", "italic", "strike", "code", "link", "highlight", "textStyle"]) {
      expect(schema.marks[name], name).toBeDefined();
    }
  });

  it("nests tabs, admonitions and table cells the way the dialect does", () => {
    expect(schema.nodes["tabs"]!.spec.content).toBe("tab+");
    expect(schema.nodes["tab"]!.spec.content).toBe("block+");
    expect(schema.nodes["admonition"]!.spec.content).toBe("block+");
    expect(schema.nodes["tableCell"]!.spec.content).toBe("block+");
  });

  it("makes the leaf figures atomic", () => {
    for (const name of ["snippet", "figureKg", "figureImage", "modelViewer", "htmlBlock"]) {
      expect(schema.nodes[name]!.isAtom, name).toBe(true);
    }
  });

  it("gives headings an explicitId that defaults to null", () => {
    expect(schema.nodes["heading"]!.createAndFill({ level: 2 })!.attrs["explicitId"]).toBeNull();
  });

  it("keeps markdown-it-attrs extras addressable on images and links", () => {
    expect(Object.keys(schema.nodes["image"]!.spec.attrs ?? {})).toEqual(expect.arrayContaining(["src", "alt", "title", "width", "class"]));
    expect(Object.keys(schema.marks["link"]!.spec.attrs ?? {})).toEqual(expect.arrayContaining(["href", "title", "class"]));
  });

  it("is a cached singleton", () => {
    expect(getEditorSchema()).toBe(schema);
  });
});
