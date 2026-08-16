import { createMarkdown } from "@pagina/core";
import type MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { MarkdownParser, type ParseSpec } from "prosemirror-markdown";
import { getEditorSchema } from "./schema.js";
import { classifyHtmlBlock, classifyInlineHtml } from "./raw-html.js";

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const SNIPPET_RE = /^--8<--\s+"([^"]+)"$/;

export interface ParseResult {
  /** The document, in the schema `getEditorSchema()` returns. */
  readonly doc: ProseMirrorNode;
  /** The YAML between the opening `---` fences, verbatim, when the page had front matter. */
  readonly frontMatter?: string;
}

export interface ParseOptions {
  /**
   * The markdown-it instance to tokenise with. Defaults to `createMarkdown({ mdInHtml: false })`:
   * raw HTML blocks must stay raw so this module can classify them itself, and the dialect's
   * structured tokens (`pg_tabs_*`, `pg_admonition_*`) must be present.
   */
  readonly md?: MarkdownIt;
}

/**
 * The tokeniser the editor wants: pagina's dialect with raw HTML left raw. Heading ids are opted
 * out of per parse via the `pgAnchors: false` env flag, not by configuring the instance, so a
 * shared `MarkdownIt` can serve the renderer and the editor at once.
 */
export function createEditorMarkdown(): MarkdownIt {
  return createMarkdown({ mdInHtml: false });
}

let defaultMd: MarkdownIt | undefined;

// ---------------------------------------------------------------------------------------------
// Token pre-pass
// ---------------------------------------------------------------------------------------------

const token = (type: string, tag: string, nesting: 1 | 0 | -1): Token => new Token(type, tag, nesting);

const withMeta = (type: string, meta: unknown): Token => {
  const t = token(type, "", 0);
  t.meta = meta;
  return t;
};

type InlineMark = "highlight" | "textStyle";

const MARK_TOKEN: Record<InlineMark, string> = { highlight: "pg_highlight", textStyle: "pg_text_color" };
const closeMark = (mark: InlineMark): Token => token(`${MARK_TOKEN[mark]}_close`, "", -1);
const openMark = (mark: InlineMark, color: string | null): Token => {
  const t = withMeta(`${MARK_TOKEN[mark]}_open`, { color });
  t.nesting = 1;
  return t;
};

/**
 * Inline HTML → marks. `<mark …>text</mark>` and `<span style="color:…">text</span>` become
 * mark open/close tokens; every other `html_inline` token degrades to its literal text, because
 * the schema has no inline-HTML mark and silently dropping the author's markup would be worse.
 *
 * HTML nesting is not required to be well formed, but ProseMirror's mark stack is: closing a mark
 * that is not on top (`<mark>A<span>B</mark>C</span>`) means unwinding the marks above it, closing
 * it, and re-opening those — otherwise the stray tag survives as literal text in the document.
 */
function rewriteInline(children: readonly Token[]): Token[] {
  const out: Token[] = [];
  const open: { mark: InlineMark; color: string | null }[] = [];
  for (const child of children) {
    if (child.type === "softbreak") {
      // A soft break is a real newline in the source; " " would silently reflow the paragraph.
      const text = token("text", "", 0);
      text.content = "\n";
      out.push(text);
      continue;
    }
    if (child.type !== "html_inline") {
      out.push(child);
      continue;
    }
    const found = classifyInlineHtml(child.content);
    const literal = (): void => {
      const text = token("text", "", 0);
      text.content = child.content;
      out.push(text);
    };
    if (found === null) {
      literal();
      continue;
    }
    if (found.open) {
      out.push(openMark(found.mark, found.color));
      open.push({ mark: found.mark, color: found.color });
      continue;
    }
    // Only close a mark we opened; a stray `</span>` from hand-written HTML stays literal text.
    const at = open.findLastIndex((e) => e.mark === found.mark);
    if (at === -1) {
      literal();
      continue;
    }
    const above = open.slice(at + 1);
    for (let j = open.length - 1; j > at; j--) out.push(closeMark(open[j]!.mark));
    out.push(closeMark(found.mark));
    for (const entry of above) out.push(openMark(entry.mark, entry.color));
    open.splice(at, 1);
  }
  // An unbalanced open would leave the mark hanging over the rest of the paragraph.
  for (let i = open.length - 1; i >= 0; i--) out.push(closeMark(open[i]!.mark));
  return out;
}

/** The source of a `paragraph_open`/`inline`/`paragraph_close` run, or `null` for anything else. */
const loneParagraph = (tokens: readonly Token[], i: number): string | null => {
  if (tokens[i]?.type !== "paragraph_open") return null;
  const inline = tokens[i + 1];
  if (inline?.type !== "inline" || tokens[i + 2]?.type !== "paragraph_close") return null;
  return inline.content.trim();
};

/**
 * Rewrites markdown-it's stream into one `prosemirror-markdown` can consume against our schema:
 * raw HTML becomes typed nodes, include directives become `snippet`, and table cells gain the
 * paragraph the schema requires (markdown-it puts inline content straight inside `td`).
 */
export function preprocessTokens(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "html_block") {
      const { node, attrs } = classifyHtmlBlock(t.content);
      out.push(withMeta(`pg_${node}`, attrs));
      continue;
    }
    const lone = loneParagraph(tokens, i);
    if (lone !== null) {
      const ref = SNIPPET_RE.exec(lone)?.[1];
      if (ref !== undefined) {
        out.push(withMeta("pg_snippet", { ref }));
        i += 2;
        continue;
      }
      // `<model-viewer …></model-viewer>` is not one of markdown-it's block-level tag names, so a
      // one-line element arrives as a paragraph of inline HTML rather than as an `html_block`.
      const raw = classifyHtmlBlock(lone);
      if (raw.node === "modelViewer") {
        out.push(withMeta("pg_modelViewer", raw.attrs));
        i += 2;
        continue;
      }
    }
    if (t.type === "inline") {
      const clone = new Token("inline", "", 0);
      clone.content = t.content;
      clone.children = rewriteInline(t.children ?? []);
      out.push(clone);
      continue;
    }
    // Table cells hold `block+`; markdown-it puts inline content straight inside `td`/`th`.
    if (t.type === "th_close" || t.type === "td_close") out.push(token("paragraph_close", "p", -1));
    out.push(t);
    if (t.type === "th_open" || t.type === "td_open") out.push(token("paragraph_open", "p", 1));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Token → node specs
// ---------------------------------------------------------------------------------------------

const meta = (t: Token): Record<string, unknown> => (t.meta ?? {}) as Record<string, unknown>;

/**
 * A list is tight when its items' paragraphs are `hidden` — markdown-it's way of saying "render
 * `<li>text</li>`, not `<li><p>text</p></li>". The document has no other trace of it, so the
 * serializer would have to guess; see the `tight` attribute in `schema.ts`.
 */
const listIsTight = (tokens: readonly Token[], i: number): boolean => {
  while (++i < tokens.length) if (tokens[i]!.type !== "list_item_open") return tokens[i]!.hidden;
  return false;
};

const align = (t: Token): string | null => /text-align:\s*(\w+)/.exec(t.attrGet("style") ?? "")?.[1] ?? null;

const tokenSpec: Record<string, ParseSpec> = {
  paragraph: { block: "paragraph" },
  blockquote: { block: "blockquote" },
  heading: { block: "heading", getAttrs: (t) => ({ level: Number(t.tag.slice(1)), explicitId: t.attrGet("id") }) },
  hr: { node: "horizontalRule" },
  bullet_list: { block: "bulletList", getAttrs: (_t, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  ordered_list: { block: "orderedList", getAttrs: (t, tokens, i) => ({ start: Number(t.attrGet("start") ?? 1), tight: listIsTight(tokens, i) }) },
  list_item: { block: "listItem" },
  code_block: { block: "codeBlock", noCloseToken: true, getAttrs: () => ({ language: null }) },
  fence: { block: "codeBlock", noCloseToken: true, getAttrs: (t) => ({ language: t.info.trim() === "" ? null : t.info.trim() }) },
  hardbreak: { node: "hardBreak" },
  image: {
    node: "image",
    getAttrs: (t) => ({ src: t.attrGet("src") ?? "", alt: t.content, title: t.attrGet("title"), width: t.attrGet("width"), class: t.attrGet("class") }),
  },

  em: { mark: "italic" },
  strong: { mark: "bold" },
  s: { mark: "strike" },
  code_inline: { mark: "code", noCloseToken: true },
  link: { mark: "link", getAttrs: (t) => ({ href: t.attrGet("href") ?? "", title: t.attrGet("title"), class: t.attrGet("class") }) },
  pg_highlight: { mark: "highlight", getAttrs: (t) => ({ color: meta(t)["color"] ?? null }) },
  pg_text_color: { mark: "textStyle", getAttrs: (t) => ({ color: meta(t)["color"] ?? null }) },

  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "tableRow" },
  th: { block: "tableHeader", getAttrs: (t) => ({ align: align(t) }) },
  td: { block: "tableCell", getAttrs: (t) => ({ align: align(t) }) },

  pg_tabs: { block: "tabs" },
  pg_tab: { block: "tab", getAttrs: (t) => ({ label: t.attrGet("label") ?? "" }) },
  pg_admonition: {
    block: "admonition",
    getAttrs: (t) => ({ kind: t.attrGet("kind") ?? "note", title: t.attrGet("title") ?? "", collapsible: t.attrGet("collapsible") === "true" }),
  },

  pg_snippet: { node: "snippet", getAttrs: (t) => meta(t) },
  pg_figureKg: { node: "figureKg", getAttrs: (t) => meta(t) },
  pg_figureImage: { node: "figureImage", getAttrs: (t) => meta(t) },
  pg_modelViewer: { node: "modelViewer", getAttrs: (t) => meta(t) },
  pg_htmlBlock: { node: "htmlBlock", getAttrs: (t) => meta(t) },
};

const parserFor = (md: MarkdownIt): MarkdownParser => {
  const tokenizer = { parse: (text: string, env: unknown): Token[] => preprocessTokens(md.parse(text, env)) };
  return new MarkdownParser(getEditorSchema(), tokenizer as unknown as MarkdownIt, tokenSpec);
};

/**
 * Markdown → ProseMirror document, in pagina's dialect.
 *
 * Front matter is stripped rather than parsed: markdown-it has no notion of it and would read the
 * closing `---` as a setext heading. It comes back verbatim so the serializer can re-emit it.
 *
 * Core's `pg_anchors` rule stamps a generated slug onto every heading, which would be
 * indistinguishable from an author's `{#explicit-id}` by the time the parser sees the token — so
 * the parse opts out with `pgAnchors: false`. `attrGet("id")` is then set only by
 * markdown-it-attrs, i.e. only when the author wrote one. The flag travels in the parse env, so
 * a caller-supplied `MarkdownIt` is never mutated.
 */
export function parseMarkdown(markdown: string, opts: ParseOptions = {}): ParseResult {
  const text = markdown.replace(/\r\n?/g, "\n");
  const front = FRONT_MATTER_RE.exec(text);
  const body = front === null ? text : text.slice(front[0].length);
  const md = opts.md ?? (defaultMd ??= createEditorMarkdown());
  const doc = parserFor(md).parse(body, { pgAnchors: false });
  return front === null ? { doc } : { doc, frontMatter: front[1] ?? "" };
}
