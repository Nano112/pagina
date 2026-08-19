---
title: How pagina works
description: >-
  The technical account: five packages, one render behind three outputs, a folder walk that decides
  what a page is, a token cascade, figures that are drawn rather than stored, and an index that is
  a file.
# This page's card puts a drawing in the slot the procedural mark would otherwise fill — the same
# scene the page shows, resolved at the slot's width, so it lays itself out as a column. The card
# stays type-led, which is what survives being 300px wide in a timeline; the glyph is what tells a
# reader at full size which page this is.
og:
  glyph: scenes/publishing.mjs
---

# How pagina works

Enough of the mechanism to decide whether the design is sound. Every contract named here has a
page of its own; this one is the shape they fit into.

## Five packages, and where the seams are

| Package | What it is |
| --- | --- |
| `@pagina/core` | the render: markdown dialect, links, figures, SEO, search index, bundle verification. No filesystem, no Node |
| `@pagina/vite` | the Node side: dev server, static build, pack and unpack, figure pre-render, the editor's HTTP contract |
| `@pagina/shell-static` | the default page shell, and the stylesheets that carry the token contract |
| `@pagina/editor` | the in-browser WYSIWYG editor, backend-agnostic |
| `@pagina/cli` | the `pagina` command |

The first seam is the load-bearing one. `@pagina/core` reads no files and imports nothing from
`node:*`; it is handed a `ContentFs` and returns a manifest plus HTML fragments. That is enforced
by a lint rule rather than by discipline:

```js
// eslint.config.js
files: ["packages/core/src/**/*.ts"],
rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["node:*", "fs", "path", …] }] }] },
```

Because of that rule the same renderer runs in a build, in a dev server and in a browser tab.

## One render, three outputs

<figure class="kg" data-scene="scenes/publishing.mjs"><figcaption>One render, written down three ways. <code>build</code>, <code>pack</code> and the editor's preview are not three pipelines that might disagree; they are the same render, which is why a bundle a host serves without running Node matches a build byte for byte.</figcaption></figure>

`pagina build` writes a static site. `pagina pack` writes a `.pgz` bundle carrying the same
rendered HTML. The editor's **Publish** runs `@pagina/core` and the Kineglyph runtime in the
browser and hands manifest, pages and figures to a backend as one payload. Three commands, one
implementation of what a page is.

The alternative shape is a renderer per destination, and the failure mode of that shape is a
difference nobody notices until a reader reports it: a callout that renders in the preview and not
on the site, an anchor the search index knows about and the page does not. Here there is nothing to
keep in step.

## The folder walk decides what a page is

An article is a directory holding an `article.yaml`. The `nav` in that file is the index: a
markdown file is a page if, and only if, a nav entry names it. Files no entry names are never read
and never published, which is how `docs/design/` and `docs/plans/` live inside this article folder
without appearing on this site.

Everything that is not markdown is an asset, at any depth, and travels with the article. That used
to mean *everything* in the folder, which is a promise a directory cannot keep: a folder collects
things, and building a real one would have published a gitignored tree of internal notes. Three
mechanisms now bound it.

| | What it excludes |
| --- | --- |
| built-in | `.*` at any depth, `node_modules/`, `Thumbs.db`, `desktop.ini` |
| `exclude:` | gitignore-shaped globs in `article.yaml`, `!` re-includes, last match wins |
| `.gitignore` | honoured by default when the folder is in a git work tree |

None of the three tells you what you forgot, so after the build pagina walks the article the way
`pack` does, from the nav outwards through every link, figure, cover and scene import, and reports
every file it copied that the walk never reached. That is a warning by default and a refusal under
`--strict-assets`, which is the setting a deploy should use.
[The article folder](article-folder.md) has the whole contract, including why `dist` and `*.log`
are deliberately not in the built-in list.

## Strict is the default

Every diagnostic carries a stable code, and the ones that stop a build are the ones where
publishing would be worse than failing:

| Code | What it caught |
| --- | --- |
| `nav-missing-file` | a nav entry naming a page that is not there |
| `link-unresolved` | a relative `.md` link that resolves outside the nav |
| `anchor-missing` | a `#fragment` no heading provides |
| `snippet-missing` | a `--8<--` whose file or region is gone |
| `figure-prerender` | a scene module that will not draw |
| `figure-id-collision` | two figures claiming one id |
| `cover-missing`, `theme-missing` | a path in `article.yaml` that resolves to nothing |
| `gitignored-but-referenced` | a page pointing at a file git ignores, which the build would drop |

`--no-strict` downgrades content errors to warnings for a half-ported folder. The build exits `1`
with the full list otherwise, and that refusal is what lets these pages quote live source with
`--8<--` instead of copying it: a stale quotation is a red build rather than a wrong sentence.

## The token cascade

pagina has one theme, and five places to overwrite it. Every colour, font, radius and measure it
draws reads one of 22 `--pg-*` custom properties, plus three per admonition kind. `tokens.css`
defines them all; a host stylesheet, an article's `theme:`, a page's front matter and a figure's
Kineglyph theme may each redefine any subset, and a level that says nothing inherits the level
above it.

Two properties make that work rather than merely describe it.

**Every pagina rule lives inside a cascade layer.** A host's plain `.pg-content h2` therefore wins
without `!important`, and because every pagina stylesheet opens by naming the same five layers in
the same order, which sheet the browser loads first cannot change the outcome either. Theming has
[the reasoning](theming.md#how-the-layer-trick-works).

**A published figure is inline SVG, not an image.** Every paint in it is written as
`var(--kg-color-<role>, <the colour it was drawn with>)`, and `tokens.css` already points each role
at the `--pg-*` that means the same thing. A host that mapped the tokens has themed the diagrams,
having written nothing about diagrams.

[Theming](theming.md) is the full cascade, the four escape hatches, the token defaults quoted out of
the stylesheet that ships them, and a live panel that retints this page while you move it.

## Figures are drawn, not stored

A figure is a `<figure class="kg">` naming a scene module. The module describes what the picture
means; pagina lays it out and paints it at build time.

SVG has no text wrapping, so a diagram cannot reflow the way a paragraph can. Geometry is measured
once, against the width it will be drawn at, and frozen. That is why each figure is drawn at four
widths by default (`960, 640, 440, 320`, up to five, configurable per article) and the page shows
the drawing measured for the width its frame actually has. Scaling one drawing into a phone column
instead would take this article's 12px labels to 4px.

Each variant is inlined into the page and only then hydrated, so a figure is visible with
JavaScript off and does not move when the runtime arrives.

## A bundle is built, not zipped

`pagina pack` resolves the article rather than archiving the directory. Snippets that reached
outside the folder are copied in under `snippets/` and the paths rewritten, `snippets.roots`
collapses to `["."]`, only assets something references are carried, and the rendered output travels
under `.rendered/` so a host can serve the article without running Node.

`bundle.json` carries a format version, per-file SHA-256s and a total. `created` is deliberately
outside the checksummed set and injectable, which is what makes the format content-addressable:
with it pinned, `pack → unpack → pack` produces **identical bytes**. That is asserted directly, on
a destination far from the source repo:

```
packages/vite/test/bundle.test.ts
  ✓ packs, unpacks and packs again into identical bytes
  ✓ renders byte-identically on a machine that never had the source repo
```

Unpacking treats the file as hostile: names, modes, sizes, ratios and checksums are all checked
before `mkdir` is called once. [Article bundles](bundles.md) lists every refusal and its code.

## Search is a file

A build writes one `_pagina/search.json`, and a page fetches it the first time somebody presses
<kbd>/</kbd>. There is no server in either real deployment of pagina, so there is nothing to query
at read time.

A result is a **section**, not a page: everything under one `##` or `###` is indexed as its own
document with its own anchor, because a result that says only *Theming* tells a reader nothing the
sidebar had not. Figure titles and descriptions are indexed too, and a result from one is labelled
`diagram`. [Search](search.md) has the weights, the ranking model and the argument for writing it
rather than adopting Pagefind.

## The editor writes the markdown

There is no editor-only document format. The editor parses with the same markdown-it instance the
site renders with, the serializer writes the dialect back, and the round trip
`markdown → document → markdown` is asserted byte-for-byte over the fixture's pages, two pages of a
real Nucleation reference, the live demo's seed and a synthetic document per node type. A construct
that cannot survive that trip is a serializer bug rather than a reason to store something else.

It talks only to an `ArticleBackend`: an HTTP contract, browser storage, or a test double, all three
checked by one parametrised suite. [The editor](editing.md) covers the document model, the three
ways to mount it and the rough edges; [Try the editor](demo.md) runs the real thing in this browser
against `localStorage`.

## What this design does not give you

- **No plugin API.** The markdown dialect is CommonMark plus admonitions, tabs, snippets and
  attributes, and extending it means changing `@pagina/core`.
- **No incremental build.** A build renders the whole article.
- **Search does not chunk.** One file is fetched whole, which is the right trade at this size and
  the wrong one for a thousand pages. [Search](search.md) says where the line is and what to do on
  the other side of it.
- **The editor has no presence and no locking.** A subscription says a file changed; it does not
  say who is editing it. Conflict detection is the whole of the multi-user story.
- **Fonts and radii do not re-tint a figure.** They change geometry, and the geometry was measured
  once. Colour inherits; layout does not.
