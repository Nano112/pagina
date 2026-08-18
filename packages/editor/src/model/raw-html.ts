/**
 * Classification of the raw HTML the dialect embeds in markdown.
 *
 * With `mdInHtml: false` every `<figure …>` / `<model-viewer …>` block arrives as a single
 * `html_block` token whose `content` is the author's source text. The editor cannot show a blob of
 * HTML and still call itself WYSIWYG, so each block is matched against the three shapes the dialect
 * actually uses and turned into a typed node; anything else stays a verbatim `htmlBlock`.
 *
 * Everything that is recognised must be reconstructible, because task A3 serialises these nodes
 * back to markdown. Attributes the node model does not name are therefore preserved verbatim —
 * `figureKg` keeps them in `extraAttrs`, `modelViewer` in `attrs`, both as a JSON object string.
 *
 * A JSON bag preserves *which* attributes there were and what they said, but not how they were
 * written: their order relative to the modelled ones, their quote character, and whether a boolean
 * one was bare. Those reach the rendered page verbatim, so every recognised node also keeps the
 * tag's attribute text in `attrSource`, which `renderAttrs` replays token by token. See
 * `attr-source.ts`.
 */

/** `figureKg.extraAttrs` key holding the figure's inner HTML minus its kineglyph `<script>`. */
export const INNER_HTML_KEY = "#inner";

export { parseAttributes } from "./attr-source.js";
import { parseAttributes } from "./attr-source.js";

/** `{ …rest }` as a JSON object string, or `null` when nothing is left over. */
const leftovers = (attrs: Record<string, string>, known: readonly string[]): string | null => {
  const rest = Object.fromEntries(Object.entries(attrs).filter(([k]) => !known.includes(k)));
  return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
};

export interface RawHtmlNode {
  readonly node: "figureKg" | "figureImage" | "modelViewer" | "htmlBlock";
  readonly attrs: Record<string, string | null>;
}

const FIGURE_RE = /^<figure\b([^>]*)>([\s\S]*?)<\/figure>\s*$/;
// Group 1 is everything between the tag name and `>`, *including* a self-closing `/`: it is handed
// to `parseAttrSource`, which leaves the slash in the tail so the tag comes back as it went in.
const MODEL_VIEWER_RE = /^<model-viewer\b([^>]*)>(?:([\s\S]*?)<\/model-viewer>)?\s*$/;
// Non-greedy to the first `</script>`, which is what the HTML parser does too — so a scene whose
// source contains that sequence inside a string literal truncates here (it would break the browser
// as well, and the fix is the same: split the literal). Matches core's `extractFigures` regex.
const KG_SCRIPT_RE = /<script\b[^>]*\btype="text\/kineglyph"[^>]*>([\s\S]*?)<\/script>/;
const FIGCAPTION_RE = /<figcaption>([\s\S]*?)<\/figcaption>/;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]*)(?:\s+"([^"]*)")?\s*\)(?:\s*\{([^}]*)\})?/;
const KG_KNOWN = ["id", "data-scene", "data-static", "data-controls", "data-readout", "data-instrument"];

const hasClass = (attrs: Record<string, string>, name: string): boolean =>
  (attrs["class"] ?? "").split(/\s+/).includes(name);

function classifyFigure(attrText: string, inner: string): RawHtmlNode | null {
  const attrs = parseAttributes(attrText);
  if (hasClass(attrs, "kg")) {
    const script = KG_SCRIPT_RE.exec(inner);
    const scene = attrs["data-scene"] ?? null;
    const rest = { ...attrs };
    // A bare `class="kg"` is implied by the node type; anything richer has to be kept.
    if (rest["class"] === "kg") delete rest["class"];
    const extra: Record<string, string> = JSON.parse(leftovers(rest, KG_KNOWN) ?? "{}") as Record<string, string>;
    const remainder = (script === null ? inner : inner.replace(KG_SCRIPT_RE, "")).trim();
    if (remainder !== "") extra[INNER_HTML_KEY] = remainder;
    return {
      node: "figureKg",
      attrs: {
        attrSource: attrText,
        kind: script !== null ? "inline" : scene !== null ? "module" : "static",
        id: attrs["id"] ?? null,
        scene,
        source: script === null ? null : script[1]!.trim(),
        static: attrs["data-static"] ?? null,
        controls: attrs["data-controls"] ?? null,
        readout: attrs["data-readout"] ?? null,
        // pagina's own: "this figure is worth poking at". Absent means the figure is a picture.
        instrument: attrs["data-instrument"] ?? null,
        extraAttrs: Object.keys(extra).length === 0 ? null : JSON.stringify(extra),
      },
    };
  }
  // `<figure markdown="span">` is MkDocs' captioned image: markdown inside, caption underneath.
  const image = MD_IMAGE_RE.exec(inner);
  if (attrs["markdown"] === undefined || image === null) return null;
  const extras = parseAttributes(image[4] ?? "");
  return {
    node: "figureImage",
    attrs: {
      attrSource: attrText,
      src: image[2] ?? "",
      alt: image[1] ?? "",
      title: image[3] ?? null,
      width: extras["width"] ?? null,
      caption: (FIGCAPTION_RE.exec(inner)?.[1] ?? "").trim(),
    },
  };
}

/** Classifies one `html_block` token's source text into the node it should become. */
export function classifyHtmlBlock(html: string): RawHtmlNode {
  const text = html.trim();
  const figure = FIGURE_RE.exec(text);
  const classified = figure === null ? null : classifyFigure(figure[1] ?? "", figure[2] ?? "");
  if (classified !== null) return classified;
  const model = MODEL_VIEWER_RE.exec(text);
  if (model !== null) {
    const attrText = model[1] ?? "";
    const attrs = parseAttributes(attrText);
    // `<model-viewer>` may wrap fallback content — a `<img slot="poster">`, a `<div slot="ar-button">`.
    // The editor has nothing to show for it, but dropping it would delete the author's markup.
    const inner = (model[2] ?? "").trim();
    return {
      node: "modelViewer",
      attrs: {
        attrSource: attrText,
        src: attrs["src"] ?? "",
        alt: attrs["alt"] ?? "",
        inner: inner === "" ? null : inner,
        attrs: leftovers(attrs, ["src", "alt"]),
      },
    };
  }
  return { node: "htmlBlock", attrs: { html: text } };
}

export interface InlineHtmlMark {
  readonly mark: "highlight" | "textStyle";
  readonly open: boolean;
  readonly color: string | null;
}

const OPEN_MARK_RE = /^<mark\b([^>]*)>$/;
const OPEN_SPAN_RE = /^<span\b([^>]*)>$/;

/** Reads one declaration out of a `style="…"` attribute. */
const styleValue = (style: string, ...names: readonly string[]): string | null => {
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    if (names.includes(decl.slice(0, i).trim().toLowerCase())) return decl.slice(i + 1).trim();
  }
  return null;
};

/**
 * Recognises the inline HTML the dialect uses for coloured text — `<mark style="background:…">`
 * and `<span style="color:…">` — and nothing else; unrecognised inline HTML stays literal text.
 */
export function classifyInlineHtml(html: string): InlineHtmlMark | null {
  const text = html.trim();
  if (text === "</mark>") return { mark: "highlight", open: false, color: null };
  if (text === "</span>") return { mark: "textStyle", open: false, color: null };
  const mark = OPEN_MARK_RE.exec(text);
  if (mark !== null) {
    const attrs = parseAttributes(mark[1] ?? "");
    return { mark: "highlight", open: true, color: styleValue(attrs["style"] ?? "", "background", "background-color") ?? attrs["data-color"] ?? null };
  }
  const span = OPEN_SPAN_RE.exec(text);
  if (span !== null) {
    const attrs = parseAttributes(span[1] ?? "");
    const color = styleValue(attrs["style"] ?? "", "color");
    // A `<span>` without a colour carries no meaning we can model; leave it as literal text.
    if (color === null) return null;
    return { mark: "textStyle", open: true, color };
  }
  return null;
}
