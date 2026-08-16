import { Extension, getSchema, type Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Admonition, FigureImage, FigureKg, HtmlBlock, ModelViewer, Snippet, Tab, Tabs } from "./nodes.js";

/**
 * Headings carry the id the *author wrote* (`## Title {#custom}`), never the one core's anchors
 * rule derives from the text — a generated id is a rendering detail and must not be written back
 * into the markdown. `null` therefore means "slug it at render time", which is the common case.
 */
const HeadingId = Extension.create({
  name: "paginaHeadingId",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          explicitId: {
            default: null,
            parseHTML: (element: HTMLElement): string | null => element.getAttribute("id"),
            renderHTML: (attrs: Record<string, unknown>): Record<string, string> => (typeof attrs["explicitId"] === "string" ? { id: attrs["explicitId"] } : {}),
          },
        },
      },
    ];
  },
});

/** `|:--|--:|` column alignment; TipTap's table cells model spans and widths but not alignment. */
const CellAlign = Extension.create({
  name: "paginaCellAlign",
  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement): string | null => element.style.textAlign || null,
            renderHTML: (attrs: Record<string, unknown>): Record<string, string> => (typeof attrs["align"] === "string" ? { style: `text-align:${attrs["align"]}` } : {}),
          },
        },
      },
    ];
  },
});

/** `![alt](src){ width="480" .cls }` — markdown-it-attrs' extras have to survive the round trip. */
const ImageAttrs = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      class: { default: null },
    };
  },
});

/** `[text](href){ .pg-button }` and `[text](href "title")` — same reason as `ImageAttrs`. */
const LinkAttrs = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
      class: { default: null },
    };
  },
});

/**
 * Every extension the document model uses. StarterKit's own Link is switched off in favour of
 * `LinkAttrs`; leaving both on would register the `link` mark twice.
 *
 * Text colour is TipTap's standard `textStyle` mark carrying a `color` attribute (the `Color`
 * extension), not a separate `textColor` mark as the design sketch named it — the sketch predates
 * the choice of TipTap 3, whose Color extension is defined that way and whose commands the UI in
 * plan B will use. Highlight is multicolor, so `<mark style="background:…">` keeps its colour.
 */
export function editorExtensions(): Extensions {
  return [
    StarterKit.configure({ link: false, codeBlock: { languageClassPrefix: "language-" } }),
    HeadingId,
    CellAlign,
    LinkAttrs.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
    // Markdown images are inline: `text ![a](b) text` is one paragraph, and even a lone image sits
    // inside one. TipTap's default (a block node) would make such a paragraph unrepresentable.
    ImageAttrs.configure({ inline: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    Tabs,
    Tab,
    Admonition,
    Snippet,
    FigureKg,
    FigureImage,
    ModelViewer,
    HtmlBlock,
  ];
}

let cached: Schema | undefined;

/** The ProseMirror schema for pagina's markdown dialect. DOM-free: safe in Node and in workers. */
export function getEditorSchema(): Schema {
  return (cached ??= getSchema(editorExtensions()));
}
