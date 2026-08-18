# Plan B — editor UI, optimistic store + backends, dev edit mode, Kineglyph builder

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** a working in-browser WYSIWYG (`@pagina/editor`) that edits an article folder through a
backend-agnostic, optimistic store; runs against the local folder via `pagina dev --edit`; can build
simple Kineglyph scenes, embed GLB models, pick colors, upload files.

**Architecture:** see spec `docs/design/2026-08-17-editor-connectivity-laravel.md`. Plan A delivered
`@pagina/editor/model` (schema, `parseMarkdown`, `serializeMarkdown`; node names: `tabs`,`tab`,
`admonition`,`snippet`,`figureKg`,`figureImage`,`modelViewer`,`htmlBlock` + StarterKit/Link/Image/
Table/Highlight/TextStyle/Color). Kineglyph lives at `~/Documents/code/kineglyph` (branch
`feat/pagina-embed`, linked into pagina; re-link after `npm install`: `npm run link:kineglyph`).

**Tech:** React 19, `@tiptap/react` 3, `@tiptap/pm`, Vite lib build (ESM + one CSS), vitest+jsdom,
Playwright (best effort). Kineglyph: `@kineglyph/core` (`sceneFromSpec`), `@kineglyph/web/bundle`
(`mountKineglyph`, `renderSvg`).

## Global constraints
- `@pagina/editor` is backend-agnostic: the UI talks only to `ArticleStore`; the store talks only to
  `ArticleBackend`. Nothing in `src/ui` or `src/store` imports `node:*` or Vite.
- Optimistic: every edit applies locally immediately; persistence is queued (debounced 500 ms per
  file), retried with backoff (3×), and versioned (`If-Match`); a 409 becomes a visible conflict
  banner offering "reload theirs" / "overwrite with mine" — never a silent overwrite.
- Styling: one stylesheet, `pge-` prefixed classes, colors/spacing from the site's `--pg-*` tokens
  (fallbacks defined in the sheet so it also works standalone); light/dark via `[data-theme]`.
- Distribution: `@pagina/editor` exports `PaginaEditor` (React), `mountEditor(el, options)` →
  `{ destroy(), store }`, and registers `<pagina-editor backend-url="…" slug="…" page="…">` when
  `defineElement()` is called; `dist/editor.js` (ESM, React bundled) + `dist/editor.css`, and
  `dist/editor.iife.js` for script-tag consumers (Blade). `kineglyph` stays external (import map).
- No Co-Authored-By trailers.

---

### Task B1 — Kineglyph `sceneFromSpec` (repo: kineglyph, branch feat/pagina-embed)
**Files:** `packages/core/src/spec.ts` (+ export from `index.ts`), `packages/core/src/spec.test.ts`, `packages/core/README.md` section.
**Produces:**
```ts
export interface SimpleSceneSpec {
  version: 1; id: string; title: string; description?: string;
  layout: "stack" | "row";              // root arrangement
  gap?: number; padding?: number; background?: "canvas" | "surface" | "none";
  nodes: SimpleNode[];                  // in order
  edges?: { from: string; to: string; label?: string; head?: "arrow"|"none"; style?: "solid"|"dashed"|"flow" }[];
  timeline?: "reveal" | "none";         // reveal nodes then edges, or static
}
export type SimpleNode =
  | { id: string; kind: "heading"|"caption"|"code"|"text"; text: string; tone?: string }
  | { id: string; kind: "box"; title?: string; body?: string; tone?: string; children?: SimpleNode[]; layout?: "stack"|"row" };
export function sceneFromSpec(spec: SimpleSceneSpec): SceneDefinition   // throws with field-named errors on invalid input
export function validateSpec(spec: unknown): { ok: boolean; errors: string[] }
```
Implementation maps onto existing recipes (`stack`, `row`, `heading`, `caption`, `code`, box → framed group with `material("flat")`), edges → scene edges with routes `"straight"`, timeline → `reveal` in node then edge order (reuse whatever helper Nucleation's scenes used: see `packages/scenes` history, or `sceneTimeline` in `docs/scenes/formats-and-io.mjs` in a Nucleation checkout). Result must pass `validateScene` and `resolveFigure({width:800, theme: defaultTheme})` with no error diagnostics. Export from `@kineglyph/core` (thus from the bundle).
**Tests:** valid spec → `defineScene`-valid, resolves, `renderSvg` contains all node texts; edges render; invalid (missing id, unknown kind, edge to unknown node) → `validateSpec` errors name the path; `sceneFromSpec` throws. Commit; push branch (updates PR #1).

### Task B2 — `@pagina/editor` store + backends
**Files:** `packages/editor/src/store/{types,article-store,memory-backend,http-backend,index}.ts`; tests `packages/editor/test/store.test.ts`, `http-backend.test.ts` (fetch mocked).
**Produces:** `ArticleBackend` (spec's HTTP contract as methods: `list`, `read`, `readBinary`, `write(path,text,{version})`, `upload(file,path?)`, `delete`, `rename`, `stat`, `publish(payload)`, optional `subscribe(cb)`), `MemoryBackend(files)`, `HttpBackend({ baseUrl, headers?, fetch? })` (implements the contract; `If-Match`; maps 409 → `ConflictError{ theirs, version }`), `ArticleStore(backend)`: `files` (Map path→{text|bytes, version, dirty, error?}), `open(path)`, `setText(path, text)` (optimistic; queues save), `flush()`, `status` (`saved|saving|dirty|error|conflict` per file + global), `events` (`change`, `status`), `resolveConflict(path, "theirs"|"mine")`, `createFile`, `uploadFile`, `deleteFile`, `renameFile`, `article` (parsed `article.yaml`), `render(path)` → uses `@pagina/core` `renderPage` with a `ContentFs` over the mirror (for preview), `renderAll()` → `RenderedArticle` for publish. Retry with backoff; `subscribe` from backend updates non-dirty files.
**Tests:** optimistic apply → immediate `files.get(p).text`; debounce coalesces; retry then success; 409 → status `conflict`, resolve both ways; upload inserts; render preview of fixture page equals core's output.

### Task B3 — `@pagina/vite` edit middleware + `pagina dev --edit`
**Files:** `packages/vite/src/edit-middleware.ts`, wire in `dev.ts` (option `edit?: boolean`), `packages/cli/src/cli.ts` (`--edit`), tests `packages/vite/test/edit.test.ts`.
**Produces:** `viteEditMiddleware(folder, opts?: { base?: "/__pagina/edit" })` implementing the HTTP contract over the folder (versions = content hash or mtime-ns; `If-Match` → 409 with `{ theirs, version }`; `upload` writes under `media/` by default; `publish` writes `.pagina/published.json` + `_pagina/`-style rendered output into `<folder>/.pagina/rendered/` — dev-only artifact, gitignored by pagina's `.gitignore` template note; `events` SSE from the watcher). `pagina dev --edit` also serves `/__edit/` (and `/__edit/<href>`): an HTML page loading `dist/editor.css` + `dist/editor.js` (dev: `/@fs` paths through Vite; the editor package's Vite entry) with `<pagina-editor backend-url="/__pagina/edit" page="<href→path>">`, import map for `kineglyph`, and the site's `pagina.css` for preview parity. Add an "Edit this page" link in `shell-static`'s template only when `ctx.dev && ctx.edit`.
**Tests:** contract tests against a temp copy of the fixture: list, read (ETag), write ok, write stale → 409 with theirs, upload → file exists + returned path, rename, delete, publish → files written; `/__edit/` → 200 HTML containing `<pagina-editor`.

### Task B4a — Editor UI: shell, editing, preview, save (React + TipTap)
**Files:** `packages/editor/src/ui/{App,Toolbar,Sidebar,PagesTree,FilesPanel,Preview,StatusBar,useStore}.tsx`, `src/ui/theme.css`, `src/index.ts` (`PaginaEditor`, `mountEditor`, `defineElement`), `vite.config.ts` (lib build: es + iife, css), tests `packages/editor/test/ui.test.tsx` (jsdom: mount, type, serialize).
**Produces:** three-pane app: left = pages tree from `article.yaml` nav (+ "all files" list, new page/file, upload button + drop zone), center = TipTap editor bound to the open page (`parseMarkdown` on open, `serializeMarkdown` → `store.setText` on change, debounced), right = live preview (`store.render(path)` → the page HTML inside the site's `.pg-content` styles; Kineglyph figures hydrate via `mountAll`; toggle/split), top = toolbar (block type, bold/italic/code/strike/link, lists, table, code block, admonition, tabs, snippet, figure, model, image/upload, color/highlight, undo/redo) + status ("saved · 2s ago" / saving / conflict banner). Keyboard: Cmd/Ctrl-S = flush. Front matter preserved. Node views for `tabs`/`tab` (tab strip with rename/add/remove), `admonition` (kind selector, title, collapsible), `snippet` (shows resolved content read-only + ref field), `htmlBlock` (code textarea), `figureImage` (image + caption editing), placeholder node views for `figureKg`/`modelViewer` (B4b makes them rich). Custom element wraps `mountEditor`; attributes → options (`backend-url`, `slug`, `page`, `theme`, `headers` JSON).
**Tests:** jsdom: `mountEditor` on MemoryBackend(fixture) opens `index.md`, editor doc equals `parseMarkdown`; typing a paragraph → store text updated (serialized) after debounce; switching pages persists; toolbar inserts an admonition → serialized `!!! note`.

### Task B4b — Rich nodes: Kineglyph Figure Builder, model-viewer, color picker, uploads, slash menu
**Files:** `src/ui/nodes/{FigureKgView,FigureBuilder,ModelViewerView,ImageUpload}.tsx`, `src/ui/{ColorPicker,SlashMenu}.tsx`, `src/ui/kineglyph.ts` (spec ⇄ module source with `// pagina:spec` marker; `previewScene(spec)` via `mountKineglyph`), tests `packages/editor/test/{figure-builder,color,slash}.test.tsx`.
**Produces:** `figureKg` node view: live Kineglyph preview (mountKineglyph on the sibling/inline module through the store's fs → blob URL; falls back to static image; error state), edit affordances: "Open in builder" when the source carries the `pagina:spec` marker, otherwise "Edit source" (code editor textarea with save); builder = form for `SimpleSceneSpec` (title, layout, nodes list with kind/text/tone + nesting, edges, timeline) with live preview and color pickers for tones/background; writes `scenes/<id>.mjs` = `import { sceneFromSpec } from "kineglyph";\n// pagina:spec\nexport default sceneFromSpec(<JSON>);` via the store, and sets `data-scene`. `modelViewer` node view: renders `<model-viewer>` (loads Google's module from a configurable URL, default `https://ajax.googleapis.com/ajax/libs/model-viewer/4.3.1/model-viewer.min.js`), upload GLB → `media/`, attrs (camera-controls, auto-rotate, poster, alt). `ColorPicker`: hex/HSL + swatches from `--pg-*` tokens; used by highlight/textColor marks toolbar and by the builder. Uploads: toolbar button, drag-drop onto editor, paste → `store.uploadFile` → insert `image`/`modelViewer`/link by MIME. Slash menu (`/`): all block inserts. shell-static: auto-include model-viewer module when the page contains `<model-viewer` (ctx option `modelViewerUrl`).
**Tests:** builder spec → module source → parse back → same spec; ColorPicker emits hex; slash menu inserts admonition; modelViewer node serializes to expected HTML; shell-static includes the module script only when needed.

### Task B5 — Ship + smoke + docs
**Files:** `packages/editor/README.md`, root `README.md` (Editor section, `pagina dev --edit`), `packages/editor/package.json` `files`/`exports`, Playwright config + `e2e/edit.spec.ts` (best effort, skipped if browsers unavailable).
**Produces:** `npm run build` builds editor dist; `pagina dev --edit packages/core/test/fixture` → `/__edit/` works: verify IN THE BROWSER (Chrome tools): open, type text on `guide/tabs.md`, see status saved, file on disk changed; insert a figure via the builder → new `scenes/*.mjs` + figure hydrates in preview; upload an image; toggle theme. Screenshots. Restart the live server (`PAGINA_CONTENT=<nucleation-checkout>/docs gerry dev` — with `--edit` if the manifest's `dev:` is updated to include it) and confirm `https://pagina.test/__edit/` opens Nucleation's `index.md`.

## Self-review
Spec coverage: WYSIWYG ✓ B4a/b; color picker ✓; uploads ✓; Kineglyph on the page ✓ B1+B4b; GLB/model-viewer ✓; backend-agnostic + optimistic ✓ B2; Node connectivity ✓ B3; distribution forms ✓ B4a/B5. Laravel → Plan C. Type consistency: `ArticleBackend` (B2) is what B3 implements server-side and Plan C's Laravel controllers implement; node names from Plan A.
