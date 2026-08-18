# Theming

pagina is meant to drop into a site you already have and look like it belongs there. The default
sheet is deliberately plain, everything it draws goes through ~20 custom properties, and every
rule it ships sits in a **cascade layer** — so your CSS wins over pagina's without `!important`
and without knowing anything about pagina's selectors.

Four layers of control, from "change nothing" to "keep only the markup":

| Layer | What it gives you | Default | How you take it over |
|---|---|---|---|
| **Structure** | Semantic markup with stable `pg-*` / `pge-*` class names | always on | it *is* the contract — nothing to override |
| **Tokens** | The `--pg-*` custom properties below | on, neutral defaults | redefine any subset in one place |
| **Reading** | The content column: measure, headings, code, admonitions, tabs, tables, figures | on | override rules, or drop the layer with `theme: "tokens"` |
| **Chrome** | Header, nav sidebar, TOC, pager, theme toggle, layout grid | on | `chrome: false` drops pagina's header row for yours |

If you are dropping pagina into an application that already has a layout and a CSS reset, read
[Integrating under a host layout](#integrating-under-a-host-layout) first — it is one page and it
covers the two things that are not obvious.

## The token contract

Every token is defined in the `pagina.tokens` layer with the neutral default below, and every
colour, font and radius pagina draws reads one of them. Define the ones you care about and the
rest keep their defaults.

| Token | Default (light) | Default (dark) | Controls |
|---|---|---|---|
| `--pg-bg` | `#ffffff` | `#14161a` | Page background |
| `--pg-bg-raised` | `#f6f7f9` | `#1c1f26` | Surfaces that sit *above* the page: admonitions, the theme toggle |
| `--pg-bg-sunken` | `#eceef2` | `#0f1115` | Surfaces that sit *below* it: table headers |
| `--pg-fg` | `#1a1d23` | `#e7e9ee` | Body text |
| `--pg-muted` | `#6b7280` | `#9aa1ac` | Secondary text: breadcrumbs, TOC, nav labels, captions |
| `--pg-accent` | `#3b5bdb` | `#7c9bff` | Links, the current nav item, the selected tab, the toggle thumb |
| `--pg-accent-fg` | `#ffffff` | `#0d1117` | Text drawn *on* the accent |
| `--pg-line` | `#e3e6eb` | `#2b2f38` | Ordinary rules and borders |
| `--pg-line-strong` | `#c8cdd6` | `#3d434f` | Emphasised rules: blockquote bar, table header underline |
| `--pg-radius` | `6px` | — | Corner radius for controls, inline code, pager cards, admonitions |
| `--pg-radius-lg` | `10px` | — | Corner radius for large surfaces: code blocks |
| `--pg-font` | system UI stack | — | Body type |
| `--pg-font-mono` | system mono stack | — | Code type |
| `--pg-font-display` | `var(--pg-font)` | — | Headings and the site title, so you can give them their own face |
| `--pg-measure` | `72ch` | — | Width of the content column |
| `--pg-note` | `#3b5bdb` | `#7c9bff` | `note` admonition hue: accent edge and glyph |
| `--pg-note-surface` | `#eef1fd` | `#1b2130` | `note` admonition ground |
| `--pg-note-fg` | `#2b3f9e` | `#a8bcff` | `note` admonition title text |
| `--pg-tip` | `#0f9d58` | `#3ddc84` | `tip` admonition hue |
| `--pg-tip-surface` | `#e9f7f0` | `#16241d` | `tip` admonition ground |
| `--pg-tip-fg` | `#0a6b3d` | `#6ee7a8` | `tip` admonition title text |
| `--pg-info` | `#0b7285` | `#4dc4d9` | `info` admonition hue |
| `--pg-info-surface` | `#e6f4f7` | `#14242a` | `info` admonition ground |
| `--pg-info-fg` | `#0a5a6b` | `#7fd8e8` | `info` admonition title text |
| `--pg-warning` | `#b7791f` | `#e0b34c` | `warning` admonition hue |
| `--pg-warning-surface` | `#fdf3e3` | `#2a2317` | `warning` admonition ground |
| `--pg-warning-fg` | `#8a5a12` | `#edc76e` | `warning` admonition title text |
| `--pg-danger` | `#d64545` | `#ff7b7b` | `danger` admonition hue, destructive editor controls |
| `--pg-danger-surface` | `#fdecec` | `#2c1b1c` | `danger` admonition ground |
| `--pg-danger-fg` | `#a12727` | `#ff9d9d` | `danger` admonition title text |
| `--pg-example` | `#7048e8` | `#b197fc` | `example` admonition hue |
| `--pg-example-surface` | `#f1ecfd` | `#221c33` | `example` admonition ground |
| `--pg-example-fg` | `#5227b8` | `#c9b6ff` | `example` admonition title text |
| `--pg-quote` | `#6b7280` | `#9aa1ac` | `quote` admonition hue |
| `--pg-quote-surface` | `#f2f3f5` | `#1e2027` | `quote` admonition ground |
| `--pg-quote-fg` | `#4b5159` | `#b6bcc6` | `quote` admonition title text |
| `--pg-code-bg` | `#f6f7f9` | `#1c1f26` | Inline code and un-highlighted code blocks |
| `--pg-shiki-bg` | `#ffffff` | `#1c1f26` | Highlighted (shiki) code block background |
| `--pg-figure-min-scale` | `0.7` | — | How far a Kineglyph figure may scale down before it scrolls instead |
| `--pg-figure-max` | `100%` | — | How wide a Kineglyph figure may get; `100%` is the reading measure |

Dark values apply under `[data-theme="dark"]` on the root element, which pagina's theme toggle
sets. Tokens with no dark column are scheme-independent.

The editor uses the same contract — there is no second palette. Its own `--pge-*` properties are
only the tool's geometry (`--pge-1`, `--pge-2`, `--pge-sidebar`, `--pge-split`).

Those defaults are not transcribed into this page. They are quoted out of the stylesheet that
ships them, `packages/shell-static/client/tokens.css`, at the moment this page was built:

```css
--8<-- "packages/shell-static/client/tokens.css:core"
```

If someone changes a default and forgets this page, the page changes with it — and if someone
deletes the region, the build fails instead of publishing a table that has quietly gone wrong.

### Kineglyph figures

A published figure is **inline SVG**, not an `<img>`, and every paint in it is written as
`var(--kg-color-<role>, <the colour it was drawn with>)`. So a figure takes its palette from the
page the way everything else does — and it does so in the reader's current theme, without a second
rendering and without a per-host prerender.

Nothing is required of a host. `tokens.css` already points each role at the `--pg-*` that means the
same thing, so **a host that mapped pagina's tokens has themed its diagrams too**:

| Figure token | Defaults to | Paints |
|---|---|---|
| `--kg-color-canvas` | `var(--pg-bg-raised)` | The figure's own background plane |
| `--kg-color-surface` | `var(--pg-bg)` | Node and card fills |
| `--kg-color-surface-raised` | `var(--pg-bg)` | Fills above the surface (raised, floating, glass) |
| `--kg-color-surface-muted` | `var(--pg-bg-sunken)` | Recessed fills (inset) |
| `--kg-color-border` | `var(--pg-line-strong)` | Node and card outlines |
| `--kg-color-text` | `var(--pg-fg)` | Labels and body text |
| `--kg-color-text-muted` | `var(--pg-muted)` | Captions, secondary text, edge labels |
| `--kg-color-accent` | `var(--pg-accent)` | Icons, motifs, focus rings, highlighted edges |
| `--kg-color-accent-contrast` | `var(--pg-accent-fg)` | Text and marks drawn *on* the accent |
| `--kg-color-connector` | `var(--pg-muted)` | Edges, arrowheads, packets |
| `--kg-color-info` | `var(--pg-note)` | The `info` tone |
| `--kg-color-success` | `var(--pg-tip)` | The `success` tone |
| `--kg-color-warning` | `var(--pg-warning)` | The `warning` tone |
| `--kg-color-danger` | `var(--pg-danger)` | The `danger` tone |
| `--kg-color-chart1` … `--kg-color-chart6` | accent, note, warning, tip, danger, example | Quantitative series, in order |
| `--kg-color-chart-positive` | `var(--pg-tip)` | A gain |
| `--kg-color-chart-negative` | `var(--pg-danger)` | A loss |
| `--kg-color-chart-neutral` | `var(--pg-quote)` | A baseline |

Set any of them directly to give diagrams a palette of their own:

```css
:root { --kg-color-accent: var(--color-magenta); --kg-color-canvas: transparent; }
```

The pairings match the swatches the Figure Builder shows an author, so the tone picked in the
editor is the colour the published figure carries.

**Two of these are not the obvious neighbour, on purpose.** `--kg-color-connector` paints the
arrows in a flow diagram, and an arrow is the sentence's verb, not a rule between paragraphs;
pointed at `--pg-line-strong` it carried 1.49:1 on the figure canvas and simply vanished. It maps
to `--pg-muted` — the token that already means *ink that is secondary but still ink* — for 4.51:1.
`--kg-color-border` moves up to `--pg-line-strong` for the same reason: a node needs an outline
that separates it from its ground, not a divider. A host that wants its diagrams' arrows in its
brand colour says so and nothing else moves:

```css
:root { --kg-color-connector: var(--pg-accent); }
```

**A host whose `--pg-bg` is `transparent`** — a dark site whose prose sits straight on the page —
should set the figure surfaces explicitly. Prose does not need a plane behind it; a diagram does,
because a node with no fill is an outline rather than an object:

```css
:root {
  --kg-color-canvas: rgb(255 255 255 / 0.04);
  --kg-color-surface: rgb(255 255 255 / 0.09);
  --kg-color-surface-raised: rgb(255 255 255 / 0.13);
  --kg-color-border: rgb(255 255 255 / 0.22);
}
```

**Colour is the whole contract.** Type and geometry are decided when a figure is rendered, not when
it is read: SVG cannot wrap or reflow text, so each box is measured once against the text it will
hold and the result is frozen with `textLength`. Re-fonting a figure from CSS would pull its text
out of the boxes built for it, so `--kg-font-family` and `--kg-radius-*` are pinned on the figure
and are not offered here. Publishing from the editor reads the host's *real* font off the page and
lays the figure out in it, which is the supported way to get your own type into a diagram.

Left undefined entirely — a host on `theme: "none"`, say — a figure still paints exactly the
colours it was drawn with. The tokens re-tint; they are never required.

**An article that ships its own theme keeps it.** `article.yaml`'s `kineglyph.theme` names a module
exporting `light` and `dark` token sets; the builder draws every figure with it, and the shell then
publishes that theme's colours as the `--kg-color-*` variables, after the stylesheet, so they
outrank the table above. Drawn and painted are the same palette, in both themes, with or without
JavaScript — before this, an article's declared teal was drawn into the SVG and then repainted in
the host's blue, and only a reader ever saw it. The bridge is unchanged for the far more common
article that declares no theme: it still follows its host.

A figure wider than the column **scrolls rather than shrinks**, the same treatment `pre` gets,
because a diagram scaled to a phone takes its 16px type down to 6px with it.
`--pg-figure-min-scale` is the floor: below `0.7` of its natural width a figure keeps its size and
its frame scrolls sideways. The live figure obeys the same floor, because a quiet figure is mounted
at the width its geometry was decided at — the reader gets the picture they were already looking
at, not a re-layout of it, and nothing moves when the runtime lands.

### How wide a figure may get: `--pg-figure-max`

The reading measure is chosen for sentences. A diagram is not read that way, and squeezing one into
the measure scales its type down with it — a 960-wide figure in a 697px column renders at 0.73,
which turns 12px labels into 8.7px. That is above `--pg-figure-min-scale`, so the scroll rule never
fires; it is simply too small.

`--pg-figure-max` says how much room a figure may take. It defaults to `100%` — the measure — so a
host that says nothing keeps exactly the layout it had. A host with gutters to spare opts in:

```css
:root { --pg-figure-max: min(960px, calc(100vw - 4rem)); }
```

Two things stay put. The **prose** does not move: a figure centres itself on the column with an
inline margin that goes negative as it grows, so nothing but the figure is affected. And the
**caption** stays in the column, inset by the figure's overhang, because a caption is prose.

Guard the value against the viewport (`calc(100vw - …)`) so a wide figure cannot push the page
sideways on a phone; below the measure the term collapses and the figure behaves exactly as before,
scrolling at `--pg-figure-min-scale` rather than shrinking.

### A figure in prose is a picture: `data-instrument`

By default a published figure carries **no readout and no transport**. It is a diagram, a frame and
a caption. An author opts a figure into playback and inspection one figure at a time:

```html
<figure class="kg" data-scene="scenes/pipeline.mjs" data-instrument="true">
  <figcaption>Step through the pipeline.</figcaption>
</figure>
```

| The figure says | What it gets |
|---|---|
| nothing (the default) | the drawing and its caption |
| `data-instrument="true"` | whatever the scene justifies — see below |
| `data-controls` / `data-readout` | exactly that, unconditionally |

**Opting in is a request, not an instruction.** Kineglyph decides what a scene can honestly offer:
a transport only where there is a timeline to drive, a readout only where some part of the diagram
is inspectable. So `data-instrument="true"` on a still diagram still shows no Play button, because
a disabled control against a 0.0s track is furniture. The two are decided separately — a scene with
inspectable parts and no timeline gets a readout and no transport.

`data-controls`/`data-readout` remain the escape hatch and always win, so a figure authored before
this default existed renders exactly as it did. The set that changes appearance is the set that
never said anything, which is the set this is for. The Figure Builder writes the attribute from the
figure card's **Interactive** toggle, and the editor's preview shows the chrome the published page
will have.

The chrome, when it is there, takes the same tokens the diagram does: the runtime's shell colours
are references into `--kg-color-*`, its buttons show a visible focus outline (not only a ring, so
forced-colours mode keeps it), and its hover transitions are dropped under `prefers-reduced-motion`.
A figure with no chrome is drawn without the shell's box entirely — around a bare diagram that box
is a second frame over a picture that already paints its own canvas.

### Admonitions

`note tip info warning danger example quote` — the seven kinds `!!! kind` and `??? kind` accept —
each own **three** tokens, and every rule pagina draws for a callout reads only those:

| Token | Draws |
|---|---|
| `--pg-<kind>` | the accent edge and the kind's glyph |
| `--pg-<kind>-surface` | the tinted ground the block sits on |
| `--pg-<kind>-fg` | the title text |

The title text is a token of its own rather than the hue because a hue chosen to read as a 3px
edge is usually too light to carry text at 4.5:1 on its own tint — `--pg-tip`'s green is 3.1:1 on
white. Retint a kind by defining its three:

```css
:root {
  --pg-danger: var(--color-red);
  --pg-danger-surface: var(--color-red-50);
  --pg-danger-fg: var(--color-red-700);
}
```

A kind pagina does not know (`!!! spoiler`) still renders, with `note`'s glyph and hue and a
`pg-admonition--spoiler` class of its own — so a host teaches its stylesheet the new kind by
setting `--pg-adm-hue`, `--pg-adm-surface` and `--pg-adm-fg` on that class, which is the same
three-property shape as everything above.

### The article header

The header above the content — cover, title, then *date · author · reading time* — is drawn
entirely from tokens already in the table above, so it needs no new ones:

| Part | Class | Tokens it uses |
|---|---|---|
| The whole header | `.pg-article-header` | `--pg-measure` |
| The cover image | `.pg-cover`, `.pg-cover__img` | `--pg-radius-lg`, `--pg-line`, `--pg-bg-raised` |
| The title | `.pg-article-header h1` | `--pg-font-display`, `--pg-fg` |
| The meta row | `.pg-article-meta`, `.pg-article-meta__item` | `--pg-muted` |
| Its separators | `.pg-article-meta__sep` | `--pg-line-strong` |

Two things worth knowing before you restyle it. The title is the page's own `<h1>`, **moved** into
the header by the shell rather than reprinted — so it is outside `.pg-content`, and a rule you wrote
as `.pg-content h1` no longer reaches it. Under `theme: "tokens"` that matters: add
`.pg-article-header h1` wherever you style headings, or the landing page's title arrives at whatever
size your reset left it. And the cover carries no intrinsic `width`/`height` (pagina copies the file
without decoding it), so `.pg-cover__img`'s `aspect-ratio` is the only thing holding the layout
still while the image loads — replace it, do not simply remove it.

Which pages get a header is the author's call, not the host's: `cover_on` in `article.yaml` is
`root` (the landing page only, the default), `all`, or `none`.

## The four escape hatches, in order

They are a ladder, not a menu: each rung hands the host more control and pagina less, and the last
one gives up pagina's styling entirely. Take the first that works and stop there.

<figure class="kg" data-scene="scenes/cascade.mjs"><figcaption>Each step down costs you something pagina was doing for you. Most hosts never leave the first rung, and the fourth is a decision rather than a preference.</figcaption></figure>

### 1. Map the tokens

Most hosts stop here. One file, loaded after pagina's, that points pagina's tokens at variables
you already have:

```css
/* pagina-theme.css — map our design system onto pagina's contract. */
:root {
  --pg-bg: var(--color-surface);
  --pg-bg-raised: var(--color-surface-raised);
  --pg-bg-sunken: var(--color-surface-sunken);
  --pg-fg: var(--color-ink);
  --pg-muted: var(--color-ink-muted);
  --pg-accent: var(--color-accent);        /* ours is magenta, not pagina's blue */
  --pg-accent-fg: var(--color-on-accent);
  --pg-line: var(--color-border);
  --pg-line-strong: var(--color-border-strong);
  --pg-radius: 0.5rem;
  --pg-radius-lg: 0.875rem;
  --pg-font: var(--font-sans);
  --pg-font-display: var(--font-display);
  --pg-font-mono: var(--font-mono);
  --pg-measure: 68ch;
  --pg-code-bg: var(--color-surface-sunken);
  --pg-shiki-bg: var(--color-surface-sunken);
}
[data-theme="dark"] {
  --pg-bg: var(--color-surface-dark);
  --pg-fg: var(--color-ink-dark);
}
```

Nothing in pagina needs to change, and nothing in pagina knows your site exists.

### 2. Override rules

Ordinary CSS. Because pagina's rules are layered and yours are not, a plain selector beats them:

```css
.pg-content h2 { font-size: 2rem; letter-spacing: -0.02em; }
```

No `!important`, no specificity race, no `:where()` tricks. (Two exceptions where pagina itself
uses `!important`: the shiki code colours, because shiki writes them as inline `style`
attributes, and one ProseMirror outline in the editor, because prosemirror-view injects its own
unlayered sheet. Both are documented at the rule.)

### 3. `theme: "tokens"` — keep the tokens, drop the reading layer

```ts
await buildStatic({ folder, outDir, shell: staticShell, theme: "tokens" });
```

The page links `pagina.tokens.css` (the token contract plus a minimal reset) instead of
`pagina.css`. You get the markup and the variables; the content column is yours to style.

### 4. `theme: "none"` — structure only

```ts
await buildStatic({ folder, outDir, shell: staticShell, theme: "none", chrome: false });
```

No pagina stylesheet is linked at all. The `pg-*` class names and the document structure are the
entire contract.

`chrome: false` is a separate axis, usable at any theme level: it drops pagina's own header row
(site title + theme toggle) for a host that renders its own. The sidebar, TOC and pager stay —
they are the article's navigation, not the host's.

Both are available on `buildStatic` and `createDevServer`, and on the CLI as
`--theme <full|tokens|none>` and `--no-chrome`.

## Integrating under a host layout

Everything above is about *taste*. This section is about the two things that will otherwise cost
you an afternoon, and what pagina now guarantees so they don't.

### Link exactly one stylesheet per surface

| What you are rendering | Link | Ships as |
|---|---|---|
| Article pages, `theme: "full"` (default) | `pagina.css` | `@pagina/shell-static/dist/pagina.css`, or `_pagina/pagina.css` in a built site |
| Article pages, `theme: "tokens"` | `pagina.tokens.css` | `@pagina/shell-static/dist/pagina.tokens.css`, or `_pagina/pagina.tokens.css` |
| Article pages, `theme: "none"` | nothing | — |
| The editor | `editor.css` | `@pagina/editor/dist/editor.css` |

**One file each, and no more.** Every artefact has its imports inlined at build time, so there is
no second request to discover and no sibling file to remember to copy. If you are publishing
pagina's assets into your own `public/` directory (the Laravel package does), copy from `dist/`
and never from `client/` — `client/*.css` is source, held together by `@import`s that will 404
next to your copy.

The editor's sheet is **self-sufficient**: it carries the token contract and the reading layer
itself. A host that links only `editor.css` still gets a preview pane and a document surface that
match the published page. If you render both an article page and the editor, link both sheets —
**in any order**. Which comes first cannot change the cascade; see below.

### The CSS-reset trap, and what pagina does about it

Every reset — Tailwind's preflight, Bootstrap's, your own three lines — says something like

```css
h1, h2, h3 { font-size: inherit; font-weight: inherit; margin: 0; }
ul, ol { list-style: none; padding: 0; }
```

A stylesheet that sets `.pg-content h1 { font-size: 1.9rem }` and lets the *browser* supply the
weight, the margins and the list markers is only half a stylesheet: under a reset, the half it
never wrote is simply gone, and an article renders as undifferentiated body text.

pagina's reading layer therefore states every one of those values explicitly, including the ones
that merely restate a browser default. Nothing changes on a page without a reset; a page with one
gets the same result. This is checked in a browser, against built files, on a host page that
loads a preflight-shaped reset before pagina's assets (`e2e/host-theming.spec.ts`).

Two caveats that remain yours:

- A reset is *unlayered* by default in some setups. Unlayered CSS beats layered CSS at any
  specificity, and pagina's rules are all layered — that asymmetry is the whole escape hatch, so
  an unlayered `h1 { font-size: inherit }` will flatten pagina's headings and pagina cannot and
  should not fight it. Put your reset in a layer (Tailwind's preflight already lives in
  `@layer base`), or scope it away from `.pg-content`.
- pagina styles the content column, not your page. `body` background, colour and font come from
  the `pagina.reset` layer, which your own body rules outrank.

### Link order does not matter

Each pagina stylesheet — `pagina.css`, `pagina.tokens.css`, `editor.css` — opens by declaring the
*complete* layer order:

```css
@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome, pagina.editor;
```

Whichever one the browser sees first fixes that order for all of them, so
`<link editor.css><link pagina.css>` and `<link pagina.css><link editor.css>` produce identical
results. (Earlier, `editor.css` named only its own two layers, which meant loading it first
registered `pagina.editor` *ahead* of `pagina.reading` and the reading layer started winning
arguments inside the editor. Hosts had to know to order the links by hand. They no longer do.)

Your own layers sort relative to pagina's by whichever sheet declares them first, so if you care,
declare yours before loading pagina — or leave them unlayered and win outright.

### Cache-bust by content

Stamp each pagina stylesheet with a hash of *that file's* bytes — `pagina.css?v=<sha of
pagina.css>` — and stop there. That is enough because no pagina artefact imports another one: an
`@import`ed file has no URL of its own for a cache-buster to stamp, so a tokens-only change would
leave the importing sheet's hash untouched and every browser would keep the stale copy. pagina
inlines its imports at build time precisely so you do not have to fold sibling files into your
own version hash.

## How the layer trick works

Every pagina stylesheet begins with

```css
@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome, pagina.editor;
```

and every rule in every file lives inside one of those five. Two consequences:

1. **Unlayered CSS beats layered CSS, at any specificity.** In the cascade, layer order is
   consulted *before* specificity, and the unlayered "implicit layer" sorts last — i.e. highest.
   Your `.pg-content h2` (specificity 0,1,1) therefore beats pagina's `.pg-content h2` inside
   `pagina.chrome`, and would beat it even if pagina's were `#id .pg-content h2`.
2. **The declaration line fixes the order, across files.** Naming all five up front means
   `pagina.chrome` wins over `pagina.reading` regardless of where each block appears — and,
   because *every* pagina sheet names the same five, regardless of which sheet a host loads
   first. `pagina.editor` is in the site sheet's list for exactly that reason, though the site
   sheet never puts a rule in it. If you want to add to a layer yourself
   (`@layer pagina.reading { … }`), you land in the right slot.

### Sources, and what actually ships

`packages/shell-static/client/` holds three source files, and `pagina.css` is composed of the
other two:

| Source | Layers | Also ships alone as |
|---|---|---|
| `tokens.css` | `pagina.reset`, `pagina.tokens` | `pagina.tokens.css` |
| `reading.css` | `pagina.reading` | `pagina.reading.css` |
| `pagina.css` | the two above, plus `pagina.chrome` | `pagina.css` |

`@pagina/editor`'s `theme.css` imports the first two, which is what makes `editor.css`
self-sufficient and what stops the editor's idea of the tokens drifting from the shell's — there
is no copy to keep in step.

The `@import`s are **build inputs**. Every published artefact has them inlined: the package build
(`scripts/build-css.mjs`) writes `dist/*.css`, a site build writes `_pagina/pagina.css`, and
Vite writes `dist/editor.css`. A host never sees an `@import`, and never needs a second request
or a second hash. See [Cache-bust by content](#cache-bust-by-content).

One caveat worth knowing: the production builds minify with lightningcss, which drops the
standalone `@layer` declaration when it can prove the order by sorting the layer *blocks* into
declared order instead — keeping a bare `@layer pagina.editor;` for a slot it has no block for.
The cascade is identical. The unminified `dist/*.css` artefacts keep the line verbatim.
