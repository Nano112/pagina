/**
 * A page's YAML front matter.
 *
 * Two rules govern this file, and they pull in opposite directions:
 *
 *  1. The renderer must **read** front matter, because `title`, `description` and `cover` are how
 *     a page overrides the article's own metadata.
 *  2. The editor must **not rewrite** it. `parseMarkdown` keeps the text between the `---` fences
 *     verbatim and `serializeMarkdown` puts the same bytes back, so key order, quoting style and
 *     comments all survive a round trip. Nothing here ever re-serialises a block.
 *
 * So this parses a *copy* and returns a plain object; the original text is the source of truth and
 * stays where it is. A block that is not a mapping, or that carries a key of the wrong type, is a
 * diagnostic rather than a throw: one malformed page must not take a whole site's build with it,
 * and the diagnostic names the page.
 */
import { parse } from "yaml";
import { COVER_FIT } from "./config.js";
import type { CoverFit, Diagnostic, PageFrontMatter } from "./types.js";

/** The opening `---` fence must be the first thing in the file, per the usual convention. */
export const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits `text` into its front matter block (if any) and the markdown body. */
export function splitFrontMatter(text: string): { readonly yaml?: string; readonly body: string } {
  const m = FRONT_MATTER_RE.exec(text);
  if (m === null) return { body: text };
  return { yaml: m[1] ?? "", body: text.slice(m[0].length) };
}

function dateish(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" && v !== "" ? v : undefined;
}

/**
 * Reads a page's front matter.
 *
 * `page` only names the file in the diagnostics. Unknown keys are ignored on purpose — front
 * matter is a place authors and hosts both write into, and rejecting a key pagina does not know
 * about would make it pagina's business.
 */
export function parseFrontMatter(text: string, page: string): { readonly meta: PageFrontMatter; readonly body: string; readonly diagnostics: Diagnostic[] } {
  const { yaml, body } = splitFrontMatter(text);
  if (yaml === undefined) return { meta: {}, body, diagnostics: [] };
  const diagnostics: Diagnostic[] = [];
  const bad = (message: string): void => {
    diagnostics.push({ severity: "warning", code: "front-matter-invalid", message, page });
  };
  let raw: unknown;
  try {
    raw = parse(yaml) as unknown;
  } catch (e) {
    bad(`front matter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
    return { meta: {}, body, diagnostics };
  }
  // An empty block (`---\n---`) parses to null, which is not a mistake worth reporting.
  if (raw === null || raw === undefined) return { meta: {}, body, diagnostics };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    bad("front matter must be a mapping");
    return { meta: {}, body, diagnostics };
  }
  const o = raw as Record<string, unknown>;
  const text_ = (key: keyof PageFrontMatter): Record<string, string> => {
    const v = o[key];
    if (v === undefined || v === null) return {};
    if (typeof v !== "string" || v === "") {
      bad(`front matter: ${key} must be a non-empty string`);
      return {};
    }
    return { [key]: v };
  };
  const date = (key: "published" | "updated"): Record<string, string> => {
    const v = o[key];
    if (v === undefined || v === null) return {};
    const d = dateish(v);
    if (d === undefined) {
      bad(`front matter: ${key} must be a date or a non-empty string`);
      return {};
    }
    return { [key]: d };
  };
  // `cover_alt` is the only key whose YAML spelling differs from its field name, so it is read
  // by hand rather than through `text_`. Snake_case in the file matches `article.yaml`'s.
  let coverAlt: Record<string, string> = {};
  if (o["cover_alt"] !== undefined && o["cover_alt"] !== null) {
    if (typeof o["cover_alt"] !== "string" || o["cover_alt"] === "") bad("front matter: cover_alt must be a non-empty string");
    else coverAlt = { coverAlt: o["cover_alt"] };
  }
  // `cover_fit` is the page's half of the same key `article.yaml` carries, and it is validated the
  // same way: a misspelt value is a warning and the article's answer stands, rather than a silent
  // fall back to the default that would crop the very image the author was trying to protect.
  let coverFit: Record<string, CoverFit> = {};
  if (o["cover_fit"] !== undefined && o["cover_fit"] !== null) {
    if (typeof o["cover_fit"] !== "string" || !COVER_FIT.includes(o["cover_fit"] as CoverFit))
      bad(`front matter: cover_fit must be ${COVER_FIT.join("|")}`);
    else coverFit = { coverFit: o["cover_fit"] as CoverFit };
  }
  let noindex: Record<string, boolean> = {};
  if (o["noindex"] !== undefined && o["noindex"] !== null) {
    if (typeof o["noindex"] !== "boolean") bad("front matter: noindex must be true or false");
    else noindex = { noindex: o["noindex"] };
  }
  let tags: Record<string, readonly string[]> = {};
  if (o["tags"] !== undefined && o["tags"] !== null) {
    if (!Array.isArray(o["tags"]) || o["tags"].some((t) => typeof t !== "string")) bad("front matter: tags must be a list of strings");
    else tags = { tags: o["tags"] as string[] };
  }
  return {
    meta: {
      ...text_("title"), ...text_("description"), ...text_("cover"), ...text_("author"),
      ...coverAlt, ...coverFit, ...date("published"), ...date("updated"), ...noindex, ...tags,
    },
    body,
    diagnostics,
  };
}
