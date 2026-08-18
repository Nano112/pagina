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
| `theme` | a CSS file of the article's own |
| `kineglyph.theme` | a module exporting `light` and `dark` palettes for figures |
| `kineglyph.width` | the layout width figures are pre-rendered at |
| `snippets.roots` | the directories `--8<--` may read from. Default `["."]` |
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

## What is not in this folder

`docs/design/` and `docs/plans/` are in the repository and deliberately out of the nav. The design
notes are dated working documents — they argue a decision at a moment in time, and several of them
describe defects that have since been fixed. Publishing them as reference material would misdescribe
what they are. They remain readable on
[GitHub](https://github.com/Nano112/pagina/tree/main/docs), which is the right place for them.
