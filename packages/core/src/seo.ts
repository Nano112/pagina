/**
 * The metadata a page needs in order to be indexed, and the two site-level files that go with it.
 *
 * pagina **emits** this; it does not decide where it goes. The static shell drops
 * {@link renderSeoHtml}'s output into `<head>`; a Laravel host reads the same values off
 * `manifest.json` and pushes them into whatever meta stacks it already has, so an article page
 * inherits the site's SEO conventions instead of competing with them.
 *
 * ## Two things this file exists to get right
 *
 * **Escaping.** Every value here is author-controlled and every one of them lands either in an
 * HTML attribute or inside a `<script type="application/ld+json">`. Those are two different
 * escaping problems and using the wrong one for either is a script-injection defect — this project
 * shipped exactly that once. {@link escapeAttr} handles the attribute case; {@link jsonLdScript}
 * handles the script case, where HTML escapes are *not* decoded and the only real danger is the
 * literal string `</script`. Both are used unconditionally, on every value, with no "this one is
 * safe" exceptions.
 *
 * **Absolute URLs.** `link rel=canonical`, `og:url`, `og:image` and `sitemap.xml` are meaningless
 * relative. They therefore need `site_url`, and when it is absent pagina **omits those tags** and
 * says so with a diagnostic, rather than emitting a relative value that silently indexes nothing
 * or, worse, the string `undefined`. Everything that is meaningful without an origin — the title,
 * the description, `og:title`, the Twitter card, the JSON-LD headline — is still emitted.
 */
import type { Diagnostic, Manifest, PageMeta } from "./types.js";

/** Longest meta description we emit. Past roughly this, search engines truncate it themselves. */
export const DESCRIPTION_MAX = 160;

const ATTR_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * A string bound for an HTML attribute or text node.
 *
 * `'` is escaped along with the usual four so the result is safe in a single-quoted attribute too,
 * which costs nothing and removes a footgun from any host that reuses this.
 */
export const escapeAttr = (s: string): string => s.replace(/[&<>"']/g, (c) => ATTR_ESCAPES[c]!);

/**
 * A `<script type="application/ld+json">` element containing `data`.
 *
 * The content of a `script` element is *raw text*: the parser does not decode HTML escapes there,
 * so `&lt;` would appear literally in the JSON and break it — but it also ends the element at the
 * first `</script`, which is how a description reading `</script><script>…` escapes the block. The
 * fix is to escape at the JSON level instead: `<`, `>` and `&` become their `\uXXXX` forms, which
 * JSON parsers decode back to the original characters and no HTML parser can see. That also
 * neutralises `<!--`, the other sequence that changes how raw text is scanned.
 */
export function jsonLdScript(data: unknown): string {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    // U+2028/U+2029 are legal in JSON but not in a JavaScript string literal; a host that hands
    // this text to a JS parser rather than a JSON one would otherwise choke on them.
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * `text`, cut to at most `max` characters at a **word boundary**, with an ellipsis.
 *
 * Cutting mid-word is the tell of a generated description, and the ellipsis has to be inside the
 * budget rather than pushed past it. A single word longer than `max` is cut where it has to be —
 * there is no boundary to find.
 */
export function truncateWords(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const room = max - 1;                       // the "…" counts
  const cut = clean.slice(0, room + 1);
  const space = cut.lastIndexOf(" ");
  const head = space > 0 ? cut.slice(0, space) : clean.slice(0, room);
  return `${head.replace(/[\s,;:.!?—-]+$/, "")}…`;
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Containers whose paragraphs are not the page's opening prose. */
const SKIP_TAGS = new Set(["aside", "figure", "details", "template", "nav", "header", "footer", "script", "style", "blockquote"]);
const TAG = /<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi;

/**
 * The first paragraph of a rendered page, as plain text — the last resort in the description chain.
 *
 * Taken from the HTML rather than the markdown because the markdown may still contain snippet
 * includes, tab syntax and admonition fences, none of which is prose. Paragraphs inside an
 * admonition, a tab or a figure caption are skipped: the first thing a reader sees is the article's
 * own opening line, not a warning box's.
 */
export function firstParagraph(html: string): string | undefined {
  TAG.lastIndex = 0;
  let skipTag: string | undefined;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(html)) !== null) {
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const attrs = m[3] ?? "";
    if (skipTag !== undefined) {
      // Inside a skipped subtree: only the tag that opened it is counted, so nesting of any other
      // element cannot end the skip early.
      if (name !== skipTag) continue;
      if (closing) { depth -= 1; if (depth === 0) skipTag = undefined; }
      else if (!attrs.trimEnd().endsWith("/")) depth += 1;
      continue;
    }
    if (closing) continue;
    if (SKIP_TAGS.has(name) || (name === "div" && /\bpg-tabs\b/.test(attrs))) {
      if (attrs.trimEnd().endsWith("/")) continue;
      skipTag = name;
      depth = 1;
      continue;
    }
    if (name !== "p") continue;
    // `p` cannot contain another `p`, so the next close tag is this paragraph's.
    const close = html.indexOf("</p>", TAG.lastIndex);
    if (close < 0) return undefined;
    const text = plainText(html.slice(TAG.lastIndex, close));
    if (text !== "") return text;
    TAG.lastIndex = close + 4;                 // an empty paragraph is not a description
  }
  return undefined;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (whole, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

/** One `<meta>`: OpenGraph uses `property`, everything else uses `name`. */
export interface MetaTag {
  readonly name?: string;
  readonly property?: string;
  readonly content: string;
}

export interface SeoOptions {
  /**
   * Absolute URL the site is served from. Any path in it is discarded — the site-absolute paths
   * pagina produces already carry `base` — so both `https://example.com` and
   * `https://example.com/docs` behave identically for a site built with `--base /docs/`.
   */
  readonly siteUrl?: string;
  /** The site base every href is served under. Default `"/"`. */
  readonly base?: string;
}

export interface PageSeo {
  /** `<title>`: the page title, then the article title. */
  readonly title: string;
  readonly description?: string;
  /** Absolute; present only when a site URL is configured. */
  readonly canonical?: string;
  /** Absolute when a site URL is configured, site-absolute otherwise. */
  readonly image?: string;
  readonly noindex: boolean;
  /** Every `<meta>` to emit, in order: description, robots, OpenGraph, Twitter. */
  readonly meta: readonly MetaTag[];
  /** The JSON-LD `Article` object, ready for {@link jsonLdScript}. */
  readonly jsonLd: Readonly<Record<string, unknown>>;
  /** Anything the metadata could not be completed with — a missing site URL, above all. */
  readonly diagnostics: readonly Diagnostic[];
}

/** `path` (site-absolute, base included) as an absolute URL, or `undefined` without an origin. */
export function absoluteUrl(path: string | undefined, siteUrl: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;      // the author gave an absolute URL
  if (siteUrl === undefined || siteUrl === "") return undefined;
  try {
    return new URL(path, siteUrl).toString();
  } catch {
    return undefined;
  }
}

const withBase = (base: string, href: string): string => `${base.replace(/\/$/, "")}${href}`;

/**
 * Everything a page's `<head>` needs, derived from the manifest alone.
 *
 * The manifest has already run the precedence chains (page front matter over `article.yaml`) and
 * resolved the cover to a site URL, so this is assembly and escaping, not policy — which is what
 * lets a host that cannot run this function still reach the same result from `manifest.json`.
 */
export function pageSeo(manifest: Manifest, href: string, opts: SeoOptions = {}): PageSeo {
  const page: PageMeta | undefined = manifest.pages[href];
  if (page === undefined) throw new Error(`pagina: no page "${href}" in the manifest`);
  const article = manifest.article;
  const base = opts.base ?? "/";
  const siteUrl = opts.siteUrl ?? article.siteUrl;
  const diagnostics: Diagnostic[] = [];

  const title = page.title === article.title ? article.title : `${page.title} · ${article.title}`;
  // `renderArticle` has already run the chain into `page.description`; falling back to the
  // article's here is belt and braces for a manifest assembled by hand or by an older build, so
  // that "the article has a description but this page's tag is empty" is not a reachable state.
  const description = page.description ?? article.description;
  const canonical = absoluteUrl(withBase(base, href), siteUrl);
  const image = absoluteUrl(page.cover ?? article.cover, siteUrl) ?? page.cover ?? article.cover;
  const noindex = page.noindex === true || article.status !== "published";

  if (siteUrl === undefined || siteUrl === "")
    diagnostics.push({
      severity: "warning",
      code: "seo-no-site-url",
      message: "no site_url is configured, so canonical, og:url and og:image are omitted; set `site_url` in article.yaml or pass --site-url",
      page: href,
    });

  const meta: MetaTag[] = [];
  const add = (tag: MetaTag | undefined): void => { if (tag !== undefined) meta.push(tag); };
  const named = (name: string, content: string | undefined): MetaTag | undefined =>
    content === undefined || content === "" ? undefined : { name, content };
  const prop = (property: string, content: string | undefined): MetaTag | undefined =>
    content === undefined || content === "" ? undefined : { property, content };

  add(named("description", description));
  if (noindex) add({ name: "robots", content: "noindex, nofollow" });

  add(prop("og:type", "article"));
  add(prop("og:site_name", article.title));
  add(prop("og:title", page.title));
  add(prop("og:description", description));
  add(prop("og:url", canonical));
  // Only an absolute image is worth emitting: every consumer of `og:image` fetches it from a
  // different origin, so a site-absolute path is a guaranteed 404 for all of them.
  const ogImage = absoluteUrl(page.cover ?? article.cover, siteUrl);
  add(prop("og:image", ogImage));
  add(prop("article:published_time", page.published ?? article.published));
  add(prop("article:modified_time", page.updated ?? article.updated));
  add(prop("article:author", page.author ?? article.author));
  for (const tag of page.tags ?? article.tags) add(prop("article:tag", tag));

  add(named("twitter:card", ogImage === undefined ? "summary" : "summary_large_image"));
  add(named("twitter:title", page.title));
  add(named("twitter:description", description));
  add(named("twitter:image", ogImage));

  const author = page.author ?? article.author;
  const published = page.published ?? article.published;
  const updated = page.updated ?? article.updated;
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    ...(description === undefined ? {} : { description }),
    ...(ogImage === undefined ? {} : { image: [ogImage] }),
    ...(published === undefined ? {} : { datePublished: published }),
    ...(updated === undefined ? {} : { dateModified: updated }),
    ...(author === undefined ? {} : { author: { "@type": "Person", name: author } }),
    ...(canonical === undefined ? {} : { mainEntityOfPage: { "@type": "WebPage", "@id": canonical } }),
  };

  return {
    title,
    ...(description === undefined ? {} : { description }),
    ...(canonical === undefined ? {} : { canonical }),
    ...(image === undefined ? {} : { image }),
    noindex,
    meta,
    jsonLd,
    diagnostics,
  };
}

/**
 * {@link pageSeo}'s output as `<head>` markup: title, metas, canonical link and the JSON-LD block.
 *
 * Newline-separated and unindented — a shell interpolates it into a `<head>` it owns the shape of.
 */
export function renderSeoHtml(seo: PageSeo): string {
  const lines = [`<title>${escapeAttr(seo.title)}</title>`];
  for (const tag of seo.meta) {
    const key = tag.property === undefined ? `name="${escapeAttr(tag.name!)}"` : `property="${escapeAttr(tag.property)}"`;
    lines.push(`<meta ${key} content="${escapeAttr(tag.content)}">`);
  }
  if (seo.canonical !== undefined) lines.push(`<link rel="canonical" href="${escapeAttr(seo.canonical)}">`);
  lines.push(jsonLdScript(seo.jsonLd));
  return lines.join("\n");
}

/**
 * `sitemap.xml` for the built site, or `undefined` when there is no site URL to write into it.
 *
 * Draft articles and `noindex` pages are left out: a sitemap is a request to index, and asking for
 * something the very next tag forbids is worse than saying nothing.
 */
export function sitemapXml(manifest: Manifest, opts: SeoOptions = {}): string | undefined {
  const siteUrl = opts.siteUrl ?? manifest.article.siteUrl;
  if (siteUrl === undefined || siteUrl === "") return undefined;
  if (manifest.article.status !== "published") return undefined;
  const base = opts.base ?? "/";
  const entries = Object.entries(manifest.pages)
    .filter(([, meta]) => meta.noindex !== true)
    .map(([href, meta]) => {
      const loc = absoluteUrl(withBase(base, href), siteUrl);
      if (loc === undefined) return "";
      const lastmod = meta.updated ?? manifest.article.updated;
      return `  <url>\n    <loc>${escapeAttr(loc)}</loc>${lastmod === undefined ? "" : `\n    <lastmod>${escapeAttr(lastmod)}</lastmod>`}\n  </url>`;
    })
    .filter((s) => s !== "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

/**
 * `robots.txt` for the built site.
 *
 * A draft article disallows everything — the `noindex` switch has to hold at the crawler's first
 * request, not only once it has read a page. A published one allows everything and points at the
 * sitemap, when there is a site URL to address it with.
 */
export function robotsTxt(manifest: Manifest, opts: SeoOptions = {}): string {
  const siteUrl = opts.siteUrl ?? manifest.article.siteUrl;
  const base = opts.base ?? "/";
  if (manifest.article.status !== "published") return "User-agent: *\nDisallow: /\n";
  const sitemap = absoluteUrl(`${base.replace(/\/$/, "")}/sitemap.xml`, siteUrl);
  return `User-agent: *\nAllow: /\n${sitemap === undefined ? "" : `\nSitemap: ${sitemap}\n`}`;
}
