# `@pagina/editor`

**The in-browser WYSIWYG editor for a pagina article folder.**

A three-pane editor — pages and files on the left, the document in the middle, the rendered page
on the right — that reads and writes an article folder over an HTTP contract, applies every edit
locally first, and persists in the background. It builds Kineglyph figures from a form, embeds
GLB models, uploads images, and publishes the whole article (pages *and* figures, pre-rendered to
SVG) through one endpoint.

It is backend-agnostic on purpose. The UI talks only to `ArticleStore`; the store talks only to an
`ArticleBackend`. `pagina dev --edit` is one server behind that contract and a Laravel package is
meant to be another; nothing under `src/ui` or `src/store` imports `node:*` or Vite.

```sh
npx pagina dev docs --edit      # then open http://127.0.0.1:4321/__edit/
```

## What it does

- **Editing** — a TipTap document over pagina's markdown dialect: tabs, admonitions, snippet
  includes, figures, model viewers, raw HTML blocks, tables, links, images, text colour and
  highlight. Markdown in, markdown out; `parseMarkdown`/`serializeMarkdown` are a round trip.
- **Optimistic persistence** — an edit applies immediately, is queued per file (500 ms debounce),
  retried with backoff, and sent with `If-Match`. A `409` raises a conflict banner offering
  "reload theirs" or "overwrite with mine"; nothing is ever silently overwritten.
- **A figure builder** — a form over Kineglyph's `SimpleSceneSpec`, with the real runtime as its
  preview. It writes `scenes/<id>.mjs` carrying a `// pagina:spec` marker, which is how it knows a
  module is one it can re-open. Hand-authored scenes are offered a source editor instead.
- **Live figures in the document** — a `figureKg` node evaluates its module and mounts it, so the
  figure in the editor pane is the figure, updating the moment the builder saves.
- **`<model-viewer>` nodes**, a colour picker reading the site's own `--pg-*` palette, drag/paste
  uploads, a `/` slash menu, and a sidebar that creates and deletes pages *and* their `nav` entries
  (comments and key order in `article.yaml` survive).
- **Publish** — renders every page through `@pagina/core` and every module/inline figure to
  light + dark SVG in the browser, then `POST`s manifest + pages + figures in one payload.

## The three distribution forms

### 1. React component

```tsx
import { PaginaEditor, ArticleStore, HttpBackend } from "@pagina/editor";
import "@pagina/editor/editor.css";

const store = new ArticleStore(new HttpBackend({ baseUrl: "/__pagina/edit" }));

<PaginaEditor store={store} page="guide/tabs.md" theme="dark" />;
```

Props: `store` (required), `page` (defaults to `index.md`), `theme`, `modelViewerUrl`, and
`onReady(open)` — which hands back a function for opening another page.

### 2. `mountEditor(el, options)`

```js
import { mountEditor } from "@pagina/editor";

const editor = mountEditor(document.getElementById("editor"), {
  backendUrl: "/__pagina/edit",
  page: "index.md",
});

await editor.publish();
editor.open("guide/tabs.md");
editor.destroy();
```

`EditorOptions`: `backend` (an already-built `ArticleBackend`, which wins over `backendUrl`),
`backendUrl`, `headers` (sent on every request — CSRF, `Authorization`, …), `page`, `base`,
`theme`, `modelViewerUrl`. The returned handle exposes `store`, `open`, `publish`, `destroy`.

### 3. `<pagina-editor>` custom element

```html
<script type="importmap">{"imports":{"kineglyph":"/assets/kineglyph.js"}}</script>
<link rel="stylesheet" href="/assets/editor.css">
<script type="module">
  import { defineElement } from "/assets/editor.js";
  defineElement();                       // registers <pagina-editor>
</script>

<pagina-editor backend-url="/__pagina/edit" page="index.md" base="/"></pagina-editor>
```

Attributes: `backend-url`, `page`, `base`, `theme` (`light`/`dark`), `model-viewer-url`, and
`headers` (a JSON object). The element exposes `.store`, `.open(path)` and `.publish()`, so a
Blade or Livewire page can drive it without importing anything. This is the form
`pagina dev --edit` uses, and the one the Laravel package is designed around.

For a `<script>` tag rather than a module, use `dist/editor.iife.js`, which defines the global
`Pagina`.

### Builds and `kineglyph`

`dist/editor.js` (ESM) and `dist/editor.iife.js` bundle React, and share one `dist/editor.css`.
**`kineglyph` is deliberately left external**: figures in the preview must hydrate on the *same*
runtime instance the site's own pages use, so the host page's import map (or bundler alias)
decides what it resolves to. A host with neither will see figure nodes report
"Failed to resolve module specifier" — this is a configuration requirement, not a bug.

## The backend contract

Full specification: [`docs/design/2026-08-17-editor-connectivity-laravel.md`](../../docs/design/2026-08-17-editor-connectivity-laravel.md).

```
GET    {base}/files                          → { files: [{ path, size, version, mtime }] }
GET    {base}/files/{path}                   → text or binary; ETag = version
PUT    {base}/files/{path} (If-Match: v)     → { version }        409 → { theirs, version }
DELETE {base}/files/{path}                   → 204
POST   {base}/upload  (multipart file,path?) → { path, url, version }
POST   {base}/rename  { from, to }           → { version }
POST   {base}/publish { manifest, pages, figures } → { publishedAt }
GET    {base}/events  (SSE)                  → { type, path, version } frames
```

`version` is the sha1 of the file's bytes, so two servers handing out the same version for the
same content is a feature (a no-op write is not a conflict) and mtime jitter is not. Implement
`ArticleBackend` (`src/store/types.ts`) to talk to something else entirely; `MemoryBackend` is the
reference for tests and demos, `HttpBackend` for the contract above.

## Trust model

The article folder is **trusted content**, and so is everyone who can reach the editing endpoint.

- Markdown passes through with `html: true`, and scene modules execute — at publish time in the
  browser and at build time in Node. The editor is not a sandbox for user-submitted documents.
- `pagina dev --edit` makes the folder writable over HTTP with **no authentication**. It is off by
  default and inherits the dev server's loopback-only bind for exactly that reason. A hosted
  backend must do its own authn/authz before it reaches the contract.
- The dev middleware refuses to escape the folder (paths are checked lexically *and* by realpath),
  refuses any dot-prefixed segment for writes (`.pagina/`, `.git/`, `.env`; `publish` is the only
  writer allowed into `.pagina/`), and caps request bodies.
- **Accepted, not fixed (task B3 re-review):** containment is a check-then-use. A symlink inside
  the folder is resolved and rejected at check time, but a symlink *swapped* between the check and
  the write is not defended against. Closing that needs `O_NOFOLLOW`-style handle-based I/O; since
  the folder is trusted and the attacker would already need write access to it, the race buys them
  nothing they do not already have.

## What is not done yet

- **The figure builder covers `SimpleSceneSpec` only** — no images, icons, badges, grids or
  machines. Scenes using them stay hand-authored, and the builder refuses to open them rather than
  flattening what it cannot express.
- **No Laravel backend.** The contract is specified and the dev server implements it; the PHP side
  is a separate deliverable.
- **No authentication, no multi-user awareness beyond conflict detection.** SSE tells you a file
  changed; it does not tell you who is editing it, and there is no presence or locking.
- **No undo across files**, no page rename from the sidebar (only create and delete), no search.
- **Publish renders figures on the host's runtime**, so a host page without an import map for
  `kineglyph` publishes pages whose figures hydrate client-side instead of carrying SVG.
- **No Playwright smoke test.** The editor is verified in Chrome by hand and by 245 unit/integration
  tests; the end-to-end lane is not wired up.

## Development

```sh
npm test                       # from the repo root: vitest, all packages
npm run typecheck
npm run build                  # tsc → dist/, then vite → dist/editor.{js,iife.js,css}
```

Entry points: `.` (everything), `./model` (schema + markdown parse/serialize, no UI),
`./store` (the optimistic store + backends, no UI), `./bundle` (`dist/editor.js`),
`./editor.css`, `./theme.css`.

## License

MIT — see [LICENSE](../../LICENSE).
