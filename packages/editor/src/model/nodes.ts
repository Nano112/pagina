import { Node, mergeAttributes } from "@tiptap/core";

/**
 * The dialect's custom ProseMirror nodes.
 *
 * Node names and attribute names here are a **contract**: the parser (this plan), the serializer
 * (task A3) and the UI (plan B) all address nodes by these names, so renaming one is a breaking
 * change for every layer. `parseHTML`/`renderHTML` are required by TipTap even though the model
 * layer never touches the DOM — they only matter once plan B mounts an editor view, so they are
 * kept minimal and lossless (every attribute survives a DOM round-trip).
 */

/** Reads a string attribute out of a ProseMirror attrs bag without widening `any` into the caller. */
const str = (attrs: Record<string, unknown>, key: string): string | null => {
  const v = attrs[key];
  return typeof v === "string" ? v : null;
};

/** `{ "data-x": "v" }` for every non-null entry — nulls must not become the string "null". */
const dataAttrs = (attrs: Record<string, unknown>, keys: readonly string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const v = str(attrs, key);
    if (v !== null) out[`data-${key.toLowerCase()}`] = v;
  }
  return out;
};

const stringAttr = (name: string, fallback: string | null = null) => ({
  default: fallback,
  parseHTML: (element: HTMLElement): string | null => element.getAttribute(`data-${name.toLowerCase()}`),
  renderHTML: (attrs: Record<string, unknown>): Record<string, string> => dataAttrs(attrs, [name]),
});

/** `=== "Label"` groups. Content is one or more `tab` nodes; the group itself carries no data. */
export const Tabs = Node.create({
  name: "tabs",
  group: "block",
  content: "tab+",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-pg-tabs]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-pg-tabs": "", class: "pg-tabs" }), 0];
  },
});

/** One panel of a `tabs` group; `label` is the text between the quotes of `=== "…"`. */
export const Tab = Node.create({
  name: "tab",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return { label: stringAttr("label", "") };
  },
  parseHTML() {
    return [{ tag: "section[data-pg-tab]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["section", mergeAttributes(HTMLAttributes, { "data-pg-tab": "" }), 0];
  },
});

/** `!!! kind "Title"` / `??? kind "Title"`; `collapsible` distinguishes the two markers. */
export const Admonition = Node.create({
  name: "admonition",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: stringAttr("kind", "note"),
      title: stringAttr("title", ""),
      collapsible: {
        default: false,
        parseHTML: (element: HTMLElement): boolean => element.getAttribute("data-collapsible") === "true",
        renderHTML: (attrs: Record<string, unknown>): Record<string, string> => ({ "data-collapsible": attrs["collapsible"] === true ? "true" : "false" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-pg-admonition]" }, { tag: "details[data-pg-admonition]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes, { "data-pg-admonition": "" }), 0];
  },
});

/** `--8<-- "path:section"` on a line of its own. Atomic: the include is resolved, not edited. */
export const Snippet = Node.create({
  name: "snippet",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { ref: stringAttr("ref", "") };
  },
  parseHTML() {
    return [{ tag: "div[data-pg-snippet]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-pg-snippet": "" })];
  },
});

const KG_KEYS = ["kind", "id", "scene", "source", "static", "controls", "readout", "extraAttrs"] as const;

/**
 * `<figure class="kg" …>` — a Kineglyph figure. `kind` mirrors core's `FigureRef`:
 * `module` (a `data-scene` module path), `inline` (an inline `<script type="text/kineglyph">`,
 * whose text is `source`) or `static` (a pre-rendered asset). Attributes the dialect does not
 * model are kept verbatim in `extraAttrs` (a JSON object string) so the serializer can re-emit them.
 */
export const FigureKg = Node.create({
  name: "figureKg",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return Object.fromEntries(KG_KEYS.map((key) => [key, stringAttr(key, key === "kind" ? "static" : null)]));
  },
  parseHTML() {
    return [{ tag: "figure[data-pg-kg]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-pg-kg": "", class: "kg" })];
  },
});

/** `<figure markdown="span">` wrapping an image and a `<figcaption>` — a captioned image. */
export const FigureImage = Node.create({
  name: "figureImage",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: stringAttr("src", ""), alt: stringAttr("alt", ""), title: stringAttr("title"), width: stringAttr("width"), caption: stringAttr("caption", "") };
  },
  parseHTML() {
    return [{ tag: "figure[data-pg-figure-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-pg-figure-image": "", markdown: "span" })];
  },
});

/** `<model-viewer src="…">` — a glTF/GLB viewer element; unmodelled attributes live in `attrs`. */
export const ModelViewer = Node.create({
  name: "modelViewer",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: stringAttr("src", ""), alt: stringAttr("alt", ""), attrs: stringAttr("attrs") };
  },
  parseHTML() {
    return [{ tag: "model-viewer" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["model-viewer", mergeAttributes(HTMLAttributes)];
  },
});

/** Raw HTML the dialect has no node for. `html` is the block's source text, kept byte-for-byte. */
export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  code: true,
  addAttributes() {
    return { html: stringAttr("html", "") };
  },
  parseHTML() {
    return [{ tag: "div[data-pg-html]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-pg-html": "" })];
  },
});
