/**
 * Editing `article.yaml` without rewriting the file.
 *
 * `article.yaml` is a *hand-written* file. It has comments, an order its author chose, and a style
 * (flow maps for pages, block maps for sections) that reads deliberately. Parsing it to a plain
 * object and re-serialising would silently throw all three away on the first "New page" — so this
 * goes through `yaml`'s document API, which keeps the original tokens for everything it does not
 * touch and appends a node in the surrounding style.
 *
 * These are string→string functions: the store owns the file, and writing it is its business.
 */
import { Document, isMap, isPair, isSeq, parseDocument, type Node as YamlNode, type Pair, type YAMLMap, type YAMLSeq } from "yaml";

/** The `nav:` sequence, created (empty) if the file has none. */
function navSeq(doc: Document): YAMLSeq {
  const existing = doc.get("nav", true);
  if (isSeq(existing)) return existing;
  const seq = doc.createNode([]) as YAMLSeq;
  doc.set("nav", seq);
  return seq;
}

/** The `children:` of the section named `section`, or `undefined` when there is no such section. */
function sectionChildren(seq: YAMLSeq, section: string): YAMLSeq | undefined {
  for (const item of seq.items) {
    if (!isMap(item)) continue;
    const name: unknown = item.get("section");
    if (typeof name !== "string" || name !== section) continue;
    const children = item.get("children", true);
    if (isSeq(children)) return children;
    const created = new Document(undefined).createNode([]) as YAMLSeq;
    item.set("children", created);
    return created;
  }
  return undefined;
}

export interface NavEntryInput {
  readonly title: string;
  /** Folder-relative markdown path, e.g. `guide/new.md`. */
  readonly page: string;
  /** Name of an existing section to append inside; top level when omitted or not found. */
  readonly section?: string | undefined;
}

/**
 * Appends `{ title, page }` to the nav and returns the new file text.
 *
 * The entry is written as a flow map (`{ title: …, page: … }`) because that is how every page entry
 * in pagina's own articles is written, and a nav where one line looks unlike its neighbours reads
 * as a mistake. A page that is already in the nav is left exactly where it is.
 */
export function addNavEntry(yamlText: string, entry: NavEntryInput): string {
  const doc = parseDocument(yamlText);
  const seq = navSeq(doc);
  if (findPage(seq, entry.page) !== undefined) return yamlText;
  const target = (entry.section === undefined ? undefined : sectionChildren(seq, entry.section)) ?? seq;
  const node = doc.createNode({ title: entry.title, page: entry.page }) as YAMLMap;
  node.flow = true;
  target.add(node);
  return doc.toString();
}

/** Every section name the nav declares, in order — what "New page" offers to file a page under. */
export function navSections(yamlText: string): readonly string[] {
  const doc = parseDocument(yamlText);
  const seq = doc.get("nav", true);
  if (!isSeq(seq)) return [];
  const out: string[] = [];
  for (const item of seq.items) {
    if (!isMap(item)) continue;
    const name: unknown = item.get("section");
    if (typeof name === "string" && name !== "") out.push(name);
  }
  return out;
}

/** The map holding `page`, wherever it is nested; `undefined` when the nav does not mention it. */
function findPage(seq: YAMLSeq, page: string): { readonly parent: YAMLSeq; readonly index: number } | undefined {
  for (const [index, item] of seq.items.entries()) {
    if (!isMap(item)) continue;
    if (item.get("page") === page) return { parent: seq, index };
    const children = item.get("children", true);
    if (isSeq(children)) {
      const found = findPage(children, page);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * Removes `page` from the nav and returns the new file text; unchanged when it was not there.
 *
 * A section left with no children is *kept*: an empty section is a heading the author may be about
 * to refill, and deleting one because its last page went is a decision that belongs to them.
 */
export function removeNavEntry(yamlText: string, page: string): string {
  const doc = parseDocument(yamlText);
  const seq = doc.get("nav", true);
  if (!isSeq(seq)) return yamlText;
  const found = findPage(seq, page);
  if (found === undefined) return yamlText;
  (found.parent.items as YamlNode[]).splice(found.index, 1);
  return doc.toString();
}

// ------------------------------------------------------------------ the article's own settings

/**
 * What the Article settings panel edits.
 *
 * `undefined` leaves a field exactly as it is — including its comments and its quoting style.
 * `null` (or `""`, for the strings) **removes** the key, which is the only way to say "this
 * article has no cover" without leaving `cover:` pointing at nothing.
 */
export interface ArticleFields {
  readonly cover?: string | null;
  readonly description?: string | null;
  readonly author?: string | null;
  readonly tags?: readonly string[] | null;
}

/** Keys that describe the build rather than the article; new settings go *above* the first of them. */
const TRAILING_KEYS = new Set(["nav", "snippets", "kineglyph"]);

/** Index of the first trailing key, i.e. where a newly added setting belongs. */
function insertionPoint(map: YAMLMap): number {
  const items = map.items as Pair[];
  const at = items.findIndex((pair) => {
    if (!isPair(pair)) return false;
    const key: unknown = (pair.key as { value?: unknown } | null)?.value;
    return typeof key === "string" && TRAILING_KEYS.has(key);
  });
  return at === -1 ? items.length : at;
}

/**
 * Sets or removes one top-level key, keeping the file's shape.
 *
 * An existing key is written through `doc.set`, which replaces only the *value* node — the key's
 * own comment, and every other line in the file, are untouched. A new key is spliced in **before**
 * `nav`/`snippets`/`kineglyph` rather than appended: appending would put `cover:` under a
 * forty-line nav tree, where nobody would find it and where it reads as belonging to the nav.
 */
function setKey(doc: Document, key: string, value: unknown): void {
  if (value === undefined) return;
  const contents = doc.contents;
  if (!isMap(contents)) return;
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    doc.delete(key);
    return;
  }
  const node = doc.createNode(value);
  // Tags read as a flow list in every article pagina ships; a block list here would look unlike
  // the file it was written into.
  if (isSeq(node)) node.flow = true;
  if (doc.has(key)) {
    doc.set(key, node);
    return;
  }
  const pair = doc.createPair(key, node) as Pair;
  (contents.items as Pair[]).splice(insertionPoint(contents), 0, pair);
}

/**
 * Applies the panel's fields to `article.yaml` and returns the new file text.
 *
 * This is the *same* document-API path `addNavEntry` uses, for the same reason: `article.yaml` is
 * hand-written, and a settings panel that reformatted it — dropping the author's comments and
 * their flow maps — would make the editor something you cannot safely open a real article in.
 */
export function setArticleFields(yamlText: string, fields: ArticleFields): string {
  const doc = parseDocument(yamlText);
  if (!isMap(doc.contents)) return yamlText;
  setKey(doc, "cover", fields.cover);
  setKey(doc, "description", fields.description);
  setKey(doc, "author", fields.author);
  setKey(doc, "tags", fields.tags === undefined || fields.tags === null ? fields.tags : [...fields.tags]);
  return doc.toString();
}

/** The current values of the settings the panel edits, for populating its form. */
export function readArticleFields(yamlText: string): {
  readonly cover: string; readonly description: string; readonly author: string; readonly tags: readonly string[];
} {
  let doc: Document;
  try {
    doc = parseDocument(yamlText);
  } catch {
    return { cover: "", description: "", author: "", tags: [] };
  }
  const str = (key: string): string => {
    const v: unknown = doc.get(key);
    return typeof v === "string" ? v : "";
  };
  // `doc.get` hands back the *node* for a collection, so the sequence is read through the node API
  // rather than assumed to be a plain array.
  const raw = doc.get("tags", true);
  const tags = isSeq(raw) ? (raw.toJSON() as unknown[]).filter((t): t is string => typeof t === "string") : [];
  return { cover: str("cover"), description: str("description"), author: str("author"), tags };
}
