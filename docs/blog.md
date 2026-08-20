---
description: >-
  form: blog takes the order from dates instead of the nav, generates the index, and writes an Atom
  feed. Everything else in the article folder works the way it already did.
---

# A blog

A blog in pagina is not a second kind of project. It is the same folder, with one line changed:

```yaml
form: blog
```

That line changes where the order comes from. A docs article gets its order from `nav`, because
somebody decided what to read first. A blog gets its order from dates, because nobody decides that.
Everything else on this site's contract pages still applies: the markdown dialect, figures, covers,
descriptions, reading time, search, social cards, `llms.txt`, bundles and the editor all behave
exactly as they do for `form: docs`.

## What a blog folder looks like

```
field-notes/
  article.yaml
  index.md                    the front page: your words, plus the generated archive
  about.md                    listed in nav, so it is a standalone page
  on-writing-it-down.md       date: 2026-08-18
  the-smaller-toolbox.md      date: 2026-07-02
  a-week-of-reading-logs.md   date: 2026-05-11
  caching-notes.md            draft: true
  media/
```

The real thing is in the repository at
[`examples/blog`](https://github.com/Nano112/pagina/tree/main/examples/blog), and the tests build
it.

## Every markdown file is a post

This is the inversion. On a docs site the nav decides what is a page, and a file nobody listed is
never read. On a blog the folder decides: writing a post publishes it, and there is no second place
to go and register it.

Three files are not posts:

- `index.md`, which is the front page.
- Anything `nav` names, which is a standalone page. See below.
- Anything `exclude` or `.gitignore` already kept out of the folder.

A post needs a `date`. Without one, nothing can place it: it would be absent from the archive, from
the feed and from the sitemap, which is a post nobody can find. The build stops and names the file.

```yaml
---
date: 2026-08-18
description: Why the commit message stopped being the right place to put the reasoning.
tags: [writing]
---
```

`date` fills `published` when a post declares no `published` of its own, so `article:published_time`,
the JSON-LD and the line under the title all read the same value. It is a separate key because it
must not inherit the article's date: an inherited sort key would give every undated post the same
position and make an arbitrary order look deliberate.

## The front page is `index.md`, plus a list you do not maintain

The words at the top of the front page are yours. Write `index.md` the way you would write any
other page, with front matter if you want a cover or a description on it.

The archive is appended underneath: every post, newest first, with its date, its title, its
description, its reading time, its tags and its cover if it has one. Nothing about that list is
maintained by hand, and it cannot fall out of step with the posts, because every value in it is the
same one the post's own page uses.

!!! note "A blog with no `index.md` is an error"
    It is the page served at `/` and the page the archive is rendered onto. An empty file is a
    valid answer; a missing one is not.

## `nav` means standalone pages

For a blog, `nav` is optional, and when it is present it lists the pages that are not posts: an
about page, a colophon, a page of links. They have no date, they never appear in the archive, they
are absent from the feed, and the arrows at the foot of a post do not lead to them.

A blog with no `nav` gets no sidebar at all, and the layout closes over the space.

## Older and newer

At the foot of every post are the two adjacent posts in the archive: the newer one on the left and
the older one on the right. On a docs page the same two links mean the previous and next thing to
read, which is a sequence an author chose. Here there is only a chronology.

The index page and the standalone pages are not in that chain.

## Drafts

```yaml
---
date: 2026-08-19
draft: true
---
```

A draft is out of the archive, out of `feed.xml` and out of `sitemap.xml`, and it carries
`<meta name="robots" content="noindex, nofollow">`. It still builds, and it still has a URL. That is
the useful half: a draft you cannot open in a browser is a draft nobody can review.

## `feed.xml`

Every build of a published blog writes an Atom feed at `feed.xml`, and every page advertises it with
`<link rel="alternate" type="application/atom+xml">`. The front page also carries a link a person
can click.

The feed needs `site_url`, for the reason `link rel=canonical` needs one: every URL in a feed is
resolved in somebody else's reader, so a relative one addresses a document that is not your site.
Without an origin no feed is written and the build says so.

```yaml
site_url: https://field-notes.example
```

Entries carry the post's title, its canonical URL as the entry id, its date, its description as a
`summary`, its author and its tags as `category` terms. Bodies are not included: a feed carrying
every figure of every post is a megabyte a reader downloads to decide whether to read one
paragraph.

The feed dates itself by its newest post rather than by the moment of the build, so a rebuild that
changed nothing does not tell every subscriber that something changed.

## Covers

`cover_on` defaults to `all` for a blog, so every post gets the header with its title and date on
it, and shows its own cover as a band across the page.

A post does not inherit the blog's cover. The image in `article.yaml` is the blog's banner, and a
banner reprinted at the top of every post is a magazine reprinting its front page on every spread.
It is still the fallback for `og:image`, because a post shared with no artwork at all is worse than
one shared with the blog's.

## Not included

Comments, pagination, related posts, per-tag pages, and multiple authors beyond the one `author`
field. Pagination in particular is worth resisting until an index is long enough to hurt.
