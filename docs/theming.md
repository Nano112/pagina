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
| `--pg-note` | `#3b5bdb` | `#7c9bff` | `note` / `info` admonition hue |
| `--pg-tip` | `#0f9d58` | `#3ddc84` | `tip` / `example` admonition hue |
| `--pg-warning` | `#b7791f` | `#e0b34c` | `warning` admonition hue |
| `--pg-danger` | `#d64545` | `#ff7b7b` | `danger` admonition hue, destructive editor controls |
| `--pg-code-bg` | `#f6f7f9` | `#1c1f26` | Inline code and un-highlighted code blocks |
| `--pg-shiki-bg` | `#ffffff` | `#1c1f26` | Highlighted (shiki) code block background |

Dark values apply under `[data-theme="dark"]` on the root element, which pagina's theme toggle
sets. Tokens with no dark column are scheme-independent.

The editor uses the same contract — there is no second palette. Its own `--pge-*` properties are
only the tool's geometry (`--pge-1`, `--pge-2`, `--pge-sidebar`, `--pge-split`).

## The four escape hatches, in order

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
