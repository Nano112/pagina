# Cover images, SEO, and block editing — design

Date: 2026-08-17. Status: approved by the user's brief; queued behind the T3 host-integration fixes.

Four asks, two of them defects I reproduced in Chrome first.

## 1. Block nodes cannot be deleted (defect — reproduced)

In schemat.io's editor: select an admonition's whole body, press Backspace eight times → the node
survives and its text is unchanged. The node view exposes a kind `<select>`, a title `<input>` and a
`collapsible` checkbox, and **no delete control**. The same shape applies to `tabs` (which has `+`/`×`
for individual tabs but no way to remove the block), and by inspection to `figureKg`, `modelViewer`,
`snippet` and `htmlBlock`.

**Fix — one rule for every block node view:**
- A **remove** control in the node's chrome (quiet, appears on hover/focus, `aria-label`), consistent
  across all block types.
- **Keyboard parity**: `Backspace`/`Delete` with the node selected removes it; `Backspace` at the very
  start of the first child, or in an empty body, lifts/removes rather than trapping the cursor.
- **Escape hatches**: clicking the node's chrome selects the node (so it can be copied/cut/dragged);
  `Cmd/Ctrl-Enter` (or an explicit affordance) inserts a paragraph *after* the block, so a block at the
  end of a document is never a dead end.
- Nested admonitions are currently possible and render badly — disallow admonition-inside-admonition in
  the schema, or make the editor refuse the insert with a message.

## 2. Admonitions look bad (agreed — redesign)

**Published:** a thin left border and a translucent fill, with no icon and no kind label — `danger` and
`note` are nearly indistinguishable, so the semantics the syntax carries are lost. A collapsible one
renders as a raw `▶ asas` disclosure triangle.

**In the editor:** raw browser `<select>`, a bare text input and an unstyled checkbox — it reads as a
debug form dropped into the page, and native control styling fights every host theme.

**Redesign, published:** kind icon + kind label (or the author's title when given), a tinted surface
derived from the kind's hue, a solid accent edge, deliberate padding and a real chevron for
collapsibles. All colour from the existing `--pg-note/tip/warning/danger` tokens plus new
`--pg-<kind>-surface` variants so a host retints by defining tokens, never by fighting rules.
Kinds to support: note, tip, info, warning, danger, example, quote.

**Redesign, editor:** the node chrome becomes quiet and tool-like — kind as a small icon+label control,
title as an inline field that looks like part of the block (placeholder "Title (optional)"),
collapsible as a proper toggle, remove at the right. No naked browser controls.

## 3. Cover images (new capability, first-class)

- `article.yaml` gains `cover` (path, relative to the folder), plus `description` and `author`.
- A page may override in front matter: `cover`, `description`, `title`.
- `Manifest.article` carries `cover`, `description`, `author`; `manifest.pages[href]` carries per-page
  `description` and `cover`. The build copies the cover like any asset and records its resolved URL.
- Editor: an **Article settings** panel (cover upload with preview and replace/remove, description,
  author, tags) writing `article.yaml` through the same comment-preserving YAML path used for nav.
- The static shell renders the cover where it makes sense (index card / article header) — but a host
  may ignore it and use its own.

## 4. SEO (so a host's pages actually index)

pagina **emits the metadata; the host decides how to place it.** The static shell renders it directly;
the Laravel package feeds the host's existing meta stacks rather than duplicating tags.

Per page, from the manifest: `<title>` (page title · site title), `meta description` (page → article →
first paragraph, truncated on a word boundary), `link rel=canonical`, Open Graph (`og:type=article`,
title, description, url, image = page cover → article cover, `article:published_time`,
`article:modified_time`, `article:author`, `article:tag`), Twitter card (`summary_large_image` when a
cover exists, else `summary`), and **JSON-LD `Article`** with headline, description, image, dates,
author and `mainEntityOfPage`. Plus `sitemap.xml` and `robots.txt` for the standalone static site, and
a `noindex` switch for drafts.

**schemat.io integration:** the app layout already exposes `@stack('title')`, `@stack('description')`,
`@stack('og-*')`, `@stack('twitter-*')` — the package pushes into those stacks so article pages
inherit the site's existing SEO conventions instead of emitting a competing set. Cover images map onto
the `Article` model's existing `cover` media collection so index cards and OG images share one source.
Published articles join whatever sitemap the app already serves; drafts never do.

## Order

Block deletion + admonition redesign first (they are daily irritants), then cover + SEO metadata in
pagina, then the schemat.io wiring. Each verified in a browser against built assets under a host
layout — the only configuration where this project's bugs have ever been visible.
