/**
 * Editing `article.yaml`'s nav without rewriting the file.
 *
 * `article.yaml` is a *hand-written* file. It has comments, an order its author chose, and a style
 * (flow maps for pages, block maps for sections) that reads deliberately. Parsing it to a plain
 * object and re-serialising would silently throw all three away on the first "New page" — so this
 * goes through `yaml`'s document API, which keeps the original tokens for everything it does not
 * touch and appends a node in the surrounding style.
 *
 * These are string→string functions: the store owns the file, and writing it is its business.
 */
import { Document, isMap, isSeq, parseDocument, type Node as YamlNode, type YAMLMap, type YAMLSeq } from "yaml";

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
