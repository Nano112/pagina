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

## How the layer trick works

`pagina.css` begins with

```css
@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome;
```

and every rule in the file lives inside one of those four. Two consequences:

1. **Unlayered CSS beats layered CSS, at any specificity.** In the cascade, layer order is
   consulted *before* specificity, and the unlayered "implicit layer" sorts last — i.e. highest.
   Your `.pg-content h2` (specificity 0,1,1) therefore beats pagina's `.pg-content h2` inside
   `pagina.chrome`, and would beat it even if pagina's were `#id .pg-content h2`.
2. **The declaration line fixes the internal order.** Naming all four up front means
   `pagina.chrome` wins over `pagina.reading` regardless of where each block appears in the
   file — and if you want to add to a layer yourself (`@layer pagina.reading { … }`), you land in
   the right slot.

`tokens.css` is the single source for the reset and tokens layers: `pagina.css` `@import`s it,
and the build copies the same file to `_pagina/pagina.tokens.css` for `theme: "tokens"`. One
file, so the two sheets cannot drift. (The alternative — slicing the layers back out of the
built `pagina.css` — would mean parsing our own output in two places, dev and build, to
reproduce something we already have on disk.)

One caveat worth knowing: the production build minifies with lightningcss, which drops the
standalone `@layer` declaration when it can prove the order by sorting the layer *blocks* into
declared order instead. The cascade is identical; the shipped `pagina.tokens.css` is copied
unminified and keeps the line.
