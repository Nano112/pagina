import type { OgConfig } from "./og.js";

/**
 * A person, as the host that authenticated them describes them.
 *
 * It lives in core rather than in the editor because two unrelated things need the same shape: the
 * editor's backend contract, which reports who last wrote a file, and `bundle.json`, which can
 * carry that across a `pack`. Two structurally identical `Author` types in two packages is the
 * arrangement in which they drift.
 *
 * `id` is the host's own identifier — a database key, an LDAP uid, a username. `name` is what the
 * person is called, and is **required**, because a UI that shows a UUID is not attribution. Neither
 * is ever supplied by the browser; see the write path in `docs/editing.md`.
 */
export interface Author {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

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

/**
 * How the cover fills its band.
 *
 * The cover spans the whole page, so it has a shape of its own and the image has to be fitted into
 * it. pagina copies the file without decoding it, so it never learns what the picture *is* — and
 * the two kinds of cover want opposite answers. A photograph cropped to a band loses nothing that
 * was carrying meaning; a wordmark cropped to a band loses the start of the word, which is the
 * failure that produced this option.
 *
 * `"contain"` is therefore the default: the whole image, letterboxed. `"cover"` is the author
 * saying "this is a photograph, fill the band".
 */
export type CoverFit = "cover" | "contain";

/**
 * What kind of thing this folder is — which is to say, **where its order comes from**.
 *
 * `"docs"` is ordered by `nav`: somebody decided what to read first, and that decision is the
 * article's structure. `"blog"` is ordered by date, because nobody decides that, and `nav` shrinks
 * to what it means on a blog — the standalone pages (about, colophon) that are not posts.
 *
 * It is one field rather than two project types because everything else is the same: the same
 * markdown, the same figures, the same covers, reading times, search, cards and editor. A blog is
 * a docs site that sorts by date and can be subscribed to.
 */
export type ArticleForm = "docs" | "blog";

export interface ArticleConfig {
  readonly slug: string; readonly title: string; readonly form: ArticleForm;
  readonly status: "draft" | "published"; readonly visibility: "public" | "members" | "authors";
  readonly category?: string; readonly tags: readonly string[];
  readonly theme?: string;
  /** Cover image, as written: a path relative to the article folder, or an absolute URL. */
  readonly cover?: string;
  /** Alt text for the cover. Absent, consumers fall back to the article title — never to "". */
  readonly coverAlt?: string;
  /** Where the cover header renders. `article.yaml` writes it as `cover_on`. Default `"root"`. */
  readonly coverOn: CoverOn;
  /** How the cover fills its band. `article.yaml` writes it as `cover_fit`. Default `"contain"`. */
  readonly coverFit?: CoverFit;
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
    /**
     * Named palettes a single `<figure>` may choose between with `data-theme`, as module paths or
     * runtime theme names.
     *
     * `theme` above is the article's declaration and applies to every figure that says nothing.
     * This is the vocabulary for the figure that wants to say something: level 5 of the cascade
     * needs a name that means the same thing to the pre-render and to the browser, or the figure
     * changes colour the moment the runtime lands.
     */
    readonly themes?: Readonly<Record<string, string>>;
    readonly width?: number;
    readonly widths?: readonly number[];
  };
  /**
   * The social card every page of this article gets, unless the page says otherwise.
   *
   * Written `og:` in `article.yaml`, and `og: false` to opt out. A page overrides it field by
   * field — see {@link PageFrontMatter.og} and `resolveOgConfig`.
   */
  readonly og?: OgConfig;
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
  /**
   * This figure's theme — level 5 of the cascade, and the narrowest scope there is.
   *
   * Written `data-theme` on the `<figure>`, and it is a *name*, not a path: `inherit`, or a theme
   * Kineglyph's runtime knows. A name is the whole vocabulary here on purpose. The article-level
   * declaration (`kineglyph.theme`) may be a module because an article is where a palette is
   * authored; a figure is where one is *chosen*, and the set to choose from is the one both the
   * pre-render and the browser can resolve identically.
   *
   * Absent means the figure inherits — which is also what `inherit` means written down. The
   * difference is only that one of them is a decision an author can see and a reviewer can ask
   * about, and the design asked for that to be expressible.
   */
  readonly theme?: string;
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
  /** How this page's cover fills its band. Written `cover_fit`. See {@link CoverFit}. */
  readonly coverFit?: CoverFit;
  /**
   * This page's theme — level 4 of the cascade.
   *
   * A path to a CSS file writing `--pg-*`, relative to *this page*, or an absolute URL; or the
   * word `inherit`, which is what a page that says nothing already does and is here so that
   * following the article can be written down rather than only implied.
   */
  readonly theme?: string;
  readonly author?: string;
  readonly published?: string;
  readonly updated?: string;
  /**
   * When this post was written — a blog's sort key, and required for a post.
   *
   * It is a separate field from {@link published} rather than a spelling of it because the two
   * fall back differently. `published` inherits `article.yaml`'s, which is right for a docs page:
   * every page of one article was published when the article was. Inheriting it on a blog would
   * give every undated post the same date and sort the archive into an arbitrary order that looks
   * deliberate. So `date` is the page's own or nothing, and a post without one is an error naming
   * the file. It does fill `published` when the page declares no `published` of its own, because a
   * post's `article:published_time` is exactly this date.
   */
  readonly date?: string;
  /**
   * Written, not published: out of the index, the feed and the sitemap, but still built.
   *
   * "Still built" is the useful half. A draft has a URL and can be read and shared — which is what
   * makes it reviewable — it simply is not announced anywhere. A page that would not build until
   * it was finished could not be looked at until it was finished.
   */
  readonly draft?: boolean;
  /** Keeps this page out of `sitemap.xml` and gives it `<meta name="robots" content="noindex">`. */
  readonly noindex?: boolean;
  readonly tags?: readonly string[];
  /** This page's social card, overriding the article's field by field. `og: false` opts out. */
  readonly og?: OgConfig;
}

export interface RenderedPage {
  readonly path: string; readonly href: string; readonly title: string;
  readonly html: string; readonly headings: readonly Heading[];
  readonly figures: readonly FigureRef[]; readonly links: readonly LinkRef[];
  /** The page's front matter, parsed. Empty when the page had none. */
  readonly frontMatter: PageFrontMatter;
  /** The page's first paragraph as plain text, second in the description chain. */
  readonly excerpt?: string;
  /** Whole minutes to read this page's prose. Absent when the page has none. See `reading-time.ts`. */
  readonly readingMinutes?: number;
}
export interface NavNode { readonly title: string; readonly href?: string; readonly children?: readonly NavNode[] }

/**
 * What a shell (or a host) needs to render one page's chrome and its metadata.
 *
 * The four metadata fields are **already resolved**: page front matter wins over `article.yaml`,
 * `description` has run the whole fallback chain (page → the page's first paragraph → article) and is
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
  /** How {@link cover} fills its band. Already resolved: the page's, else the article's. */
  readonly coverFit?: CoverFit;
  /**
   * Site URL of the social card pagina drew for this page, when it drew one.
   *
   * The **third** choice for `og:image`, behind the page's cover and the article's: someone who
   * drew a card gets their card. It is a separate field rather than a value written into
   * {@link cover} because a card is not a cover — nothing puts it in the page's own header band,
   * and a host that wants only real artwork can ignore this field and keep the old behaviour.
   */
  readonly card?: string;
  /** Alt text for {@link card}: the author's `og.alt`, else derived from the card's own content. */
  readonly cardAlt?: string;
  /**
   * Site URL of **this page's own** theme stylesheet — level 4 of the cascade.
   *
   * Absent when the page declared no `theme:`, or declared `inherit`. It does not fold in the
   * article's ({@link ArticleMeta.theme}): a consumer links the article's first and this one
   * after, so a page that redefines one token keeps the article's answer for every other. Both are
   * plain `--pg-*` stylesheets, which is the whole reason two of them compose.
   */
  readonly theme?: string;
  readonly author?: string;
  readonly published?: string;
  readonly updated?: string;
  /**
   * This post's own date — the blog index's sort key and the feed's `published`.
   *
   * Present only when the page declared one. Unlike {@link published} it never inherits the
   * article's date: see {@link PageFrontMatter.date} for why an inherited sort key is worse than a
   * missing one.
   */
  readonly date?: string;
  /** True for a post the author marked `draft`. Absent from the index, the feed and the sitemap. */
  readonly draft?: boolean;
  readonly tags?: readonly string[];
  /** True for a page the author marked `noindex`, for a draft post, and for every page of a draft article. */
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
export interface ArticleMeta extends Omit<ArticleConfig, "nav" | "snippets" | "cover" | "theme" | "exclude" | "excludeGitignore"> {
  /** Resolved site URL of the article cover, or the absolute URL the author gave. */
  readonly cover?: string;
  /**
   * Resolved site URL of the article's theme stylesheet — level 3 of the cascade.
   *
   * Absent when `article.yaml` declared none, or declared `inherit`. A page may override it; the
   * answer for one page is that page's {@link PageMeta.theme}.
   */
  readonly theme?: string;
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
  /**
   * A blog's posts, newest first — hrefs into {@link pages}. Absent for `form: docs`.
   *
   * Emitted rather than re-derived because four things read this order and none of them may
   * disagree: the index page's list, the feed, the older/newer pager, and a host reading
   * `manifest.json` that has no renderer of its own. Drafts and undated posts are already out.
   */
  readonly posts?: readonly string[];
  readonly pages: Readonly<Record<string, PageMeta>>;   // keyed by href
  readonly figures: Readonly<Record<string, { readonly page: string; readonly kind: FigureRef["kind"]; readonly scene?: string; readonly staticBase: string }>>;
  readonly assets: readonly string[];
}
export interface RenderedArticle { readonly manifest: Manifest; readonly pages: Readonly<Record<string, RenderedPage>>; readonly diagnostics: readonly Diagnostic[] }
