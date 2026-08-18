# pagina

**An article is a folder.** It holds an `article.yaml`, some markdown, and whatever media and
figures the markdown refers to. pagina turns that folder into a documentation site — and, more to
the point, into a documentation site that will sit inside somebody else's application without
dragging a design system in behind it.

This site is that claim under test. Everything you are reading is a pagina article, in
[`docs/`](https://github.com/Nano112/pagina/tree/main/docs) of the pagina repository, built by the
pagina in the same commit. The token table on the theming page is quoted out of the stylesheet
that ships it. The `article.yaml` on the folder page is this page's own. If any of that stopped
being true, the build would fail rather than mislead you.

<!--
  The caption uses `<code>` elements rather than backticks on purpose. A figure is raw HTML, and
  inline markdown is not processed inside one — backticks come out literally, with no diagnostic.
  `markdown="span"` does not help here either: it is neither honoured nor stripped, so it ends up
  in the published markup. Written as HTML, it renders.
-->
<figure class="kg" data-scene="scenes/publishing.mjs"><figcaption>One render, written down three ways. <code>build</code>, <code>pack</code> and the editor's preview are not three pipelines that might disagree — they are the same render, which is why a bundle a host serves without running Node matches a build byte for byte.</figcaption></figure>

## What it is for

Most documentation tools assume they own the page. That is a fair assumption for a docs site on
its own domain, and a bad one the moment the docs have to appear *inside* a product — under the
product's header, in the product's palette, next to the product's own components. pagina is built
for the second case, and the first case falls out of it for free.

Three properties follow from that, and they are the ones worth knowing before you start:

!!! note "The host owns the appearance"
    pagina's CSS lives entirely inside a cascade layer, and unlayered CSS beats layered CSS
    whatever its specificity. A host's ordinary `.pg-content h2 { … }` wins without `!important`.
    Below that there are about twenty `--pg-*` custom properties to point at your own design
    system — and if even that is too much, pagina will ship no CSS at all. See
    [Theming](theming.md).

!!! tip "An article is portable"
    `pagina pack` builds the folder into a single `.pgz` file that carries its own rendered HTML,
    its own drawn figures and every asset the pages reference. A host can serve it without running
    Node, and unpacking it is a checked operation rather than an unzip. See
    [Article bundles](bundles.md).

!!! warning "A broken reference is a build failure"
    A link to a page that is not in the nav, an anchor that no heading provides, a snippet whose
    region has been deleted, a figure that will not draw — each of these stops the build instead of
    publishing a page that is quietly wrong. This is the property that lets the pages above quote
    live source.

## The shape of a folder

```
docs/
├── article.yaml        the metadata, and the nav — which is what decides what is a page
├── index.md            this page
├── getting-started.md
├── theming.md
├── scenes/
│   └── publishing.mjs  a Kineglyph scene: a figure that is drawn, not an image that is stored
└── media/              anything the pages point at
```

The nav is the index. A markdown file that no nav entry names is not a page and is never rendered
— which is how this repository keeps its dated design notes in `docs/` without publishing them.
[The article folder](article-folder.md) covers the whole contract.

## Where to go next

| If you want to | Read |
| --- | --- |
| build the site in front of you | [Get started](getting-started.md) |
| know what may go in a folder, and what the markdown supports | [The article folder](article-folder.md) |
| put pagina inside an application that already has a design system | [Theming](theming.md) |
| move an article between machines, or serve one without Node | [Article bundles](bundles.md) |
| publish to a sub-path, or run a mirror | [Deploying](deploying.md) |

The source, the issue tracker and the design notes are on
[GitHub](https://github.com/Nano112/pagina).

!!! note "Status"
    Early. The formats described here are settled enough to build on, and the bundle format is
    versioned, but pagina has not been through many hands yet. Treat sharp edges as bugs worth
    reporting rather than as intended behaviour.
