---
title: Social cards
description: >-
  Every page shares as a picture, not a bare link: an author's cover, a card composed from the
  page's own title and theme, or a mark derived from its slug. Drawn by the build and by the
  editor, cached by everything that can change them.
---

# Social cards

Paste a URL into Slack, Discord, X or LinkedIn and something is fetched: `og:image`, or nothing.
pagina used to emit that tag only for a page with a `cover:`, which is most articles' landing page
and none of their other pages. Everything else shared as a line of blue text, and the Twitter card
degraded from `summary_large_image` — the wide one with a picture — to the small imageless
`summary`.

So pagina draws one. Every page of a built site carries an `og:image` that resolves to a real
1200×630 PNG, and there is nothing to configure to get that. A page published from the editor gets
the same card, drawn in the browser at the moment it is published.

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

So the palette is resolved when the card is generated, from the same token contract and in the same
order the cascade uses: pagina's own `tokens.css`, then `article.yaml`'s `theme:`, then the page's.
Whichever half is baked is `og.scheme`, and it is `light` by default.

One limit, stated plainly: only hex colours can be baked. The token contract accepts any CSS
colour, and the card's translucent ring strokes are mixed by hand, which needs channels. A host
whose accent is `oklch(…)` keeps pagina's accent on its cards and gets a warning saying so; every
other role still comes from that host's own tokens.

A theme at a URL is not read either. Fetching one would make the build depend on a network, which
is the property the whole pipeline is built to avoid. Ship the stylesheet in the article folder and
its cards are themed with it.

## Fonts

Cards are set in [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans), a variable
face shipped under the SIL Open Font License. The font files are passed to both halves of the
render: HarfBuzz shapes with them to decide where lines break, and resvg draws with them, with the
machine's own fonts switched off.

That is what makes a card built in CI the same bytes as a card built on a laptop. A system font
would make it untrue, and the difference would show up months later as a card nobody can reproduce.

## Where cards are drawn

Two places, from one composition.

`pagina build` draws them in Node with resvg, writes them to `_pagina/og/`, and serves them as
files. A social crawler wants a URL that answers immediately rather than one that renders on demand.

The editor draws them too, in the browser, when an author publishes. It has to: publishing from
the editor renders every page and figure client-side and POSTs the result, so a site that only ever
got cards from a build would share every newly published post as whatever picture the last build
happened to leave behind. The browser renders the same Kineglyph scene to SVG, inlines the same font
file as a `data:` URI so the SVG can be rasterised standalone, draws it into a canvas and uploads
the PNG through the same `upload` endpoint as any other asset.

What that buys is not only fresher cards. It means publishing asks a host for nothing but somewhere
to put bytes — no rasteriser, no fonts, no Node.

The composition, the palette ladder, the precedence rules and the cache key all live in
`@pagina/core` and are called by both. Two renderers would agree the day they were written and drift
by the second change to either.

They are not pixel-identical, and are not meant to be. Rasterisers antialias differently, and Node's
HarfBuzz measurement does not apply the font's variable weight axis where a browser's does — so a
title very near a wrap boundary can take a different number of lines, and the browser's card carries
the weights the composition asks for where the build's are drawn at the face's default instance. The
size, the palette, the composition and the file name are the same.

### Configuring the browser path

The editor looks for `pagina-card-font.ttf` beside its own bundle, which is where `@pagina/editor`'s
`dist/` puts it and where any host that publishes that directory has it. A host that serves it
somewhere else says so:

```html
<pagina-editor backend-url="/api/articles/mine" card-font-url="/assets/instrument-sans.ttf">
```

If the font cannot be loaded, publishing continues and draws no cards. Each page keeps whatever
`og:image` it already had, and one warning on the console says which and why. A picture that did not
render is never allowed to cost an author their work.

## Names, caching, and what a rebuild rewrites

A card is written to `_pagina/og/<page>.<hash>.png`, where the hash covers everything that can
change the picture: the title, the description, the baked palette, the template, the dimensions, the
glyph's *bytes*, the font files, and pagina's own version. Two consequences follow. A build that
changes nothing rewrites no PNG, and a card that does change gets a URL no crawler has cached.

Which of the two rasterisers drew it is deliberately *not* in the hash. If it were, every publish
would redraw what the build had just written and every build would redraw what the author had just
published. A card is keyed on what it is a picture of.

So the name is also how each side knows there is nothing to do: a build skips a card already on
disk, and a publish skips one already at that path on the backend. Without that, a debounced save
would redraw every card in the article on every keystroke.

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
