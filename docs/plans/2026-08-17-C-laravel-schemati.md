# Plan C — `pagina/laravel` package + schemat.io integration

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** schemat.io (`~/Documents/code/schemati`, Laravel 12 / Livewire 4.3 / Filament 5 / Tailwind 4,
bun-built) authors and serves articles with pagina: the editor mounted in a Livewire page, files on a
Storage disk, publish stores client-rendered output, a Blade shell renders it. Old block-editor article
system removed. Shaped as a standalone Laravel package.

**Architecture:** package at `schemati/packages/pagina-laravel` (`pagina/laravel`, PSR-4 `Pagina\Laravel\`,
composer path repository), required by the app. It ships: service provider (routes, views, config,
migrations, Livewire components, publishable assets), `ArticleStore` on a configurable disk
(`articles/{slug}/…`), controllers implementing pagina's HTTP contract (`/api/articles/{slug}/…`),
Livewire pages `pagina::articles.index|show|edit`, Blade shell (layout slots for the host app),
policies (`viewAny/view/create/update/publish`), built editor + kineglyph runtime assets under
`resources/dist` (copied from `@pagina/editor` `dist/` and `@kineglyph/web` `dist/kineglyph-web.js`).
Rendering: publish payload = `{ manifest, pages: {href: html}, figures: {id: {light: svg, dark: svg}} }`
produced by the editor (`store.renderAll()` + Kineglyph `renderSvg` per theme) → stored under
`articles/{slug}/.rendered/`; `show` reads it. Drafts preview in the editor only.

**Branch:** `feat/pagina-articles` in schemati (from `main`). Commits allowed (no trailers). Nothing pushed
without explicit instruction beyond the branch itself (push the branch at the end; do not open a PR
against schemati unless the ledger says the user asked — it doesn't; leave the branch pushed).

## Global constraints
- The package must not depend on schemati internals: user model via `config('pagina.user_model')` /
  `auth()->user()`, layout via `config('pagina.layout')` (default `pagina::layouts.app`, overridable),
  disk via `config('pagina.disk')`, route prefix/middleware via config, policies overridable.
- HTTP contract exactly as in `@pagina/editor` `HttpBackend` (versions via ETag/`If-Match`, 409 body
  `{ theirs, version }`, multipart upload, `publish`).
- Trust model: only users with `update` on the article may write/upload/publish; markdown/scene content
  is trusted; uploads restricted by extension allowlist + size from config; paths normalised, no `..`.
- schemati: keep `Article` model (uuid, slug, author, status, visibility, category, tags, counters,
  comments/likes/views relations) — slimmed; drop `content`, `article_pages`, `article_revisions`;
  delete `App\Livewire\Articles\*`, `App\Services\Articles\*`, article block views/JS, `MarkdownService`
  ONLY if nothing else uses it (grep first). Filament `ArticleResource` becomes metadata-only.
- Tests: Pest feature tests for the contract controllers, policies, publish, and `show` rendering;
  `php artisan test --filter=Pagina` green; `vite build` (bun) green.

---

### Task C1 — package skeleton, store, contract API, policies, tests
**Files:** `packages/pagina-laravel/{composer.json,src/PaginaServiceProvider.php,config/pagina.php,routes/api.php,src/Support/ArticleStore.php,src/Http/Controllers/{FilesController,UploadController,PublishController,RenameController}.php,src/Http/Requests/*.php,src/Policies/ArticlePolicy.php (default; app may override),database/migrations/*_add_pagina_columns_to_articles.php,tests/…}`; app: `composer.json` path repo + require; `App\Providers\AuthServiceProvider` maps policy (or package registers Gate default).
**Produces:** `ArticleStore` (`disk`, `root = "articles/{slug}"`; `list()`, `read(path)`, `write(path, text, ?ifMatchVersion)` (version = sha1 of contents), `upload(UploadedFile, ?path)` → `media/<safe-name>`, `delete`, `rename`, `publish(payload)` writes `.rendered/manifest.json`, `.rendered/pages/<href>.html`, `.rendered/figures/<id>.<theme>.svg`, `readRendered()`); path safety (`Str::of()->…`, reject `..`, absolute, `.rendered/` writes from clients). Routes under `config('pagina.route_prefix', 'api/articles')`, middleware `config('pagina.middleware', ['web','auth'])`, `{article:slug}` binding, `can:update,article` on writes, `can:view,article` on reads. Also `GET /files` includes `version`. New columns on `articles`: `published_at` (exists), `pagina_published_at`, `pagina_version` (nullable), and `article.yaml` is generated from the row (`slug/title/status/visibility/category/tags/nav?`) when missing — nav lives in the file after that. Config: `disk`, `route_prefix`, `middleware`, `layout`, `upload.max_kb`, `upload.extensions` (png jpg jpeg gif webp svg glb gltf mp4 pdf schem litematic nbt), `model_viewer_url`.
**Tests (Pest):** as author: list/read/write/409/upload/rename/delete/publish; as other user: 403; path traversal rejected; article.yaml bootstrapped from row.

### Task C2 — Livewire pages + Blade shell + assets
**Files:** `packages/pagina-laravel/src/Livewire/{ArticleIndex,ArticleShow,ArticleEdit}.php`, `resources/views/{layouts/app,livewire/index,livewire/show,livewire/edit,partials/shell-nav,partials/shell-toc}.blade.php`, `resources/dist/{editor.js,editor.iife.js,editor.css,kineglyph-web.js,pagina.css}` (copied by a script `packages/pagina-laravel/scripts/sync-assets.sh` from `../../../pagina` and `../../../kineglyph` builds — document; commit the built files), publishable via `php artisan vendor:publish --tag=pagina-assets` to `public/vendor/pagina`; SP registers Livewire components + routes `GET /articles`, `/articles/{article:slug}`, `/articles/{article:slug}/{page?}` (wildcard), `/articles/{article:slug}/edit`.
**Produces:** `show`: reads `.rendered/manifest.json` + the requested page fragment; Blade shell mirrors pagina's static shell (sidebar nav from manifest, TOC, prev/next, breadcrumbs, theme toggle) using `pagina.css` for content styles + host layout; import map `kineglyph` → published `kineglyph-web.js`; `mountAll` on load (small inline module); model-viewer script when needed. `edit`: Livewire page that renders `<pagina-editor backend-url="/api/articles/{slug}" page="{path}" headers='{"X-CSRF-TOKEN": "…"}'>` + loads `editor.iife.js`/`editor.css` (published assets), plus a "Publish" button that calls the editor's `publish()` (custom element method / event) and shows status; on publish success Livewire refreshes `pagina_published_at`. `index`: list published (and own drafts) with links; create-new form (title → slug → creates row + `article.yaml` + `index.md`).
**Tests:** show renders published page (fixture rendered payload seeded via `ArticleStore::publish`); unpublished → 404 for non-authors; edit page contains `<pagina-editor` with correct attributes; index lists.

### Task C3 — schemati: adopt the package, remove the old article system
**Files:** app `composer.json`, `routes/web.php` (remove old article routes; package routes take over), migration `..._slim_articles_for_pagina.php` (drop `content`, drop tables `article_pages`, `article_revisions`; keep counters), delete `app/Livewire/Articles/*`, `app/Services/Articles/*`, `resources/views/livewire/articles/**`, `resources/js/article-editor.js` (+ vite input if listed), `app/Models/{ArticlePage,ArticleRevision}.php`, `Filament/Resources/ArticleResource*` slimmed (metadata form only; remove content/blocks fields), `App\Helpers\Sanitizer` only if article-only (grep), `MarkdownService` only if unused elsewhere (grep — it lets `<x-*>` through; other pages may use it). Update `Article` model (`fillable`/`casts`, remove `content`, keep media collections for cover, add `pagina` helpers). Keep `Comment`, likes, views working (they reference `Article` polymorphically).
**Verification:** `composer dump-autoload`, `php artisan migrate` on the local DB (or sqlite test DB), `php artisan test` (whole suite; fix breakages caused by removals), `bun run build` (Vite) green, `php artisan route:list | grep articles` shows package routes only. If the local app can be served (check `docker compose ps` / gerry `schemati.test`), smoke: create an article via index, open editor, type, publish, view — in the browser; else record why not and rely on tests. Push branch `feat/pagina-articles`.

## Self-review
Spec coverage: Laravel package publishable ✓ C1/C2; Livewire integration ✓ C2; replace articles ✓ C3; contract parity with `HttpBackend` ✓ C1. Rendering-in-Laravel ruling (client renders on publish) ✓ C2. Deferred: S3 disk (config only), realtime, revisions history (drop for now — folder is git-able later).
