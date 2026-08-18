---
description: >-
  Most documentation tools render a site and expect to own the page it lands on. pagina renders an
  article folder into whatever page it is given, including one somebody else's application built.
---

# Why pagina exists

pagina turns a folder of markdown into documentation. MkDocs, Docusaurus and Starlight do that too,
and for a docs site on its own domain they do it with more themes, more plugins and more years
behind them. Reach for one of those first.

The case they are all awkward at is the one pagina was written for. Sooner or later the
documentation has to appear *inside* the product: under the product's header, in the product's
palette, on a route the product's router owns, beside the product's own components. A tool that
renders a whole site is the wrong shape for that. You are no longer deploying a site; you are
asking an existing page to display an article, and every part of the tool that assumed otherwise
becomes something to work around. Its shell wants to be the page. Its theme wants to be the theme.
Its stylesheet arrives with opinions about `h1` that your design system already had.

<figure class="kg" data-scene="scenes/inside-a-host.mjs"><figcaption>What crosses the boundary. A host defines the custom properties; pagina paints the article with them and contributes nothing else to the page.</figcaption></figure>

## The whole of what a host has to do

pagina's CSS lives inside a cascade layer, and unlayered CSS beats layered CSS whatever its
specificity. So a host's ordinary `.pg-content h2 { … }` wins over pagina's without `!important`,
without a specificity race and without knowing pagina's selectors.

Below that there are 22 `--pg-*` custom properties, plus three more for each of the seven
admonition kinds, and every colour, font, radius and measure pagina draws reads one of them. A host
that maps them onto its design system is done: prose, code blocks, callouts, tables, the editor and
the diagrams all move together, because the figures resolve the same tokens the paragraphs do.

```css
:root {
  --pg-bg: var(--color-surface);
  --pg-fg: var(--color-ink);
  --pg-accent: var(--color-brand);
  --pg-font: var(--font-sans);
}
```

If even that is too much, `--theme none` links no pagina stylesheet at all and leaves you the
markup and the `pg-*` class names. [Theming](theming.md) is the whole ladder, rung by rung, and
there is a live panel on that page that retints this site while you watch.

## An article is a folder

A directory with an `article.yaml` in it, some markdown beside it, and whatever figures and media
the markdown points at. There is no project file above it and no database row behind it.

```
docs/
├── article.yaml        the metadata, and the nav — which is what decides what is a page
├── index.md            this page
├── how-it-works.md
├── theming.md
├── scenes/
│   └── inside-a-host.mjs   a figure that is drawn, not an image that is stored
└── media/              anything the pages point at
```

The nav is the index: a markdown file that no nav entry names is not a page and is never rendered.
That is the mechanism this repository uses to keep dated design notes inside `docs/` without
publishing them, and it means the answer to "what is in this article" is one file rather than a
directory listing.

A folder travels. It diffs in a pull request, reads on GitHub without a build, opens in any text
editor, and `pagina pack` collapses it into a single `.pgz` that carries its own rendered HTML and
its own drawn figures. A host can serve that bundle without running Node.

## Three outputs that cannot disagree

`build` writes a static site. `pack` writes a bundle. The editor's **Publish** renders in the
browser and hands the result to a backend. All three are the same render, performed once by
`@pagina/core`, which imports nothing from Node and therefore runs in all three places unchanged.
There is no second renderer to drift from the first.

[How pagina works](how-it-works.md) is the technical account of that, and of the folder walk, the
token cascade, the figures, the bundle format and the search index.

## A broken reference stops the build

A link to a page the nav does not name, an anchor no heading provides, a snippet whose region has
been deleted, a figure whose scene will not draw: each of these fails the build rather than
publishing a page that is quietly wrong.

That refusal is what lets this documentation quote live source instead of copying it. The token
defaults on [Theming](theming.md) are read out of the stylesheet that ships them. The `article.yaml` on
[The article folder](article-folder.md) is this article's own. If either file changed underneath
its page, the build would go red rather than publish a stale quotation.

## This site is the claim under test

Everything you are reading is a pagina article, in
[`docs/`](https://github.com/Nano112/pagina/tree/main/docs) of the pagina repository, rendered by
the pagina in the same commit and deployed to GitHub Pages. The other deployment of the same
renderer is a Laravel application that serves stored fragments off a disk, which is the case this
whole page is about.

## Where to go next

| If you want to | Read |
| --- | --- |
| get from nothing to a published site | [Install](install.md) |
| judge whether the design is sound | [How pagina works](how-it-works.md) |
| know what may go in a folder, and what the markdown supports | [The article folder](article-folder.md) |
| put pagina inside an application that already has a design system | [Theming](theming.md) |
| write in a browser instead of an editor | [The editor](editing.md) |
| move an article between machines, or serve one without Node | [Article bundles](bundles.md) |
| publish to a sub-path, or run a mirror | [Deploying](deploying.md) |

The source, the issue tracker and the design notes are on
[GitHub](https://github.com/Nano112/pagina).

!!! note "Status"
    Early. `@pagina/*` is on npm, the formats described here are settled enough to build on, and
    the bundle format is versioned, but pagina has not been through many hands yet. Treat sharp
    edges as bugs worth reporting rather than as intended behaviour.
