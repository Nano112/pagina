# The article folder

An article is a directory with an `article.yaml` in it. Everything else — how many pages, how they
are nested, what media they use — follows from that file, because **the nav is the index**.

## The nav decides what is a page

A markdown file is a page if, and only if, a nav entry names it. Files that no entry names are
never read, never rendered and never published. That is not a tidiness rule, it is the mechanism
this repository relies on: `docs/design/` and `docs/plans/` sit inside this very article folder
and stay unpublished, because the nav below does not mention them.

Two consequences are worth stating before they surprise you:

!!! warning "A link to a non-nav page is an error, not a broken link"
    A relative link ending in `.md` that resolves to a file outside the nav fails the build with
    `link-unresolved`. If you want to point at something in the repository that is not a page,
    link to it by full URL — as the [design notes](https://github.com/Nano112/pagina/tree/main/docs/design)
    are linked here. Links with a scheme are left alone.

!!! note "Everything that is not markdown is an asset"
    Every non-`.md` file in the folder, at any depth, is an asset: it is listed in the manifest and
    it travels with a bundle. `article.yaml` and dot-prefixed paths are the exceptions.

## `article.yaml`

This is the real file behind the site you are reading, included from disk at build time rather
than transcribed:

```yaml
--8<-- "docs/article.yaml"
```

!!! warning "Naming it `article.yaml` here would not survive `pack`"
    That directive reaches this file through the repository root — the second declared snippet
    root — rather than as the plain `article.yaml` beside this page, and it has to. `pack` rewrites
    the bundled `article.yaml` to collapse the snippet roots, so a page that includes its own
    config by its own name asks for two different files at one path in the bundle and fails with
    `bundle-collision`. Reaching it by the longer path files it under `snippets/` instead, and both
    copies survive.

The fields, in full:

| Field | Meaning |
| --- | --- |
| `slug` | the article's identifier; a host uses it for routing, and `pack` names the bundle after it |
| `title` | the article title, used in `<title>`, the header, and the manifest |
| `form` | `docs`. The only value there is |
| `status` | `draft` or `published` (default `draft`). A draft build gets `Disallow: /` and no sitemap |
| `visibility` | `public`, `members` or `authors` (default `public`); a host's business, not the renderer's |
| `category`, `tags` | free classification, carried into the manifest |
| `description` | the fallback meta description for every page that does not carry its own |
| `author` | carried into the article's metadata and structured data |
| `site_url` | where the article lives, for canonical URLs. `--site-url` overrides it |
| `cover`, `cover_alt` | a path *relative to the folder*, and its alt text |
| `cover_on` | `root` (default), `all` or `none` — which pages show the cover header |
| `cover_fit` | `contain` (default) or `cover` — whether the cover may be cropped to fill its band |
| `theme` | a CSS file of the article's own, writing `--pg-*`; or `inherit`. Level 3 of [the cascade](theming.md#the-cascade), and a page may override it in its front matter |
| `kineglyph.theme` | a module exporting `light` and `dark` palettes for figures, a theme by name, or `inherit`. A palette [claims the roles it names](theming.md#level-5-the-figure) and inherits the rest from the page |
| `kineglyph.width` | the layout width figures are pre-rendered at |
| `snippets.roots` | the directories `--8<--` may read from. Default `["."]` |
| `exclude` | glob patterns for files that are **not** article content and must not be published |
| `exclude_gitignore` | whether a folder in a git repository also excludes what git ignores. Default `true` |
| `nav` | the pages, in order |

A nav entry is either a page or a section of pages:

```yaml
nav:
  - { title: What pagina is, page: index.md }
  - section: The contracts
    children:
      - { title: The article folder, page: article-folder.md }
```

The first page in nav order is the landing page — the one a reader arrives at, and the one
`cover_on: root` means.

The cover is a band across the **whole page**, above the sidebar and the content column, and the
title and the meta row under it stay in the reading column. pagina copies the image without
decoding it, so it never learns whether it is looking at a photograph or a wordmark — and it will
not guess in the direction that cuts the first letters off a name. `cover_fit: contain` is the
default: the whole image, letterboxed in the band. `cover_fit: cover` is you saying "this one is a
photograph, fill the band", and `--pg-cover-ratio`, `--pg-cover-max` and `--pg-cover-position` are
the host's three tokens for the band's shape, its height and which part of a cropped photograph
survives.

!!! tip "A cover is optional, and an invented one is worse than none"
    This article has no `cover`. There is no image in the repository that honestly represents the
    project, and a cover is the first thing a reader and a social card see. Leaving it out is a
    decision the format supports.

## The markdown dialect

Ordinary CommonMark, plus four additions. Each is one of the additions this documentation itself
uses, so what follows is demonstrated on the page as well as described.

### Admonitions

`!!!` for a static block, `???` for a collapsible one. The body is indented four spaces. The title
is optional — without one it is the capitalised kind; with an empty one (`""`) you get the glyph
and no label.

```
!!! note "Heads up"
    Admonitions render as `<aside>`, and take their colour from three tokens per kind.

??? tip "Closed until you open it"
    Collapsible ones are a `<details>`.
```

??? tip "Closed until you open it"
    Which is what that produces — the block you just opened.

### Tabs

Consecutive `=== "Label"` blocks merge into one tab group. The bodies are indented four spaces and
are ordinary markdown, so a tab can hold anything a page can.

```
=== "Python"

    print("hello")

=== "Rust"

    println!("hello");
```

### Snippets

`--8<-- "path"` pulls a file in, and `--8<-- "path:region"` pulls a named region out of one. The
path is resolved against `snippets.roots`, and a reference that resolves outside them is an error.
Regions are marked in the source file, in whatever its comment syntax is:

```
# --8<-- [start:main]
print("hello")
# --8<-- [end:main]
```

This is the feature that lets documentation quote code instead of copying it. The `article.yaml`
above is a snippet; so is the token table on [Theming](theming.md). If either file changed
underneath its page, the build would fail rather than publish a stale quotation.

### Attributes

`markdown-it-attrs` is on: `## Heading {#custom-id}`, `[text](x.md){ .cls }`,
`![img](x.gif){ width="480" }`. Headings get generated ids and an anchor link without asking.

## Figures

A figure is a `<figure class="kg">`. It is **drawn**, not stored: the scene is a module that
describes what the picture means, and pagina lays it out and paints it at build time in the page's
own palette.

```html
<figure class="kg" data-scene="scenes/publishing.mjs"><figcaption>
  A caption, which is also the figure's description for assistive technology.
</figcaption></figure>
```

The scene lives in the folder and default-exports a Kineglyph scene. `data-scene` is resolved
relative to the *page*, so a page one directory down would say `../scenes/publishing.mjs`:

```js
import { sceneFromSpec } from "kineglyph";

export default sceneFromSpec({
  version: 1,
  id: "publishing",
  title: "How an article is published",
  layout: "row",
  nodes: [{ kind: "box", id: "folder", title: "article folder", tone: "neutral" }],
  edges: [],
});
```

Every figure is pre-rendered to SVG for light and dark, inlined into the page, and only then
hydrated in the browser — so a figure is visible with JavaScript off, and does not reflow when the
script arrives. `id` must be unique across the article; a collision is a build error.

Three attributes change how a figure behaves, and the default is the quiet one:

| Attribute | Effect |
| --- | --- |
| *(none)* | a still figure, drawn and inlined. What both figures on this site use |
| `data-controls="true"` | a control strip for scenes that animate |
| `data-instrument="true"` | a readout of the scene's own measurements, for debugging a layout |
| `data-static="path.svg"` | an existing SVG instead of a scene, still inside the figure chrome |

## What gets published

`pagina build` writes the pages the nav names, the figures it drew, and **the folder's assets**.
That last one is the dangerous half, and it used to mean *everything in the folder that is not a
page*. A folder is not a manifest: it collects things. Building Nucleation's docs directly would
have published a gitignored directory of internal notes and a 118 MB `plans/` tree, on a public
site, from a command whose output said nothing about either. Only `pack` was safe, and only
because a bundle walks references for portability — containment was a side effect, not a promise.

It is a promise now, in three parts.

### Built-in exclusions

Excluded from every build, before `article.yaml` says anything:

| Pattern | What it covers |
| --- | --- |
| `.*` | dotfiles and dot-directories at any depth — `.git`, `.env`, `.DS_Store`, `.github` |
| `node_modules/` | a dependency tree is never content, and it is the largest thing that lands in a folder by accident |
| `Thumbs.db`, `desktop.ini` | the two Windows shell droppings that are not dotfiles |

Deliberately **not** on that list: `dist`, `build`, `out`, `tmp`, `*.log`, `README.md`. Every one
of them is a plausible name for something an author wrote on purpose, and a default that guesses
about intent breaks folders silently. Name those in `exclude`; the unreferenced report below will
point at them first.

### `exclude`

Gitignore-shaped globs, appended to the built-ins:

```yaml
exclude:
  - drafts/          # a `drafts` directory at any depth
  - /scratch/        # only this folder's
  - "*.psd"          # by name, at any depth
  - "!drafts/keep.png"   # …except this one
```

`*` matches within a segment, `**` across them, `?` one character. A `/` at the start or in the
middle anchors the pattern to the folder root; a *trailing* `/` only means "directory". A leading
`!` re-includes, and the last pattern that matches a path decides — which is what lets you take one
file back out of an excluded directory.

The one thing `!` cannot win back is a dot-entry or `node_modules`: the folder walk itself never
descends into them, so no pattern can reach inside.

### `.gitignore` is honoured

If the folder is inside a git work tree, files git ignores are not published. This is the default,
and it is the part of the change that would have caught the Nucleation case exactly.

The argument for it is that `.gitignore` is the expression of "not for publication" that most
folders *already have*, written where everyone working on the article can see it, and a second
list that has to be kept in sync with it will not be. The argument against is surprise — a build
that quietly drops a file is its own failure mode. So it does not drop anything quietly:

- every build that excludes something says how many files and names them;
- a file git ignores that a page nevertheless **references** is a build **error**
  (`gitignored-but-referenced`), not a silent drop, because the alternative is a published page
  with a dead image on it;
- `exclude_gitignore: false` turns the whole thing off.

One thing it does *not* do: if the article folder is itself inside an ignored directory — a
`dist/`, a scratch tree — git would report every file in it as ignored. That is an answer about the
container, not about the article, so it is discarded and the build proceeds on `exclude` alone.

### The unreferenced report

Everything above is a list someone has to write. This is the part that tells you what you forgot.

After the build, pagina walks the article the way `pack` does — from the nav outwards, through
every link, figure, cover, scene module and whatever those modules import — and reports every file
it copied that the walk never reached:

```
[warning] unreferenced-file : notes/2026-planning.pdf was copied into the site but nothing in
the article references it. Add it to `exclude` in article.yaml if it is not meant to be published.
```

A file nothing reaches is either dead weight or something you did not mean to publish. It is a
**warning** by default rather than an error, and that is a deliberate trade: a real folder
legitimately contains files this walk cannot see — an image a scene builds a URL for at run time,
a font a stylesheet pulls in, a `.well-known` file a host serves. Failing those builds would teach
authors to widen `exclude` until it stopped complaining, which is the opposite of containment.

For the build that publishes something you would mind leaking, `pagina build --strict-assets`
turns the report into a refusal: the site is not written until every file in it is either reached
or named.

### Where the design notes went

`docs/design/` and `docs/plans/` are in this repository and deliberately out of the nav. They are
dated working documents — they argue a decision at a moment in time, and several describe defects
that have since been fixed. Publishing them as reference material would misdescribe what they are.
They are now named in this article's own `exclude`, rather than relying on the fact that markdown
files are not copied as assets, and they remain readable on
[GitHub](https://github.com/Nano112/pagina/tree/main/docs), which is the right place for them.
