/**
 * The blog form: which files are posts, what order they come in, and the list that says so.
 *
 * `form: blog` is not a second kind of project. It is the same folder, the same pages and the same
 * renderer, with one thing swapped: **where the order comes from.** A docs article is ordered by
 * `nav`, because someone decided what to read first. A blog is ordered by date, because nobody
 * decides that — the calendar does — and a blog whose order had to be maintained by hand is a blog
 * whose author edits `article.yaml` every time they write.
 *
 * So for a blog `nav` stops meaning reading order and starts meaning *standalone pages*: about,
 * colophon, the things that are not posts and never appear in the archive. Everything else in the
 * folder is a post.
 *
 * ## What the index page is
 *
 * It is `index.md` — a page the author writes — with the list of posts appended to it. The words
 * are the author's and the list is pagina's, and the split is the honest one: nobody wants to
 * maintain a list of their own posts by hand, and nobody wants a generated headline either.
 *
 * That also settles three questions that would otherwise each need an answer. The index survives
 * `pack`/`unpack` because it is a file in the folder like any other. It renders in the editor's
 * preview because the preview runs this same renderer. And it can carry its own front matter — a
 * cover, a description, a social card — because it is a page, not a template.
 */
import { dateStamp, readableDate } from "./dates.js";
import { escapeAttr } from "./seo.js";
import type { Manifest, PageMeta } from "./types.js";

/** The page a blog's post list is appended to, and the page served at `/`. */
export const BLOG_INDEX_PAGE = "index.md";

/** A post as the index and the feed need it: an href, and the metadata already resolved. */
export interface PostRef {
  readonly href: string;
  /** The page's source path, which breaks ties between two posts written on the same day. */
  readonly path: string;
  readonly meta: PageMeta;
}

/**
 * Newest first — the one ordering the index, the feed and the older/newer pager all read.
 *
 * Ties are broken on the source path so that two posts dated the same day come out in the same
 * order on every machine and in every rebuild. A feed that reshuffles itself between builds
 * re-notifies every subscriber about posts they have already read, and an index that does it makes
 * a rebuild look like an edit to every diff that watches the site.
 *
 * Drafts and undated posts never reach here: they are filtered out where the diagnostic that names
 * them is raised, so an omission is always a reported one.
 */
export function byNewest<T extends { readonly path: string; readonly date: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    dateStamp(b.date) - dateStamp(a.date) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const withBase = (base: string, href: string): string => `${base.replace(/\/$/, "")}${href}`;

/**
 * One entry in the index: a title that is a link, the date, and whatever else the post has.
 *
 * Every part below the title is independently optional, for the same reason the article header's
 * meta row is: a blog whose first post has no cover and no description must render a first post,
 * not an empty card with separators in it.
 *
 * The cover is a link too rather than a decoration next to one, because a picture at the top of an
 * entry is the thing a reader aims at. It is `lazy` without exception — an index is a column of
 * images most of which are below the fold, and the one at the top is not the page's LCP element
 * the way a hero is.
 */
function postHtml(post: PostRef, base: string): string {
  const { meta } = post;
  const href = escapeAttr(withBase(base, post.href));
  const cover = meta.cover === undefined
    ? ""
    : `<a class="pg-post__cover" href="${href}" tabindex="-1" aria-hidden="true"><img src="${escapeAttr(meta.cover)}" alt="" loading="lazy" decoding="async"></a>`;
  const items = [
    meta.date === undefined ? "" : `<time datetime="${escapeAttr(meta.date)}">${escapeAttr(readableDate(meta.date))}</time>`,
    meta.readingMinutes === undefined ? "" : `<span>${String(meta.readingMinutes)} min read</span>`,
  ].filter((s) => s !== "");
  const metaRow = items.length === 0
    ? ""
    : `<p class="pg-post__meta">${items.join(`<span class="pg-post__sep" aria-hidden="true">·</span>`)}</p>`;
  const summary = meta.description === undefined ? "" : `<p class="pg-post__summary">${escapeAttr(meta.description)}</p>`;
  const tags = (meta.tags ?? []).length === 0
    ? ""
    : `<p class="pg-post__tags">${(meta.tags ?? []).map((t) => `<span class="pg-post__tag">${escapeAttr(t)}</span>`).join("")}</p>`;
  return `<li class="pg-post">${cover}<h2 class="pg-post__title"><a href="${href}">${escapeAttr(meta.title)}</a></h2>${metaRow}${summary}${tags}</li>`;
}

/**
 * The blog's archive, as the markup appended to `index.md`.
 *
 * An **ordered** list, because the order is the content: these are posts newest first, not a set of
 * links that happen to be in some sequence. `reversed` makes the numbering count down from the
 * newest, which is what an archive numbered at all would mean; no numbers are shown, but the
 * accessibility tree carries the relationship either way.
 *
 * An empty blog gets a sentence rather than an empty list. A folder with `form: blog`, an
 * `index.md` and nothing else is a blog on its first day, and the honest thing to render is that.
 */
export function postListHtml(posts: readonly PostRef[], base: string): string {
  if (posts.length === 0) return `<p class="pg-posts__empty">No posts yet.</p>`;
  return `<ol class="pg-posts" reversed>${posts.map((p) => postHtml(p, base)).join("")}</ol>`;
}

/** The posts of a rendered blog, newest first, read back off a manifest. */
export function manifestPosts(manifest: Manifest): PostRef[] {
  return (manifest.posts ?? []).flatMap((href) => {
    const meta = manifest.pages[href];
    return meta === undefined ? [] : [{ href, path: href, meta }];
  });
}
