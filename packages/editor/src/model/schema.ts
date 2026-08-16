import { Extension, getSchema, type Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Code from "@tiptap/extension-code";
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

/**
 * Tight vs loose lists. markdown renders a tight list as `<li>text</li>` and a loose one (items
 * separated by blank lines) as `<li><p>text</p></li>`, but the two produce the *same* ProseMirror
 * document — list items hold `block+` either way — so without this attribute the distinction is
 * lost on the first save and the page's HTML changes. `prosemirror-markdown`'s list serializer
 * already reads `attrs.tight`; the parser fills it in from the source.
 */
const ListTight = Extension.create({
  name: "paginaListTight",
  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          tight: {
            default: true,
            parseHTML: (element: HTMLElement): boolean => element.querySelector(":scope > li > p") === null,
            // A rendering detail of the markdown, not of the DOM: lists always render as `<ul><li>`.
            renderHTML: (): Record<string, string> => ({}),
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

/**
 * A code span that other marks may wrap. TipTap's Code declares `excludes: "_"`, which drops every
 * other mark from the same text — so ``[`build/data`](guide.md)``, a shape Nucleation's index uses
 * ten times in one table, silently loses its link on parse. Markdown nests both `` **`a`** `` and
 * ``[`a`](b)`` happily, so there is nothing here to exclude. It is registered last in
 * `editorExtensions()` because mark rank follows schema order, and `prosemirror-markdown` treats
 * the last mark in a set as the innermost one — which is exactly what a code span must be.
 */
const InlineCode = Code.extend({ excludes: "" });

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
    StarterKit.configure({ link: false, code: false, codeBlock: { languageClassPrefix: "language-" } }),
    HeadingId,
    CellAlign,
    ListTight,
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
    // Last: mark rank follows this order, and a code span has to be the innermost mark.
    InlineCode,
  ];
}

let cached: Schema | undefined;

/** The ProseMirror schema for pagina's markdown dialect. DOM-free: safe in Node and in workers. */
export function getEditorSchema(): Schema {
  return (cached ??= getSchema(editorExtensions()));
}
