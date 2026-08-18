export interface ContentFs {
  read(path: string): Promise<string>;                 // utf8; throws if missing
  readBinary(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;                // recursive, relative posix paths, files only
}
export interface NavPage { readonly title: string; readonly page: string }             // page = md path relative to folder
export interface NavSection { readonly section: string; readonly children: readonly NavEntry[] }
export type NavEntry = NavPage | NavSection;
/**
 * Which pages of an article show the cover header.
 *
 * A cover belongs to the **article**, not to each of its pages: an API reference three levels
 * into a docs article re-displaying the hero is a magazine that reprints its front page on every
 * spread. So the default is `"root"` — the header renders on the article's landing page and
 * nowhere else. `"all"` is for the author who disagrees (a set of standalone posts kept in one
 * folder), and `"none"` for a host that supplies its own hero and wants pagina's out of the way.
 */
export type CoverOn = "root" | "all" | "none";

export interface ArticleConfig {
  readonly slug: string; readonly title: string; readonly form: "docs";
  readonly status: "draft" | "published"; readonly visibility: "public" | "members" | "authors";
  readonly category?: string; readonly tags: readonly string[];
  readonly theme?: string;
  /** Cover image, as written: a path relative to the article folder, or an absolute URL. */
  readonly cover?: string;
  /** Alt text for the cover. Absent, consumers fall back to the article title — never to "". */
  readonly coverAlt?: string;
  /** Where the cover header renders. `article.yaml` writes it as `cover_on`. Default `"root"`. */
  readonly coverOn: CoverOn;
  /** Fallback meta description for every page that does not carry its own. */
  readonly description?: string;
  /** Byline. Emitted as `article:author` and as the JSON-LD `author`. */
  readonly author?: string;
  /**
   * Absolute origin (optionally with a path) the built site is served from, e.g.
   * `https://docs.example.com` or `https://example.com/docs`. Canonical links, `og:url`,
   * `og:image` and `sitemap.xml` all need one; without it those are omitted rather than emitted
   * relative, and the build says so. `article.yaml` writes it as `site_url`.
   */
  readonly siteUrl?: string;
  /** ISO-8601 publication / last-modified dates for the article as a whole. */
  readonly published?: string;
  readonly updated?: string;
  /**
   * `theme` is a path to a module exporting `{light,dark}`. `width` is the single container width
   * figures are drawn at; `widths` draws one variant per width and lets the page pick the one that
   * fits (see `FIGURE_WIDTHS` in `figures.ts`), which is what makes a figure readable on a phone.
   */
  readonly kineglyph?: {
    readonly theme?: string;
    readonly width?: number;
    readonly widths?: readonly number[];
  };
  readonly snippets: { readonly roots: readonly string[] };                    // default ["."]
  /**
   * Files in the folder that are not article content, as gitignore-shaped globs.
   *
   * The build copies assets verbatim, so this list is the difference between "in the folder" and
   * "on the public web". {@link DEFAULT_EXCLUDE} is always applied first and these are appended,
   * so a `!` entry here can re-include something a default caught. `article.yaml` writes it as
   * `exclude`.
   */
  readonly exclude: readonly string[];
  /**
   * Whether a folder inside a git work tree also excludes what git ignores. Default `true`.
   *
   * `.gitignore` is the expression of "not for publication" that most folders already have, and
   * the one that would have kept a directory of internal notes off the public web. It is honoured
   * rather than guessed at: what it dropped is reported by every build. `article.yaml` writes it
   * as `exclude_gitignore`.
   */
  readonly excludeGitignore: boolean;
  readonly nav: readonly NavEntry[];
}
export interface Heading { readonly id: string; readonly text: string; readonly level: number }
export interface FigureRef {
  readonly id: string; readonly kind: "inline" | "module" | "static";
  readonly source?: string; readonly scene?: string; readonly static?: string;
}
export interface LinkRef { readonly raw: string; readonly resolved?: string; readonly line?: number }
export interface Diagnostic { readonly severity: "error" | "warning"; readonly code: string; readonly message: string; readonly page?: string }

/**
 * The page metadata a page's own front matter may declare.
 *
 * Every field here **overrides** the article-level one of the same name. The front matter block
 * itself is never rewritten by the renderer — it is stripped from the markdown before parsing and
 * read separately — so a page keeps the key order and comments its author gave it.
 */
export interface PageFrontMatter {
  readonly title?: string;
  readonly description?: string;
  /** Path relative to *the page*, or an absolute URL. */
  readonly cover?: string;
  /** Alt text for this page's cover. Written `cover_alt` in the front-matter block. */
  readonly coverAlt?: string;
  readonly author?: string;
  readonly published?: string;
  readonly updated?: string;
  /** Keeps this page out of `sitemap.xml` and gives it `<meta name="robots" content="noindex">`. */
  readonly noindex?: boolean;
  readonly tags?: readonly string[];
}

export interface RenderedPage {
  readonly path: string; readonly href: string; readonly title: string;
  readonly html: string; readonly headings: readonly Heading[];
  readonly figures: readonly FigureRef[]; readonly links: readonly LinkRef[];
  /** The page's front matter, parsed. Empty when the page had none. */
  readonly frontMatter: PageFrontMatter;
  /** The page's first paragraph as plain text — the last resort in the description chain. */
  readonly excerpt?: string;
  /** Whole minutes to read this page's prose. Absent when the page has none. See `reading-time.ts`. */
  readonly readingMinutes?: number;
}
export interface NavNode { readonly title: string; readonly href?: string; readonly children?: readonly NavNode[] }

/**
 * What a shell (or a host) needs to render one page's chrome and its metadata.
 *
 * The four metadata fields are **already resolved**: page front matter wins over `article.yaml`,
 * `description` has run the whole fallback chain (page → article → first paragraph) and is
 * truncated on a word boundary, and `cover` is a site URL (it includes `base`), not the path the
 * author typed. A consumer — pagina's own shell, or a Laravel host reading `manifest.json` — puts
 * them straight into tags without re-deriving anything.
 */
export interface PageMeta {
  readonly title: string; readonly headings: readonly Heading[]; readonly prev?: string; readonly next?: string;
  readonly breadcrumbs: readonly { title: string; href?: string }[];
  readonly description?: string;
  /** Resolved site URL of the cover image, or the absolute URL the author gave. */
  readonly cover?: string;
  /** Alt text for {@link cover}. Already resolved: the author's, else the article title. */
  readonly coverAlt?: string;
  readonly author?: string;
  readonly published?: string;
  readonly updated?: string;
  readonly tags?: readonly string[];
  /** True for a page the author marked `noindex`, and for every page of a draft article. */
  readonly noindex?: boolean;
  /**
   * Whole minutes to read this page — at least 1, absent when the page has no prose.
   *
   * The **one** number every consumer uses. Computed in the build from rendered prose (see
   * `reading-time.ts`) so pagina's shell, a Laravel host and an index card cannot disagree.
   */
  readonly readingMinutes?: number;
}

/** `article.yaml`, minus the fields that describe the build rather than the article. */
export interface ArticleMeta extends Omit<ArticleConfig, "nav" | "snippets" | "cover" | "exclude" | "excludeGitignore"> {
  /** Resolved site URL of the article cover, or the absolute URL the author gave. */
  readonly cover?: string;
  /**
   * The href of the article's landing page — the first page in nav order.
   *
   * Emitted rather than derived because every consumer needs it to honour `coverOn: "root"`, and
   * three consumers walking `nav` for the first leaf is three chances to walk it differently.
   */
  readonly rootHref: string;
  /**
   * Minutes to read the whole article: the sum of every page's `readingMinutes`.
   *
   * For an index card that summarises a multi-page article. Absent when no page has prose.
   */
  readonly readingMinutes?: number;
}

export interface Manifest {
  readonly article: ArticleMeta;
  readonly nav: readonly NavNode[];
  readonly pages: Readonly<Record<string, PageMeta>>;   // keyed by href
  readonly figures: Readonly<Record<string, { readonly page: string; readonly kind: FigureRef["kind"]; readonly scene?: string; readonly staticBase: string }>>;
  readonly assets: readonly string[];
}
export interface RenderedArticle { readonly manifest: Manifest; readonly pages: Readonly<Record<string, RenderedPage>>; readonly diagnostics: readonly Diagnostic[] }
