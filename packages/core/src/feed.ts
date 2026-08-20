/**
 * `feed.xml` — the thing that makes a blog followable.
 *
 * A blog nobody can subscribe to is a website that posts occasionally. The feed is therefore not
 * an extra a blog opts into; it is written by every build that *can* write one, and a build that
 * cannot says why.
 *
 * Atom rather than RSS, for one reason that matters: Atom requires an unambiguous `id` and a date
 * format with no room for interpretation, where RSS's `guid` is optional and its `pubDate` is
 * RFC 822 with a timezone abbreviation nobody agrees on. Every reader in use understands both.
 *
 * ## Why it needs `site_url`
 *
 * Every URL in a feed is read somewhere else — in a reader, in an email digest, in another site's
 * aggregator — so a relative one resolves against a document that is not this site. That is the
 * same reason `link rel=canonical` needs an origin, and it is the same failure: not a broken link
 * but a link to somebody else's page. Without one, no feed is written and the build says so,
 * rather than shipping a file whose every entry points at nothing.
 *
 * ## What is not in it
 *
 * Drafts, because they are not published. Full post bodies, because a summary and a link is what a
 * feed is for and a feed carrying every figure of every post is a megabyte a reader downloads to
 * decide whether to read one paragraph. Pagination (RFC 5005), because a first blog's archive fits
 * in one document and a paged feed nobody needed is a second thing to get wrong.
 */
import { rfc3339 } from "./dates.js";
import { absoluteUrl, escapeAttr, type SeoOptions } from "./seo.js";
import { manifestPosts } from "./blog.js";
import type { Manifest } from "./types.js";

/** Where the feed is written, and the path every `<link rel="alternate">` addresses. */
export const FEED_PATH = "feed.xml";

const withBase = (base: string, href: string): string => `${base.replace(/\/$/, "")}${href}`;

/**
 * Whether this build writes a feed, and where it will be — as a **site URL**, which is what a
 * page's `<link rel="alternate">` wants.
 *
 * One function rather than one condition per caller, because the callers have to agree: the
 * builder decides whether to write the file and the shell decides whether to advertise it, and a
 * page announcing a feed that was never written is worse than a page announcing nothing.
 */
export function feedUrl(manifest: Manifest, opts: SeoOptions = {}): string | undefined {
  if (manifest.article.form !== "blog") return undefined;
  if (manifest.article.status !== "published") return undefined;
  if (opts.mirrorOf !== undefined && opts.mirrorOf !== "") return undefined;
  const siteUrl = opts.siteUrl ?? manifest.article.siteUrl;
  if (siteUrl === undefined || siteUrl === "") return undefined;
  return `${(opts.base ?? "/").replace(/\/$/, "")}/${FEED_PATH}`;
}

/**
 * An element with text content, or nothing at all when there is no content to put in it.
 *
 * Atom has no notion of an empty `<author><name/></author>`, and a reader that meets one shows a
 * post written by nobody in particular. Omitting the element says the same thing and says it in
 * the vocabulary the format actually has.
 */
const el = (name: string, text: string | undefined, attrs = ""): string =>
  text === undefined || text === "" ? "" : `<${name}${attrs}>${escapeAttr(text)}</${name}>`;

/**
 * The blog's Atom feed, or `undefined` when this build is not one that writes a feed.
 *
 * The feed's own `updated` is the newest post's date rather than the moment of the build. A
 * timestamp that moves every time CI runs makes every conditional request a full download and
 * tells a reader something changed when nothing did.
 */
export function feedXml(manifest: Manifest, opts: SeoOptions = {}): string | undefined {
  const path = feedUrl(manifest, opts);
  if (path === undefined) return undefined;
  const siteUrl = opts.siteUrl ?? manifest.article.siteUrl;
  const base = opts.base ?? "/";
  const article = manifest.article;
  const home = absoluteUrl(withBase(base, article.rootHref), siteUrl)!;
  const self = absoluteUrl(path, siteUrl)!;

  const entries: string[] = [];
  let newest: string | undefined;
  for (const post of manifestPosts(manifest)) {
    const url = absoluteUrl(withBase(base, post.href), siteUrl);
    if (url === undefined) continue;
    const meta = post.meta;
    const published = rfc3339(meta.date ?? "");
    const updated = rfc3339(meta.updated ?? "") ?? published;
    // Atom makes `updated` mandatory on an entry, so a post whose date pagina cannot turn into a
    // timestamp is left out rather than emitted without one — an entry missing it invalidates the
    // whole document, taking the other posts down with it. `renderArticle` has already warned.
    if (updated === undefined) continue;
    if (newest === undefined || updated > newest) newest = updated;
    const author = meta.author ?? article.author;
    entries.push(
      `  <entry>\n` +
      `    ${el("title", meta.title)}\n` +
      `    <id>${escapeAttr(url)}</id>\n` +
      `    <link rel="alternate" type="text/html" href="${escapeAttr(url)}"/>\n` +
      `    <updated>${escapeAttr(updated)}</updated>\n` +
      (published === undefined ? "" : `    <published>${escapeAttr(published)}</published>\n`) +
      (author === undefined ? "" : `    <author>${el("name", author)}</author>\n`) +
      (meta.description === undefined ? "" : `    ${el("summary", meta.description, ` type="text"`)}\n`) +
      (meta.tags ?? []).map((t) => `    <category term="${escapeAttr(t)}"/>\n`).join("") +
      `  </entry>`,
    );
  }
  // A blog on its first day has no post to date the feed by. The article's own dates answer next,
  // and the epoch is the last resort — a document that is valid and says "nothing has happened
  // yet", rather than one a reader refuses to parse.
  const updated = newest ?? rfc3339(article.updated ?? "") ?? rfc3339(article.published ?? "") ?? "1970-01-01T00:00:00Z";
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  ${el("title", article.title)}\n` +
    (article.description === undefined ? "" : `  ${el("subtitle", article.description)}\n`) +
    `  <id>${escapeAttr(home)}</id>\n` +
    `  <link rel="alternate" type="text/html" href="${escapeAttr(home)}"/>\n` +
    `  <link rel="self" type="application/atom+xml" href="${escapeAttr(self)}"/>\n` +
    `  <updated>${escapeAttr(updated)}</updated>\n` +
    (article.author === undefined ? "" : `  <author>${el("name", article.author)}</author>\n`) +
    (entries.length === 0 ? "" : `${entries.join("\n")}\n`) +
    `</feed>\n`;
}
