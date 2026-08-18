/**
 * Byte-exact attribute round-tripping for the HTML the dialect embeds in markdown.
 *
 * The editor turns `<model-viewer …>` and `<figure class="kg" …>` into typed nodes, and the
 * serializer writes them back. Writing them back from the *model* alone cannot be byte-exact: the
 * model knows which attributes exist and what they mean, but not the four things a hand-written tag
 * also carries — the order the author put them in, which quote character they used, whether a
 * boolean attribute was written bare (`camera-controls`) or empty (`camera-controls=""`), and the
 * whitespace between them. Those four all survive to the rendered HTML verbatim, because core
 * copies an `html_block` straight through. So losing any of them breaks the guarantee the whole
 * editor rests on: opening a hand-written file and saving it unchanged must change nothing.
 *
 * The fix is to keep the author's attribute text and *patch* it, rather than to regenerate it.
 * `parseAttrSource` splits the text into tokens that remember their own source slice;
 * `renderAttrs` walks that list against the values the model currently holds and re-emits each
 * token verbatim unless its value actually changed. A node built in the UI has no source text, and
 * falls back to a canonical ` name="value"` rendering.
 */

/** One attribute as it appears in the source, plus the exact slice it occupied. */
export interface RawAttr {
  /** Attribute name, as written. */
  readonly name: string;
  /** The value: the text between the quotes, the bare word, or `""` for a valueless attribute. */
  readonly value: string;
  /** The full source slice, *including* the whitespace that preceded the name. */
  readonly source: string;
  /** The whitespace that preceded the name — reused when the value has to be rewritten. */
  readonly lead: string;
}

/** A tag's attribute text, decomposed so it can be re-emitted byte for byte. */
export interface AttrSource {
  readonly attrs: readonly RawAttr[];
  /**
   * Whatever followed the last attribute: trailing whitespace, and the `/` of a self-closing tag.
   * Re-emitted as-is, so `<model-viewer …  />` keeps both its spaces and its slash.
   */
  readonly tail: string;
}

/**
 * `name`, `name=value`, `name="value"`, `name='value'` — with the surrounding whitespace captured
 * so the slice can be replayed. Deliberately the same value grammar as HTML's, so the parse agrees
 * with what a browser (and markdown-it, which does not parse it at all) would see.
 */
const ATTR_RE = /(\s*)([A-Za-z_:][-A-Za-z0-9_:.]*)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Splits a tag's attribute text (`class="kg" data-scene='x' hidden`) into replayable tokens. */
export function parseAttrSource(source: string): AttrSource {
  const attrs: RawAttr[] = [];
  let end = 0;
  for (const m of source.matchAll(ATTR_RE)) {
    // A zero-length match (the whole pattern is optional past the name) would loop forever on
    // `String.matchAll`; it cannot happen here because the name is required, but a match that
    // starts after a gap means the gap was not attribute syntax, and replaying it is not our job.
    attrs.push({ name: m[2]!, value: m[4] ?? m[5] ?? m[6] ?? "", source: m[0], lead: m[1] ?? "" });
    end = m.index + m[0].length;
  }
  return { attrs, tail: source.slice(end) };
}

/** Parses a tag's attribute text into a plain name → value object, in source order. */
export function parseAttributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of parseAttrSource(source).attrs) out[attr.name] ??= attr.value;
  return out;
}

/**
 * A value being written *back* into an attribute. Only `"` needs escaping: every other character
 * is legal between double quotes, and escaping `&` as well would double-encode the entities an
 * author already wrote — values taken from the source are kept verbatim, so they arrive encoded.
 */
const escapeValue = (value: string): string => value.replace(/"/g, "&quot;");

const canonical = (name: string, value: string): string => ` ${name}="${escapeValue(value)}"`;

export interface RenderAttrsOptions {
  /**
   * Whether attributes present in the source but absent from `desired` are kept (`true`) or
   * dropped (`false`, the default). Nodes that model their leftovers explicitly — `modelViewer`,
   * `figureKg` — want them dropped, so that removing one in the UI removes it from the file.
   * Nodes that do not model them at all want them kept, so that they are not silently deleted.
   */
  readonly keepUnknown?: boolean;
}

/**
 * The attribute text to write after a tag name, given the values the model holds now and the
 * author's original text (`null` for a node the UI created).
 *
 * Unchanged attributes are replayed from `source` byte for byte; a changed one is rewritten in
 * place, keeping its position and its leading whitespace; a new one is appended. When `source` is
 * `null` the result is the canonical ` name="value"` form, in the order `desired` iterates.
 */
export function renderAttrs(source: string | null, desired: Iterable<readonly [string, string]>, opts: RenderAttrsOptions = {}): string {
  const want = new Map(desired);
  if (source === null) {
    let out = "";
    for (const [name, value] of want) out += canonical(name, value);
    return out;
  }
  const { attrs, tail } = parseAttrSource(source);
  const seen = new Set<string>();
  let out = "";
  for (const attr of attrs) {
    // A name repeated in the source is a mistake HTML resolves to its first occurrence; keeping
    // the later ones would let a rewrite of the first change nothing.
    if (seen.has(attr.name)) continue;
    if (!want.has(attr.name)) {
      if (opts.keepUnknown === true) out += attr.source;
      seen.add(attr.name);
      continue;
    }
    seen.add(attr.name);
    const value = want.get(attr.name)!;
    out += value === attr.value ? attr.source : `${attr.lead}${attr.name}="${escapeValue(value)}"`;
  }
  for (const [name, value] of want) if (!seen.has(name)) out += canonical(name, value);
  return out + tail;
}

/** Whether a tag's attribute text ends in the `/` of a self-closing tag. */
export const isSelfClosing = (source: string | null): boolean => source !== null && /\/\s*$/.test(source);
