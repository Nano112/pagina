/**
 * `llms.txt` and `llms.json` — the article, addressed to a reader that is a program.
 *
 * ## Why these exist, and why they are this small
 *
 * A build already knows every page, every section, every stable anchor and a resolved description
 * for each page: that is what `manifest.json` is. What it does not have is a *front door*. An agent
 * pointed at a docs site has to guess that `_pagina/manifest.json` is there, and a human pasting a
 * URL into a chat window has to hope something crawled it. `llms.txt` is the emerging convention
 * for that door — a title, a sentence, and a linked list of the pages — and it costs one derived
 * file over data that is already computed. `llms.json` is the same walk with the sections kept, for
 * the consumer that wants to enumerate rather than read.
 *
 * Both are therefore **projections**, not a subsystem. Nothing here parses, renders, or decides
 * anything: if a description is wrong in `llms.txt` it is wrong in the `<meta>` tag too, which is
 * the property that keeps them honest. Neither file is a content store — they name where the prose
 * is, and the prose is at those URLs, in HTML, where it already was.
 *
 * ## What is deliberately not here
 *
 * No page bodies, no markdown mirror, no `llms-full.txt`. A copy of every page in a second format
 * is a second thing to keep in step, and the argument for it — "an agent cannot read HTML" — has
 * not been true for some time. If it turns out to be wanted, `.rendered/` in a bundle already *is*
 * that copy, and an MCP server over a `.pgz` is the shape it should take rather than a fourth
 * flavour of the same text at the site root.
 *
 * ## Addressing
 *
 * Every URL is absolute when the build knows its origin, and site-absolute (base included) when it
 * does not. A relative link in a file whose whole purpose is to be fetched out of context is a link
 * that resolves against whatever the fetcher was doing at the time, so there are none.
 */
import type { Manifest } from "./types.js";
import { SEARCH_INDEX_PATH } from "./search.js";
import { absoluteUrl, type SeoOptions } from "./seo.js";

/** Where a static build writes the index for agents, relative to the output root. */
export const LLMS_TXT_PATH = "llms.txt";
/** Where the machine-readable half goes. Under `_pagina/`, with the manifest it is derived from. */
export const LLMS_JSON_PATH = "_pagina/llms.json";
/** The format version of {@link LlmsJson}. Bumped when an old reader would misread a new file. */
export const LLMS_JSON_VERSION = 1;

/** One heading, as somewhere a consumer can fetch and quote. */
export interface LlmsSection {
  /** The heading's anchor id — stable, and the same one the TOC and the search index use. */
  readonly id: string;
  readonly title: string;
  /** 2 or 3: the levels pagina gives a place in the document to. */
  readonly level: number;
  /** The section's URL, anchor included. */
  readonly url: string;
}

export interface LlmsPage {
  /** The page's href as the manifest keys it — without `base`. The join key back to the manifest. */
  readonly href: string;
  /** Where to fetch this page. Absolute when the build knows its origin. */
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  /** Minutes of prose, when the page has any. */
  readonly readingMinutes?: number;
  readonly sections: readonly LlmsSection[];
}

export interface LlmsJson {
  readonly version: number;
  readonly generator: "pagina";
  readonly title: string;
  readonly description?: string;
  /** The site base the URLs below were built for. */
  readonly base: string;
  /** The origin, when one is configured. Absent means every URL below is a path, not a URL. */
  readonly siteUrl?: string;
  /** The manifest these pages were projected from — richer, and the thing to fetch next. */
  readonly manifest: string;
  /** The section-level search index, when the build wrote one. */
  readonly search?: string;
  readonly pages: readonly LlmsPage[];
}

const withBase = (base: string, href: string): string => `${base.replace(/\/$/, "")}${href}`;

/** A site path as the most addressable form the build can honestly produce. */
const address = (path: string, siteUrl: string | undefined): string =>
  absoluteUrl(path, siteUrl) ?? path;

export interface LlmsOptions extends SeoOptions {
  /** The build wrote a search index. Default `true`; `false` leaves `search` out of the JSON. */
  readonly search?: boolean;
}

/**
 * Which pages an agent is told about.
 *
 * The same rule `sitemap.xml` uses, for the same reason: a page marked `noindex` is a page the
 * author asked not to be listed, and "listed somewhere a crawler will not look" is not what they
 * asked for. A draft article lists nothing at all — it is not published, and an index of it would
 * be the one artefact that says otherwise.
 */
function listedPages(manifest: Manifest): [string, Manifest["pages"][string]][] {
  if (manifest.article.status !== "published") return [];
  return Object.entries(manifest.pages).filter(([, meta]) => meta.noindex !== true);
}

/** The article as {@link LlmsJson}. Pure: everything here is already in the manifest. */
export function llmsJson(manifest: Manifest, opts: LlmsOptions = {}): LlmsJson {
  const base = opts.base ?? "/";
  const siteUrl = opts.siteUrl ?? manifest.article.siteUrl;
  const root = absoluteUrl("/", siteUrl);
  const origin = root === undefined ? undefined : root.replace(/\/$/, "");
  const pages = listedPages(manifest).map(([href, meta]): LlmsPage => {
    const url = address(withBase(base, href), siteUrl);
    return {
      href,
      url,
      title: meta.title,
      ...(meta.description === undefined ? {} : { description: meta.description }),
      ...(meta.readingMinutes === undefined ? {} : { readingMinutes: meta.readingMinutes }),
      sections: meta.headings
        .filter((h) => (h.level === 2 || h.level === 3) && h.id !== "")
        .map((h) => ({ id: h.id, title: h.text, level: h.level, url: `${url}#${h.id}` })),
    };
  });
  return {
    version: LLMS_JSON_VERSION,
    generator: "pagina",
    title: manifest.article.title,
    ...(manifest.article.description === undefined ? {} : { description: manifest.article.description }),
    base,
    // The **origin the URLs above were actually built from**, which is not always the configured
    // `site_url`: a path in it is dropped (the site-absolute paths already carry `base`), and the
    // build warns when one is set. Echoing the raw value here would make this file the third
    // account of where the site lives, and the one that disagreed with its own `pages`.
    ...(origin === undefined ? {} : { siteUrl: origin }),
    manifest: address(`${base.replace(/\/$/, "")}/_pagina/manifest.json`, siteUrl),
    ...(opts.search === false ? {} : { search: address(`${base.replace(/\/$/, "")}/${SEARCH_INDEX_PATH}`, siteUrl) }),
    pages,
  };
}

/** `llms.json` as the bytes a build writes — indented, because a person opens this one too. */
export function serializeLlmsJson(json: LlmsJson): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

/**
 * One line of a markdown list, with the description as the note the convention allows after a colon.
 *
 * A page with neither a description nor an opening paragraph resolves to the *article's*, which is
 * right for a `<meta>` tag — a page has to say something — and wrong here, where it would print the
 * same sentence after every such link and say nothing about any of them. That is the last rung of
 * the chain rather than the second one, so this is now the rare case rather than the common one,
 * and the suppression still has to be here for it. Recognised by prefix rather than by
 * equality because the page's copy has been truncated on a word boundary and the blockquote's has
 * not. `llms.json` keeps it: there it is the page's resolved description, the same string the meta
 * tag carries, and a consumer that wants to dedupe has the article's description in hand.
 */
function listItem(page: LlmsPage, articleDescription: string | undefined): string {
  const own = page.description?.replace(/\s+/g, " ").trim();
  const inherited = own !== undefined && articleDescription !== undefined
    && articleDescription.replace(/\s+/g, " ").trim().startsWith(own.replace(/…$/, ""));
  const note = own === undefined || inherited ? "" : `: ${own}`;
  return `- [${page.title}](${page.url})${note}`;
}

/**
 * The article as `llms.txt`: an H1, an optional blockquote, and a linked list of the pages.
 *
 * The convention's shape, and nothing beyond it. The one judgement call is that every page goes in
 * one `## Docs` list rather than being grouped by the nav's sections: a consumer reading this wants
 * the set of URLs, and a two-level list of nine-page sections is structure that `llms.json` and the
 * manifest already carry properly, expressed here in a way nothing can parse reliably.
 */
export function llmsTxt(manifest: Manifest, opts: LlmsOptions = {}): string {
  const json = llmsJson(manifest, opts);
  const lines = [`# ${json.title}`, ""];
  if (json.description !== undefined) lines.push(`> ${json.description.replace(/\s+/g, " ").trim()}`, "");
  lines.push("## Docs", "");
  for (const page of json.pages) lines.push(listItem(page, json.description));
  const self = address(`${json.base.replace(/\/$/, "")}/${LLMS_JSON_PATH}`, json.siteUrl);
  lines.push("", "## Machine-readable", "");
  lines.push(`- [Page and section index](${self}): every page with its sections and their anchors, as JSON.`);
  lines.push(`- [Article manifest](${json.manifest}): nav, breadcrumbs, figures and per-page metadata.`);
  if (json.search !== undefined) lines.push(`- [Search index](${json.search}): the same sections, with their prose, as the site's own search reads them.`);
  return `${lines.join("\n")}\n`;
}
