import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { MarkdownSerializer, type MarkdownSerializerState, defaultMarkdownSerializer } from "prosemirror-markdown";
import { INNER_HTML_KEY } from "./raw-html.js";

/**
 * ProseMirror document → pagina's markdown dialect.
 *
 * The inverse of `parseMarkdown`. What "inverse" means here is pinned by the round-trip guarantee
 * in `test/roundtrip.test.ts`: serialising is a fixed point after one pass, re-parsing yields the
 * same document, and — the one that actually matters for a WYSIWYG editor — the site's rendered
 * HTML is byte-identical before and after a save.
 *
 * That last property is why several node serializers emit *raw HTML* rather than markdown: a
 * `figureKg` or an `htmlBlock` reaches core as an `html_block` token whose content is copied to the
 * output verbatim, so anything short of reproducing the author's bytes shows up as a diff. The
 * canonical forms below are therefore chosen to match what the dialect's sources actually contain.
 */

type Attrs = Record<string, unknown>;
type NodeSerializer = (state: MarkdownSerializerState, node: ProseMirrorNode, parent: ProseMirrorNode, index: number) => void;

/** A string attribute, or `""` when unset — for attributes whose empty value is meaningful. */
const raw = (attrs: Attrs, key: string): string => (typeof attrs[key] === "string" ? (attrs[key] as string) : "");
/** A string attribute, or `null` when unset or empty — for attributes that are simply absent. */
const some = (attrs: Attrs, key: string): string | null => {
  const v = attrs[key];
  return typeof v === "string" && v !== "" ? v : null;
};

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** `{ width="480" .cls }` — markdown-it-attrs' suffix, in the one order this serializer emits. */
function attrSuffix(width: string | null, classes: string | null): string {
  const parts: string[] = [];
  if (width !== null) parts.push(`width="${width}"`);
  if (classes !== null) for (const name of classes.split(/\s+/).filter((c) => c !== "")) parts.push(`.${name}`);
  return parts.length === 0 ? "" : `{ ${parts.join(" ")} }`;
}

/** `![alt](src "title")` with the parenthesis/quote escaping CommonMark needs. */
const imageMarkup = (attrs: Attrs, escapedAlt: string): string =>
  `![${escapedAlt}](${raw(attrs, "src").replace(/[()]/g, "\\$&")}${some(attrs, "title") === null ? "" : ` "${raw(attrs, "title").replace(/"/g, '\\"')}"`})`;

/** ` name="value"` for every entry, in insertion order; the reserved inner-HTML key is skipped. */
function htmlAttrs(entries: Iterable<readonly [string, string]>): string {
  let out = "";
  for (const [name, value] of entries) if (name !== INNER_HTML_KEY) out += ` ${name}="${value}"`;
  return out;
}

/** A JSON object string as written by `raw-html.ts`, or an empty map when absent/unparseable. */
function jsonAttrs(value: string | null): Map<string, string> {
  if (value === null) return new Map();
  const parsed = JSON.parse(value) as Record<string, string>;
  return new Map(Object.entries(parsed));
}

// -------------------------------------------------------------------------------------------
// Blocks with an indented body (tabs, admonitions)
// -------------------------------------------------------------------------------------------

/**
 * Writes a marker line, then the node's content indented by four spaces, exactly as core's
 * `readIndentedBody` expects to read it back. `blankLine` follows how the dialect's pages are
 * written: a blank line after `=== "Label"`, none after `!!! kind`.
 *
 * `closeBlock` is what produces that blank line *without* leaving the enclosing delimiter on it:
 * `flushClose` trims trailing whitespace off the delimiter, so a body four (or eight, nested)
 * spaces in still gets genuinely empty separator lines — and a "blank" line that is really four
 * spaces of indentation would be read back as part of the body.
 */
function indentedBody(state: MarkdownSerializerState, node: ProseMirrorNode, marker: string, blankLine: boolean): void {
  state.write(marker);
  if (blankLine) state.closeBlock(node);
  else state.ensureNewLine();
  state.wrapBlock("    ", null, node, () => state.renderContent(node));
}

/**
 * Whether this list needs the *alternate* marker (`*` instead of `-`, `)` instead of `.`).
 *
 * Two lists of the same kind written back to back with the same marker are one list when read
 * back — the blank line between them only makes the single list loose. CommonMark's rule is that
 * changing the marker starts a new list, so adjacent siblings alternate.
 */
function adjacent(node: ProseMirrorNode, parent: ProseMirrorNode, index: number): boolean {
  let run = 0;
  for (let i = index - 1; i >= 0 && parent.child(i).type === node.type; i--) run++;
  return run % 2 === 1;
}

// -------------------------------------------------------------------------------------------
// Tables
// -------------------------------------------------------------------------------------------

const DASHES: Record<string, string> = { left: ":---", right: "---:", center: ":---:" };

/**
 * One cell's inline markdown. Cells hold `block+` in the schema but a single line in GFM, so the
 * cell is serialized on its own and flattened; `|` has to be escaped or it would split the row.
 */
const cellText = (cell: ProseMirrorNode): string =>
  serializer.serialize(cell).replace(/\n+/g, " ").trim().replace(/\|/g, "\\|");

const tableRow = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

function serializeTable(state: MarkdownSerializerState, node: ProseMirrorNode): void {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cellText(cell)));
    rows.push(cells);
  });
  const header = rows[0] ?? [];
  const aligns: string[] = [];
  node.firstChild?.forEach((cell) => aligns.push(DASHES[raw(cell.attrs, "align")] ?? "---"));
  state.write(tableRow(header));
  state.ensureNewLine();
  // The delimiter row goes compact (`|---|:-:|`), which is how the dialect's pages write it.
  state.write(`|${aligns.join("|")}|`);
  for (const row of rows.slice(1)) {
    state.ensureNewLine();
    state.write(tableRow(row));
  }
  state.closeBlock(node);
}

// -------------------------------------------------------------------------------------------
// Node serializers
// -------------------------------------------------------------------------------------------

const nodes: Record<string, NodeSerializer> = {
  text: defaultMarkdownSerializer.nodes["text"]!,
  hardBreak: defaultMarkdownSerializer.nodes["hard_break"]!,

  paragraph(state, node) {
    state.renderInline(node);
    state.closeBlock(node);
  },

  heading(state, node) {
    state.write(`${state.repeat("#", Number(node.attrs["level"] ?? 1))} `);
    state.renderInline(node, false);
    // Only an id the *author* wrote comes back; core slugs the rest at render time.
    const id = some(node.attrs, "explicitId");
    if (id !== null) state.write(` {#${id}}`);
    state.closeBlock(node);
  },

  blockquote(state, node) {
    state.wrapBlock("> ", null, node, () => state.renderContent(node));
  },

  horizontalRule(state, node) {
    state.write("---");
    state.closeBlock(node);
  },

  /**
   * Always a fence, never an indented block: core renders a fence through its `highlight` hook
   * (`<pre><code class="language-…">`) and an indented block through markdown-it's default
   * (`<pre><code>`), and `language: null` — which both an info-less fence and an indented block
   * parse to — has to pick one. Fences are the dialect's idiom.
   */
  codeBlock(state, node) {
    const runs = node.textContent.match(/`{3,}/gm);
    const fence = runs === null ? "```" : `${runs.sort().slice(-1)[0]!}\``;
    state.write(`${fence}${raw(node.attrs, "language")}\n`);
    state.text(node.textContent, false);
    state.write("\n");
    state.write(fence);
    state.closeBlock(node);
  },

  bulletList(state, node, parent, index) {
    state.renderList(node, "  ", () => (adjacent(node, parent, index) ? "* " : "- "));
  },

  orderedList(state, node, parent, index) {
    const delimiter = adjacent(node, parent, index) ? ")" : ".";
    const start = Number(node.attrs["start"] ?? 1);
    const width = String(start + node.childCount - 1).length;
    state.renderList(node, state.repeat(" ", width + 2), (i) => {
      const n = String(start + i);
      return `${state.repeat(" ", width - n.length)}${n}${delimiter} `;
    });
  },

  listItem(state, node) {
    state.renderContent(node);
  },

  image(state, node) {
    state.write(imageMarkup(node.attrs, state.esc(raw(node.attrs, "alt"))) + attrSuffix(some(node.attrs, "width"), some(node.attrs, "class")));
  },

  table: serializeTable,
  // Rows and cells are written by `serializeTable`; these exist so a stray direct render (a
  // selection of one row, say) degrades to its content instead of throwing.
  tableRow: (state, node) => state.renderContent(node),
  tableHeader: (state, node) => state.renderContent(node),
  tableCell: (state, node) => state.renderContent(node),

  tabs(state, node) {
    state.renderContent(node);
  },

  tab(state, node) {
    indentedBody(state, node, `=== "${raw(node.attrs, "label")}"`, true);
  },

  admonition(state, node) {
    const kind = raw(node.attrs, "kind");
    const title = raw(node.attrs, "title");
    const marker = node.attrs["collapsible"] === true ? "???" : "!!!";
    // core defaults an omitted title to the capitalised kind, so writing it back would be noise.
    indentedBody(state, node, `${marker} ${kind}${title === capitalise(kind) ? "" : ` "${title}"`}`, false);
  },

  snippet(state, node) {
    state.write(`--8<-- "${raw(node.attrs, "ref")}"`);
    state.closeBlock(node);
  },

  /**
   * Canonical `<figure class="kg" …>`: attribute order is fixed (class, data-scene, id,
   * data-static, data-controls, data-readout, then whatever `extraAttrs` kept) so the same figure
   * always serializes to the same bytes. An inline scene's source goes back inside its
   * `<script type="text/kineglyph">`; any other inner HTML rides along under `INNER_HTML_KEY`.
   */
  figureKg(state, node) {
    const extra = jsonAttrs(some(node.attrs, "extraAttrs"));
    const ordered = new Map<string, string>([["class", extra.get("class") ?? "kg"]]);
    for (const [key, attr] of [["scene", "data-scene"], ["id", "id"], ["static", "data-static"], ["controls", "data-controls"], ["readout", "data-readout"]] as const) {
      const value = some(node.attrs, key);
      if (value !== null) ordered.set(attr, value);
    }
    for (const [name, value] of extra) if (name !== "class") ordered.set(name, value);
    const source = some(node.attrs, "source");
    const script = source === null ? "" : `<script type="text/kineglyph">\n${source}\n</script>`;
    state.text(`<figure${htmlAttrs(ordered)}>${script}${extra.get(INNER_HTML_KEY) ?? ""}</figure>`, false);
    state.closeBlock(node);
  },

  /** MkDocs' captioned image: markdown inside, so the inner lines are markdown, not HTML. */
  figureImage(state, node) {
    const image = `  ${imageMarkup(node.attrs, raw(node.attrs, "alt"))}${attrSuffix(some(node.attrs, "width"), null)}`;
    const caption = some(node.attrs, "caption");
    const lines = ['<figure markdown="span">', image, ...(caption === null ? [] : [`  <figcaption>${caption}</figcaption>`]), "</figure>"];
    state.text(lines.join("\n"), false);
    state.closeBlock(node);
  },

  modelViewer(state, node) {
    const ordered = new Map<string, string>([["src", raw(node.attrs, "src")]]);
    const alt = some(node.attrs, "alt");
    if (alt !== null) ordered.set("alt", alt);
    for (const [name, value] of jsonAttrs(some(node.attrs, "attrs"))) ordered.set(name, value);
    state.text(`<model-viewer${htmlAttrs(ordered)}></model-viewer>`, false);
    state.closeBlock(node);
  },

  htmlBlock(state, node) {
    state.text(raw(node.attrs, "html"), false);
    state.closeBlock(node);
  },
};

// -------------------------------------------------------------------------------------------
// Mark serializers
// -------------------------------------------------------------------------------------------

const emphasis = { mixable: true, expelEnclosingWhitespace: true } as const;

/** `prosemirror-markdown` does not export `MarkSerializerSpec`, so borrow it from the constructor. */
type MarkSpecs = ConstructorParameters<typeof MarkdownSerializer>[1];

const marks: MarkSpecs = {
  bold: { open: "**", close: "**", ...emphasis },
  italic: { open: "*", close: "*", ...emphasis },
  strike: { open: "~~", close: "~~", ...emphasis },
  underline: { open: "<u>", close: "</u>", mixable: true },
  code: defaultMarkdownSerializer.marks["code"]!,

  link: {
    open: "[",
    close: (_state, mark) =>
      `](${raw(mark.attrs, "href").replace(/[()"]/g, "\\$&")}${some(mark.attrs, "title") === null ? "" : ` "${raw(mark.attrs, "title").replace(/"/g, '\\"')}"`})${attrSuffix(null, some(mark.attrs, "class"))}`,
    mixable: true,
  },

  // Colour is inline HTML in this dialect: core passes it through verbatim, and the parser reads
  // exactly these two shapes back into marks.
  highlight: {
    open: (_state, mark) => {
      const color = some(mark.attrs, "color");
      return color === null ? "<mark>" : `<mark style="background:${color}">`;
    },
    close: "</mark>",
  },
  textStyle: {
    open: (_state, mark) => {
      const color = some(mark.attrs, "color");
      return color === null ? "" : `<span style="color:${color}">`;
    },
    close: (_state, mark) => (some(mark.attrs, "color") === null ? "" : "</span>"),
  },
};

const serializer = new MarkdownSerializer(nodes, marks, { hardBreakNodeName: "hardBreak" });

export interface SerializeOptions {
  /** The YAML `parseMarkdown` handed back, re-emitted verbatim between `---` fences. */
  readonly frontMatter?: string;
}

/** The serializer this module uses, for callers that want to extend or inspect it. */
export const markdownSerializer = serializer;

/**
 * ProseMirror document → markdown, in pagina's dialect.
 *
 * The result ends with a newline (as a file should) and is a fixed point of `parse ∘ serialize`:
 * serializing what this returns, re-parsed, yields the same string again.
 */
export function serializeMarkdown(doc: ProseMirrorNode, opts: SerializeOptions = {}): string {
  const body = `${serializer.serialize(doc)}\n`;
  return opts.frontMatter === undefined ? body : `---\n${opts.frontMatter}\n---\n\n${body}`;
}
