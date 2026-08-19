---
title: Social cards
description: >-
  Every page shares as a picture, not a bare link: an author's cover, a card composed from the
  page's own title and theme, or a mark derived from its slug. Drawn at build time, cached by
  everything that can change them.
---

# Social cards

Paste a URL into Slack, Discord, X or LinkedIn and something is fetched: `og:image`, or nothing.
pagina used to emit that tag only for a page with a `cover:`, which is most articles' landing page
and none of their other pages. Everything else shared as a line of blue text, and the Twitter card
degraded from `summary_large_image` — the wide one with a picture — to the small imageless
`summary`.

So pagina draws one. Every page of a built site now carries an `og:image` that resolves to a real
1200×630 PNG, and there is nothing to configure to get that.

## Three ways to have a picture

The order is precedence, and the first one that applies wins.

1. **The page's own `cover:`.** Somebody drew artwork for this page; it is the picture.
2. **The article's `cover:`.** Same, one level up.
3. **A card pagina composed.** The page's title, its description, the article's name, its category
   and its reading time, set in the palette the article is themed with.

The third is the floor rather than the aspiration. It exists so that the answer to "what does this
page share as" is never "nothing", and it is drawn well enough to post.

The description under the title is the same one the page's `<meta name="description">` carries, and
it is resolved the same way: the page's own `description:`, else the page's opening paragraph, else
`article.yaml`'s. The page comes before the article deliberately. An article-level description is
one sentence about the whole project, so taking it first gives every page that wrote nothing the
same subtitle and the same search-result snippet; the opening paragraph is at least about the page
it was written on. Which is a way of saying that the good cards are the ones with a real
`description:` in front matter, and that writing one is the only work here.

The card's slot — the coloured band beside the type — holds one of two things. Given a Kineglyph
scene it holds that drawing. Given nothing it holds a mark derived from the page's slug: a gradient
field in the article's accent, with a set of rings whose number, size and placement come out of a
hash of the slug. The same page draws the same mark forever, and two pages of one article do not
draw the same one.

## The `og:` block

Written in `article.yaml` for the whole article, and in a page's front matter to override it field
by field, the way `cover:` and `theme:` already work.

```yaml
og:
  template: editorial     # editorial | figure | full
  scheme: light           # which half of the theme is painted into the picture
  glyph: scenes/how.mjs   # a Kineglyph scene module, relative to the article folder
  glyph_width: 392        # how wide the slot is, on an `editorial` card
  glyph_position: right   # right | left
  time: end               # which frame of an animated scene: end | start | milliseconds
  alt: A blue card        # overrides the alt text derived from the card's content
  width: 1200
  height: 630
```

`og: false` opts out. A page inside an article that opted out can write `og: true` to opt back in.

Three templates, and only two of them are compositions:

`editorial` is the default and the one to reach for. The title is the subject, set as large as its
length allows, with the description under it and the slot as a band down one side. It is designed
for the size a card is actually seen at, which is about 300px wide in a timeline: at that size the
eyebrow and the footer are texture, and what carries is the ground colour, the coloured band and
the title.

`figure` inverts that. The drawing takes the top two thirds and the type is a strip beneath it,
for a page whose illustration is the message. It asks more of the glyph than `editorial` does — a
dense flow diagram is unreadable at 300px, and a card that needs its full size to say anything is a
card most people never read.

`full` hands the whole canvas to the slot. It is the same mechanism with the slot grown to the
edges, for an article that wants its cards drawn entirely in Kineglyph.

## What the glyph slot is for

pagina owns the typography and the composition; Kineglyph owns the illustration. A card is
editorial and a diagram is data, and keeping those apart is what lets a scene an article already
ships appear on a card without being redrawn for it.

The scene is resolved at the slot's own width. On an `editorial` card that is 392px, which is
narrow enough that Kineglyph picks its narrow layout — a row of three boxes becomes a column of
three, laid out for the space it was given rather than scaled down into it. This page's siblings
use it: `how-it-works.md` puts the publishing scene in its slot and keeps the type-led composition
around it.

A glyph is painted in the card's colours and Kineglyph's own type scale. Only the font family is
imposed, because a card embeds its fonts and there is one to embed; a code run inside a glyph is
therefore set in the card's sans rather than in a monospace.

## The palette is baked, not inherited

A figure on a page resolves its colours at view time through `var(--kg-color-*)`, so it follows
whatever theme the reader ends up with. A card cannot do that. A crawler fetches a PNG on its own:
no page, no stylesheet, no `--pg-*`, no `prefers-color-scheme`.

So the palette is resolved during the build, from the same token contract and in the same order the
cascade uses: pagina's own `tokens.css`, then `article.yaml`'s `theme:`, then the page's. Whichever
half is baked is `og.scheme`, and it is `light` by default.

One limit, stated plainly: only hex colours can be baked. The token contract accepts any CSS
colour, and the card's translucent ring strokes are mixed by hand, which needs channels. A host
whose accent is `oklch(…)` keeps pagina's accent on its cards and gets a warning saying so; every
other role still comes from that host's own tokens.

A theme at a URL is not read either. Fetching one would make the build depend on a network, which
is the property the whole pipeline is built to avoid. Ship the stylesheet in the article folder and
its cards are themed with it.

## Fonts, and why a card is byte-identical everywhere

Cards are set in [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans), a variable
face shipped with `@pagina/vite` under the SIL Open Font License. The font files are passed to both
halves of the render: HarfBuzz shapes with them to decide where lines break, and resvg draws with
them, with the machine's own fonts switched off.

That is what makes a card built in CI the same bytes as a card built on a laptop. A system font
would make it untrue, and the difference would show up months later as a card nobody can reproduce.

## Names, caching, and what a rebuild rewrites

A card is written to `_pagina/og/<page>.<hash>.png`, where the hash covers everything that can
change the picture: the title, the description, the baked palette, the template, the dimensions, the
glyph's *bytes*, the font files, and pagina's own version. Two consequences follow. A build that
changes nothing rewrites no PNG, and a card that does change gets a URL no crawler has cached.

Cards are drawn during `pagina build` and not by the dev server. The renderer is Node rather than a
browser, and a social crawler wants a URL that answers immediately rather than one that renders on
demand.

## A broken glyph costs a glyph

Scenes are code, and code fails. A glyph that throws, names a file that is not there, or crashes
the rasteriser outright is reported as a warning and the card is drawn again without it. The page
still shares as a picture; the build still finishes.

That is why cards are drawn in a child process. Some inputs make the rasteriser abort rather than
raise, and an abort cannot be caught — in the same process it would end the build, which is a worse
outcome than one plain card.

## Alt text

Both `og:image:alt` and `twitter:image:alt` are emitted alongside the image. For a cover that is the
`cover_alt` the author wrote, falling back to the article title. For a drawn card it is the card's
own content, since a picture of a title and a description is described by that title and that
description:

```
Card from pagina: Theming — Twenty custom properties, one cascade, and the escape hatches.
```

`og.alt` replaces it. An image with no alt text is the accessibility gap social cards reliably ship,
and a card is made of text a screen reader would otherwise never be given.

## What a page ends up with

For a page with no cover, on a site with a `site_url`:

| Tag | Value |
| --- | --- |
| `og:image` | absolute URL of the drawn card |
| `og:image:alt` | the card's content, or `og.alt` |
| `twitter:card` | `summary_large_image` |
| `twitter:image` | the same absolute URL |
| `twitter:image:alt` | the same alt text |

Without a `site_url` there is still no `og:image`, card or no card, for the reason
[Deploying](deploying.md) gives: every consumer of that tag fetches it from a different origin, so a
site-absolute path is a guaranteed 404 for all of them. The card is still drawn and still written;
it is the tag that is withheld.
