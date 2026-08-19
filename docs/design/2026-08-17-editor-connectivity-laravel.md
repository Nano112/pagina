# pagina editor, connectivity, and Laravel integration — design

Date: 2026-08-17 (overnight, decisions delegated). Status: approved by mandate; executing.

## Goal

Make pagina a complete, reusable authoring system, not just a renderer:

1. **`@pagina/editor`** — an in-browser WYSIWYG for article folders: modern, fast, easy, extensible.
   Same look as the site. Color picker and utilities. File uploads. Builds simple Kineglyph scenes
   on the page. Embeds GLB models via Google's `<model-viewer>`.
2. **Connectivity** — the editor is backend-agnostic and *optimistic*; it ships the primitives to
   plug into Laravel/Livewire, Node, or anything with a file-ish API.
3. **schemat.io** — integrate via Livewire on a feature branch, shaped as a publishable Laravel
   package; replace the current article system.

Non-goals tonight: multi-user realtime collaboration (design leaves room: per-file versions);
untrusted-author sandboxing (trust model unchanged); Pagefind; a `post` form.

## Decisions (rulings)

| Area | Decision | Why |
|---|---|---|
| Source of truth | **Markdown files stay canonical.** The editor edits `.md`; there is no editor-only document format. | Folder contract, portability, git. |
| Round-trip | Core's block plugins emit **structured tokens** (`tabs_open/tab_open/…`, `admonition_open`, `snippet`, `figure_kg`, `model_viewer`) with markdown-it renderer rules for HTML — HTML output byte-identical to today. The editor parses tokens → ProseMirror doc (prosemirror-markdown), serializes doc → markdown (dialect-preserving). | One parser for site and editor; no drift. |
| Editor engine | **TipTap 3** on ProseMirror. | Extensible node model, mature, already used by schemati. |
| Editor UI | **React 19** components, shipped three ways: `<PaginaEditor/>` React component; `mountEditor(el, opts)` imperative; `<pagina-editor>` custom element (framework-agnostic). Styles: one CSS file on the site's `--pg-*` tokens (`pge-` class prefix), light/dark. | Ecosystem match with TipTap + Kineglyph's React package; the custom element makes Livewire/Blade trivial. |
| State | A small **optimistic store** (`ArticleStore`): in-memory folder mirror (`ContentFs`), immediate local apply, debounced write queue with retry + per-file `version`; conflicts surface as a banner, never silently overwrite. Zustand-free — plain event emitter + React `useSyncExternalStore`. | Fast UI, backend-agnostic. |
| Backend contract | `ArticleBackend` interface: `list()`, `read(path)`, `write(path, text, {version?})`, `readBinary`, `upload(file, path?) → {path,url}`, `delete`, `rename`, `stat`, optional `subscribe(cb)`; plus `publish(rendered)`. Adapters: `MemoryBackend`, `HttpBackend` (documented JSON REST), `viteEditMiddleware` (folder-backed HTTP endpoints for `pagina dev --edit`). | Same editor against Node dev, Laravel, or tests. |
| Preview | The editor renders with `@pagina/core` in the browser (core is pure) — live preview pane / toggle, no server round-trip. Kineglyph figures hydrate live. | Instant. |
| Kineglyph on the page | New `@kineglyph/core` **`sceneFromSpec(spec)`**: a JSON-serializable *simple scene* DSL (title/description, nodes: heading/caption/code/box/stack/row, edges, machine-free) → `SceneDefinition`. The editor's **Figure Builder** edits the spec (form + live preview) and writes a sibling module `export default sceneFromSpec({...})` with a `// pagina:spec` marker so it round-trips. Power users can still hand-write any scene. | Authorable without code; scenes stay scripts. |
| GLB | Editor node "3D model" → `<model-viewer src="media/x.glb" camera-controls …>` raw HTML; shell-static auto-injects the model-viewer module (configurable URL, default Google CDN) when a page contains it. Upload GLB via the backend. | Exactly what Nucleation docs already do by hand. |
| Color | A `ColorPicker` component (HSL/hex, palette from `--pg-*` tokens) used by: text highlight/color marks, admonition tint, figure-builder colors. | Requested. |
| Uploads | Drag-drop/paste → `backend.upload` → inserted node with the returned path; images, GLB, arbitrary files (link). | Requested. |
| Laravel package | `pagina/laravel` at `schemati/packages/pagina-laravel` (composer path repo). Ships: service provider + config, migrations, `ArticleStore` on a Storage disk (`articles/<slug>/`), REST controllers implementing the HTTP contract, Livewire pages (index / show / edit), a Blade **shell** rendering stored manifest + fragments, policies. Built editor assets vendored under `resources/dist` (like Livewire ships JS). | Publishable; no npm coupling for consumers. |
| Rendering in Laravel | **Publish = client renders** `RenderedArticle` (core) + figure SVGs (Kineglyph `renderSvg` in browser) → `POST publish` → stored under `rendered/`; the Blade shell serves stored HTML. No Node in PHP. | Matches "shells consume core output"; trusted authors. |
| schemati | Branch `feat/pagina-articles`: require the package, migration slims `articles` (metadata only; drop `article_pages`, `article_revisions`, blocks), delete `BlockService`/`ArticleEditor`/converters/block views, keep `Article` (comments/likes/views), route `/articles/*` to the package pages. | "Replace the current articles." |

## Architecture

```
@pagina/core          + structured tokens (tabs, admonition, snippet, figure, model-viewer) + renderer rules
                      + sceneSpec helpers? (no — Kineglyph owns sceneFromSpec)
@pagina/editor        model/    schema.ts, markdown-parser.ts, markdown-serializer.ts, roundtrip tests
                      store/    ArticleStore (optimistic), backends/{types,memory,http}.ts
                      ui/       Editor (TipTap), Toolbar, SlashMenu, Sidebar(Pages, Files), Preview,
                                FigureBuilder, ModelViewer node, ColorPicker, Uploads; theme.css
                      index.ts  PaginaEditor (React), mountEditor(), defineElement('pagina-editor')
@pagina/vite          + viteEditMiddleware(folder) (HTTP contract over the folder) + `dev --edit`
@pagina/shell-static  + model-viewer auto-include; unchanged otherwise
@kineglyph/core       + sceneFromSpec + SimpleSceneSpec type + validate
schemati/packages/pagina-laravel   Laravel package (see above)
```

### HTTP contract (implemented by `viteEditMiddleware` and the Laravel package)

```
GET    {base}/files                         → { files: [{ path, size, version, mtime }] }
GET    {base}/files/{path}                  → text or binary (Content-Type by extension); ETag = version
PUT    {base}/files/{path}  (If-Match: v)   → { version }            409 on version mismatch
POST   {base}/upload  (multipart file, path?) → { path, url, version }
DELETE {base}/files/{path}                  → 204
POST   {base}/rename  { from, to }          → { version }
POST   {base}/publish { manifest, pages:{href: html}, figures:{id:{theme:svg}} } → { publishedAt }
GET    {base}/events   (SSE, optional)      → file-changed events for other-tab awareness
```
`{base}` = `/api/articles/{slug}` in Laravel; `/__pagina/edit` in the Vite dev server.

**`If-Match` semantics**, settled after both servers had implemented it: a *version* mismatch is a
**409** carrying `{ theirs, version }`, which is what the editor turns into its conflict banner;
`If-Match: *` means "must already exist" and answers **412** with `{ message }` when it does not —
there is no `theirs` to return in that case, so a 409 body would misdescribe what the server holds.
A `PUT` with no `If-Match` creates or replaces unconditionally.

### Attribution and history (added 2026-08-19)

See `docs/design/2026-08-19-attribution.md` for the reasoning. This section is the normative wire
format; a host implements against exactly what is written here.

An **`Author`** is `{ id, name, email?, avatarUrl? }`. `id` and `name` are non-empty strings and
both are required; `email` and `avatarUrl` are optional. A client that receives an author missing
either required field discards it and behaves as though none were sent, so a half-filled author is
the same as silence.

Every field below is **optional for the server**. A host that does not track identity omits them,
and the editor degrades to the wording it had before — that is a supported configuration, not a
broken one.

```
GET    {base}/files
  → { files: [{ path, size, version, mtime,
                lastEditedBy?: Author, lastEditedAt?: <ISO-8601> }] }

PUT    {base}/files/{path}
  → 200 { version, lastEditedBy?: Author, lastEditedAt?: <ISO-8601> }
  → 409 { theirs, version, message?, by?: Author, at?: <ISO-8601> }
  → 412 { message }                                      (If-Match: * on a missing file; unchanged)

POST   {base}/upload   → { path, url, version, lastEditedBy?: Author, lastEditedAt?: <ISO-8601> }
POST   {base}/rename   → { version, lastEditedBy?: Author, lastEditedAt?: <ISO-8601> }
POST   {base}/publish  → { publishedAt, publishedBy?: Author }

GET    {base}/events   (SSE)
  → { type, path, version?, by?: Author, at?: <ISO-8601> }

GET    {base}/history?path=<path>&limit=<n>              (OPTIONAL endpoint)
  → 200 { edits: [{ path, action, at: <ISO-8601>, by: Author, version, from? }] }
  → 404 (or 501) when this host keeps no history
```

`action` is one of `write | upload | delete | rename | publish`. `version` is the version the edit
produced, and is the empty string for a `delete` or a `publish`, which produce none. `from` is
present only on a `rename` and names the old path. `path` on a `publish` row is the article's slug,
since a publish is not about one file.

`GET {base}/history` answers **newest first**. `path` filters to one file and must also match a
rename's `from`, so a file's log does not begin at the moment it was renamed. `limit` defaults to
**50** and is clamped to **500** — the endpoint is reachable from a browser, and an unbounded limit
on a host with years of edits is a way to ask a server to serialise its whole log. A host that keeps
no history must answer 404 or 501 rather than `{ "edits": [] }`: the client shows the panel only
when the endpoint exists, and an empty list claims that nobody has edited the article.

`HttpBackend` does not probe for the endpoint. A host that implements it constructs the backend with
`history: true` (or sets the `history` attribute on `<pagina-editor>`); without that the client
never calls it and hides the panel.

**The security rule, which is not optional.** The server derives the author from the request's own
authenticated session — `auth()->user()` in Laravel, the session in a Node host. It **must ignore
any author named in the request**: in the body, in the query string, in a header. The editor never
sends one and there is no field for it in this contract, so anything that arrives claiming to be an
author came from something other than pagina's client, and believing it would let any caller write
as anybody. Attribute the write to the session or refuse it.

A host is free to store more than it returns. Nothing here asks for old file contents: `history`
records *that* an edit happened, not what it said.

### Editor document model (TipTap nodes)

doc › (heading | paragraph | bulletList | orderedList | codeBlock | blockquote | table | image |
tabs › tab+ › block+ | admonition{kind,title,collapsible} › block+ | snippet{ref} (atom, shows the
resolved include read-only) | figureKg{kind,scene?,source?,id,static?,controls,readout} (atom, live
Kineglyph preview) | modelViewer{src,alt,attrs} (atom) | htmlBlock{html} (atom, raw) | horizontalRule).
Marks: bold, italic, code, link, strike, highlight{color}, textColor{color} (serialized as
`<mark style>`/`<span style>` — raw HTML the dialect already allows).

## Testing

- core: structured-token tests + golden HTML equality against pre-refactor output for the fixture and
  Nucleation `index.md`/`basics.md`.
- editor model: round-trip `md → doc → md` idempotent on fixture pages, Nucleation index/basics, and
  synthetic docs for every node; `md → doc → md → doc` equal.
- store: optimistic apply, queue, retry, conflict.
- vite edit middleware: contract tests (list/read/write/conflict/upload/rename/publish).
- editor UI: vitest + jsdom smoke for mount/serialize; Playwright smoke (`pagina dev --edit` on the
  fixture: type, insert figure via builder, upload image, publish) — best effort.
- Kineglyph: `sceneFromSpec` tests (valid spec → resolves + renders; invalid → diagnostics).
- Laravel: Pest tests for the contract controllers, policies, publish, and the shell rendering.

## Sub-projects and order

A. Core structured tokens + editor model (round-trip). B. Editor UI + store/backends + vite edit
mode + Kineglyph `sceneFromSpec` + model-viewer + color picker + uploads. C. Laravel package +
schemati branch. Each is its own plan and SDD run; each leaves the previous working.
