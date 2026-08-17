# pagina

**A static-docs renderer for folders of markdown, assets, and live [Kineglyph](https://github.com/Nano112/kineglyph) diagrams.**

pagina turns an *article folder* — an `article.yaml`, some markdown, whatever assets they
reference, and optionally Kineglyph scene modules — into a complete static documentation
site, or serves it live with hot reload while you write. It replaces MkDocs for the
[Nucleation](https://github.com/Schem-at/Nucleation) docs and is built to be reusable for
any project that wants the same folder-in, site-out contract.

Design goals, in order:

- **A folder is the whole article.** Portable, diffable, previewable on GitHub. No database,
  no host-specific syntax in the content.
- **Diagrams are code, not JSON.** A Kineglyph figure is a script — inline in the page or a
  sibling `.mjs` — that imports helpers from the bare specifier `kineglyph`. It is
  pre-rendered to SVG at build time and hydrated to a live, interactive figure in the browser.
- **The renderer is a library; the site is a shell.** `@pagina/core` produces a manifest plus
  HTML fragments; `@pagina/shell-static` is one shell over that output. Another shell (a Laravel
  Blade view, say) can consume the same manifest without pulling in anything else.
- **Strict by default.** A nav entry without a file, a dead link, a missing snippet, a broken
  anchor, or a figure that fails to pre-render fails the build with a diagnostic naming the page.

> **Status:** early. The pipeline is complete and browser-verified end-to-end (build, dev
> server, HMR, theme toggle, three figure forms), and Nucleation's docs are being ported page by
> page. `@kineglyph/*` is not yet on npm, so the dev loop uses `npm link` (see below).

## Quick start

```sh
# 1. Kineglyph is consumed from a sibling checkout (until it is published)
git clone https://github.com/Nano112/kineglyph.git ../kineglyph
(cd ../kineglyph && npm run bootstrap && for p in packages/*; do (cd "$p" && npm link); done)

# 2. This repo
npm install && npm run link:kineglyph
npm run build
npm install && npm run link:kineglyph      # once: creates node_modules/.bin/pagina, then re-link

# 3. Render the fixture article
npx pagina dev   packages/core/test/fixture              # http://127.0.0.1:4321
npx pagina build packages/core/test/fixture --out dist   # static site in ./dist
```

`npm install` prunes the `@kineglyph/*` symlinks every time; `npm run link:kineglyph` puts them
back. If figures fail with "cannot resolve `kineglyph`", that is what happened.

## The article folder

```
docs/
  article.yaml           # slug, title, nav — the only source of page order
  index.md
  features/basics.md
  scenes/intro.mjs       # a Kineglyph scene: `export default defineScene(...)`
  theme/kineglyph.mjs    # optional: exports { light, dark } ThemeTokens
  media/hero.gif         # referenced relatively from the markdown
  snippets/quickstart.py # `--8<--` include targets
  .pagina/               # written by `pagina dev --edit` (published render); gitignore it
```

```yaml
# article.yaml
slug: nucleation
title: Nucleation
form: docs                 # the only form today
status: published          # draft | published
tags: [minecraft, schematics]
kineglyph:
  theme: theme/kineglyph.mjs   # optional; defaults to Kineglyph's default theme
  width: 960                   # pre-render layout width
snippets:
  roots: [".", ".."]           # where `--8<--` paths resolve; "." only, by default
nav:
  - { title: Home, page: index.md }
  - section: Get started
    children:
      - { title: Basics, page: features/basics.md }
```

Rules:

- `nav` is the page list. A page not in `nav` is not built; a `nav` entry whose file is missing
  is an error.
- Links between pages are written as relative `.md` paths and rewritten to site URLs; a link to
  a page outside `nav`, or to a `#heading` that does not exist, is an error.
- Everything that is not `.md` or `article.yaml` is copied into the site 1:1 at the same path.
- Dotfiles and `node_modules/` are not content: they are skipped by the renderer and by the
  editor's file listing. `.pagina/` in particular is the editor's own output (`rendered/`,
  `published.json`) — add it to `.gitignore`; nothing writes into it except `publish`.

### Markdown dialect

CommonMark + GFM + raw HTML, plus the MkDocs/pymdownx subset that existing docs tend to use:

| Syntax | Renders as |
|---|---|
| `=== "Python"` + 4-space-indented body (consecutive blocks form one group) | accessible tab group |
| `!!! note "Title"` / `??? tip "Title"` + indented body | admonition / collapsible admonition |
| `--8<-- "path/to/file.py:section"` | file (or `[start:section]…[end:section]` region) inlined, re-indented to the directive |
| `## Heading {#custom-id}` and `[text](x.md){ .cls }`, `![img](x.gif){ width="480" }` | explicit ids / attributes (markdown-it-attrs) |
| `<figure markdown="span">…</figure>` (also `markdown="1"`/`"block"`) | markdown rendered inside raw HTML (MkDocs `md_in_html`) |
| fenced code | Shiki dual-theme highlighting (light/dark via CSS variables) |

Headings get stable slug ids (deduplicated `-2`, `-3`) and feed the page table of contents.

### Kineglyph figures

Three interchangeable forms — the host element is always `<figure class="kg">`:

```html
<!-- sibling module: the file exports `default defineScene(...)` -->
<figure class="kg" data-scene="scenes/intro.mjs"></figure>

<!-- inline: same module, embedded -->
<figure class="kg" id="intro">
  <script type="text/kineglyph">
    import { defineScene, stack, heading } from "kineglyph";
    export default defineScene({ schemaVersion: 2, id: "intro", title: "Intro",
      root: stack("r", [heading("h", "Hello")], { padding: 16, width: "fill" }) });
  </script>
</figure>

<!-- static only: you supply the image, nothing hydrates -->
<figure class="kg" data-static="media/intro.svg"><img src="media/intro.svg" alt="Intro"></figure>
```

Module and inline figures are pre-rendered at build time to `_pagina/figures/<page>/<id>.{light,dark}.svg`
(a `<picture>` fallback is injected so the page is complete without JavaScript), then hydrated
in the browser by Kineglyph's `mountAll()`. In `pagina dev`, saving a scene file hot-swaps the
figure in place — no reload. A page may set `data-controls="false"` / `data-readout="false"` on
the host to hide Kineglyph's playback chrome.

Everything else in the page can still be a plain `<script type="module">` — that is the escape
hatch for fully custom, non-pre-renderable interactivity.

## CLI

```
pagina dev   <folder> [--port N] [--base /] [--host addr] [--edit] [--theme LEVEL] [--no-chrome]
pagina build <folder> [--out dist] [--base /] [--no-strict] [--theme LEVEL] [--no-chrome]
```

- Port precedence: `--port` > `PORT` env > `4321`. Blank or non-numeric values are ignored.
- `dev` binds `127.0.0.1` and accepts only `.test` / `localhost` / `127.0.0.1` Host headers by
  default; use `--host` (or `HOST`) to bind wider.
- `build` writes the site and exits `1` with the full diagnostic list on a strict failure;
  `--no-strict` downgrades content problems to warnings so you can render a half-ported folder.
- `--base /repo/` produces site-absolute URLs under a sub-path (GitHub Pages project sites).
- `--theme full|tokens|none` picks how much pagina CSS a page links and `--no-chrome` drops
  pagina's own header row — see [Theming](#theming).
- `--edit` turns on the in-browser editor: `/__edit/` (and `/__edit/<page href>`) serves the
  editor, every page grows an "Edit this page" link, and the article folder is exposed for
  reading *and writing* over HTTP at `/__pagina/edit` (the same contract the Laravel package
  implements: `files`, `upload`, `rename`, `publish`, `events`; a `PUT` whose `If-Match` names a
  stale version is a `409` carrying the server's copy, and `If-Match: *` on a file that does not
  exist is a `412`). It is off by default and
  inherits the loopback-only bind, because anyone who can reach the port can rewrite the folder.
  In dev the editor is served from `@pagina/editor`'s TypeScript source through Vite's `/@fs`; a
  packaged consumer points the same page at `dist/editor.js`/`.css`.
- What the edit API will *not* do, whatever it is asked: escape the folder (paths are checked
  lexically **and** by realpath, so a symlink inside the folder pointing out of it is neither
  readable nor writable, and symlinks are left out of the listing); write, rename, upload to or
  delete anything with a dot-prefixed path segment (`.pagina/`, `.git/`, `.env` — `publish` is the
  only writer allowed into `.pagina/`); or buffer an oversized body (5 MB text/JSON, 50 MB upload,
  then `413`). Writes go to a temp file and are `rename`d into place, so an interrupted save can
  never leave a half-written page.

### With gerrymander (optional)

The repo ships a `gerrymander.yaml`. On a machine running
[gerry](https://nano112.github.io/gerrymander), `gerry dev` grants a sticky port and routes
`https://pagina.test` to the dev server:

```sh
gerry dev                                        # serves .pagina-scratch/ (seeded from the fixture)
PAGINA_CONTENT=path/to/docs gerry dev            # or any article folder
gerry down
```

The zone runs with `--edit`, so whatever it serves can be **rewritten from a browser**. That is why
the default is `.pagina-scratch/` — a gitignored copy the `dev:` command makes from
`packages/core/test/fixture` on first run — and not the fixture itself, which is tracked content a
dozen tests assert against. Delete the folder to start over; `PAGINA_CONTENT` bypasses it entirely.

## Theming

pagina ships one plain stylesheet, and every rule in it sits in a cascade layer
(`@layer pagina.reset, pagina.tokens, pagina.reading, pagina.chrome;`). Unlayered CSS beats
layered CSS at any specificity, so **your rules win over pagina's** with a plain selector and no
`!important`. Four escape hatches, in increasing order of control:

1. **Map the tokens** — ~20 `--pg-*` custom properties (surfaces, ink, accent, lines, radii,
   fonts, measure) that everything pagina draws reads from. Most sites stop here.
2. **Override rules** — ordinary CSS, thanks to the layers.
3. **`--theme tokens`** — link `pagina.tokens.css` (tokens + reset) and style the content column
   yourself.
4. **`--theme none`** — no pagina stylesheet at all; the `pg-*` markup is the whole contract.
   `--no-chrome` additionally drops pagina's header row when your layout supplies one.

The editor shares the same contract — it has no palette of its own.
Full token table and a copy-pasteable host mapping: **[docs/theming.md](docs/theming.md)**.

## Editor

`@pagina/editor` is an in-browser WYSIWYG for the same folder: three panes (pages and files,
the document, the live preview), markdown in and markdown out, every edit applied locally first
and persisted in the background with `If-Match` so a concurrent write becomes a visible conflict
rather than a silent overwrite. It builds Kineglyph figures from a form, embeds `<model-viewer>`
models, uploads by drag or paste, and publishes pages *and* figures — the latter pre-rendered to
light + dark SVG in the browser — through one endpoint.

It is backend-agnostic: the UI talks only to `ArticleStore`, the store only to an
`ArticleBackend`. `pagina dev --edit` is one server behind that contract; a Laravel package is
meant to be another. Three ways to embed it:

```tsx
// 1. React
import { PaginaEditor, ArticleStore, HttpBackend } from "@pagina/editor";
<PaginaEditor store={new ArticleStore(new HttpBackend({ baseUrl: "/__pagina/edit" }))} page="index.md" />
```

```js
// 2. Imperative
import { mountEditor } from "@pagina/editor";
const editor = mountEditor(el, { backendUrl: "/__pagina/edit", page: "index.md" });
await editor.publish();
```

```html
<!-- 3. Custom element (what `pagina dev --edit` serves, and what Blade/Livewire wants) -->
<script type="module">import { defineElement } from "/assets/editor.js"; defineElement();</script>
<pagina-editor backend-url="/__pagina/edit" page="index.md" base="/"></pagina-editor>
```

`dist/editor.js` (ESM) and `dist/editor.iife.js` (global `Pagina`) bundle React and share one
`dist/editor.css`. `kineglyph` stays **external** — a figure in the preview must hydrate on the
same runtime instance the site's pages use, so the host page's import map decides it.

See [`packages/editor/README.md`](packages/editor/README.md) for the attributes, the HTTP
contract, the trust model, and what is not done yet; the contract itself is specified in
[`docs/design/2026-08-17-editor-connectivity-laravel.md`](docs/design/2026-08-17-editor-connectivity-laravel.md).

## Architecture

```
packages/core          @pagina/core          pure renderer: article.yaml, markdown pipeline,
                                             figures, links, strict renderArticle → { manifest, pages, diagnostics }
packages/vite          @pagina/vite          Node side: NodeContentFs, figure pre-render via
                                             @kineglyph/export, buildStatic, createDevServer (Vite + HMR),
                                             and the edit contract behind `--edit`
packages/shell-static  @pagina/shell-static  the default site: HTML template, CSS, client runtime
                                             (theme toggle, tabs, code copy, Kineglyph mount), Shiki
packages/editor        @pagina/editor        the WYSIWYG: document model, optimistic store +
                                             backends, three-pane UI, figure builder, publish
packages/cli           @pagina/cli           `pagina dev|build`
```

Two invariants are enforced, not just intended:

- **`@pagina/core` never imports Node.** It receives a `ContentFs` (`read`/`readBinary`/`exists`/`list`);
  ESLint blocks `node:*` imports under `packages/core/src`. The same core runs in a browser,
  which is what will make an in-browser editor possible later.
- **Shells consume only core's public output.** The `Shell` interface lives in `@pagina/core`
  (`render(article: RenderedArticle, ctx) → { [outputPath]: html }`); `@pagina/shell-static`
  depends on core alone. A second shell needs nothing from `@pagina/vite`.

The manifest (`_pagina/manifest.json`) records the article metadata, the nav tree, per-page
title/headings/prev/next/breadcrumbs, every figure's `staticBase` (append `.<theme>.svg`), and
the asset list.

## Trust model

Markdown pages and scene modules are **trusted content**. The markdown pipeline runs with
`html: true` (raw HTML passes through unsanitised), scene modules execute both at build time and
in the browser, and `snippets.roots` may point outside the article folder. pagina renders
folders written by people with commit access to them; it is not a sandbox for user-submitted
documents.

## Development

```sh
npm test               # vitest, all packages (core, vite incl. dev-server + real Vite build, shell-static)
npm run typecheck
npm run lint
npm run build          # core → vite → shell-static → editor → cli (dependency order)
npm run test:e2e       # Playwright: a real browser against `pagina dev --edit` (needs `npm run build`
                       # and `npx playwright install chromium`); not part of `npm test`
```

The fixture article at `packages/core/test/fixture/` exercises every syntax above and all three
figure forms; it is what the integration tests build.

### Deviations from the design spec (known, tracked)

- The figure provider is Kineglyph-only; the pluggable-provider seam is not built yet.
- Figures are recorded as `staticBase` rather than a `static: Record<theme, path>` map.
- Pagefind search is not yet added.

## License

MIT — see [LICENSE](LICENSE).
