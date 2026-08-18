# Plan A — core structured tokens + `@pagina/editor` document model

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** the site's markdown dialect round-trips through a ProseMirror document losslessly enough
that editing in a WYSIWYG never changes what the site renders.

**Architecture:** core's tabs/admonition plugins emit structured tokens + renderer rules (HTML output
unchanged). New package `@pagina/editor` with a headless `model/` layer: TipTap/ProseMirror schema,
`parseMarkdown(md) → doc`, `serializeMarkdown(doc) → md`, proven by idempotence + rendered-HTML
equality on the fixture and on Nucleation's `index.md`/`basics.md`.

**Tech:** TS 5.9, vitest 4 (jsdom for a few tests), markdown-it 14, `@tiptap/core` + `@tiptap/pm`
(ProseMirror), `prosemirror-markdown`, TipTap 3 extensions (`@tiptap/starter-kit`, `@tiptap/extension-table`, `@tiptap/extension-image`, `@tiptap/extension-link`, `@tiptap/extension-highlight`, `@tiptap/extension-text-style`, `@tiptap/extension-color`).

**Spec:** `docs/design/2026-08-17-editor-connectivity-laravel.md` (this repo).

## Global constraints
- `@pagina/core` stays free of `node:*` (ESLint). HTML output of `renderMarkdown`/`renderArticle` must be **byte-identical** before/after A1 for the fixture and for Nucleation `index.md`/`basics.md` (golden test).
- `@pagina/editor/model` must be DOM-free (usable in Node + browser); UI comes in Plan B.
- No Co-Authored-By trailers. Commit per task on `main`.
- Round-trip guarantee (all model tests): for md in {fixture pages, Nucleation index.md, basics.md, synthetic per-node samples}: (1) `serialize(parse(md))` is a fixed point after one pass: `s(p(s(p(md)))) === s(p(md))`; (2) `p(s(p(md)))` equals `p(md)` (doc JSON equality); (3) `renderMarkdown(createMarkdown(), md).html === renderMarkdown(createMarkdown(), s(p(md))).html` **and** the same after `expandSnippets` where relevant (use the fixture fs / Nucleation repo for snippets, roots as in their article.yaml).

---

### Task A1 — core: structured tokens for tabs and admonitions (+ `mdInHtml` switch)
**Files:** modify `packages/core/src/plugins/{tabs,admonition,anchors,md-in-html}.ts`, `src/markdown.ts`; tests `packages/core/test/{markdown,tokens,golden}.test.ts`.
**Produces:**
- Tokens: `pg_tabs_open`/`pg_tabs_close` (block, `nesting ±1`), `pg_tab_open`(attrs `label`)/`pg_tab_close`; between them the body's ordinary block tokens (parsed with `state.md.block.parse(body, md, env, tokens)` at the right nesting — NOT pre-rendered HTML). `pg_admonition_open` (attrs `kind`, `title` (resolved), `collapsible: "true"|"false"`)/`pg_admonition_close` + body tokens. Renderer rules produce exactly today's HTML (`<div class="pg-tabs" data-pg-tabs><div class="pg-tabs__list" role="tablist">…buttons…</div><section role="tabpanel" …>` etc.). Because buttons need all labels before the first panel, the renderer for `pg_tabs_open` must look ahead in `tokens` for its `pg_tab_open` labels (or the tabs rule stores `labels` on the open token as `meta.labels`); per-page counter via `env.tabCounter` as before.
- Heading collection: since bodies are now real tokens in the same stream, the anchors core rule sees them in document order — remove the `token.meta.headings` splice machinery (keep dedupe map). md_in_html keeps its own nested render (it still needs to render markdown inside raw HTML) → keep its meta.headings path.
- `createMarkdown({ highlight?, mdInHtml?: boolean })` — default true; `false` skips the md_in_html rule (the editor parses raw HTML blocks itself).
- Export a `parseTokens(md, text)` helper? Not needed — `md.parse(text, env)` is enough; document it in `markdown.ts`.
**Tests:** `tokens.test.ts` asserts the token structure for a tabs group and an admonition (types, attrs, nesting, body tokens present as `paragraph_open`/`fence` etc.). `golden.test.ts`: BEFORE changing anything, generate golden HTML for fixture pages + the vendored Nucleation pages `fixtures/nucleation/docs/index.md` and `features/basics.md` (with `expandSnippets` using their roots) into `packages/core/test/golden/*.html` (committed) — then assert equality after the refactor. Existing tests keep passing (`renderMarkdown` HTML unchanged; heading order test).

### Task A2 — `@pagina/editor` scaffold + schema + markdown → doc parser
**Files:** `packages/editor/{package.json,tsconfig.json,tsconfig.build.json}`, `src/model/{schema,nodes,parser,index}.ts`, `src/model/index.ts` re-exported as `@pagina/editor/model` (package `exports` subpath); tests `packages/editor/test/parser.test.ts`.
**Produces:**
- `editorExtensions(): Extension[]` (TipTap) — StarterKit (heading 1–6, lists, code block with `language` attr, blockquote, hr, bold/italic/strike/code), Link, Image (attrs `src`,`alt`,`title`,`width`), Table (+row/cell/header), Highlight (multicolor), TextStyle+Color, plus custom nodes: `tabs` (content `tab+`), `tab` (attrs `label`; content `block+`), `admonition` (attrs `kind`,`title`,`collapsible`; content `block+`), `snippet` (atom; attrs `ref`), `figureKg` (atom; attrs `kind: "module"|"inline"|"static"`, `id`, `scene`, `source`, `static`, `controls`, `readout`, `extraAttrs` JSON string), `figureImage` (attrs `src`,`alt`,`width`,`caption`) for `<figure markdown="span">`, `modelViewer` (atom; attrs `src`,`alt`,`attrs` JSON string), `htmlBlock` (atom; attrs `html`). Node names are the contract for Plan B.
- `getEditorSchema()` via `getSchema(editorExtensions())` from `@tiptap/core` (no DOM).
- `parseMarkdown(md: string, opts?: { md?: MarkdownIt }) → ProseMirrorNode` using `prosemirror-markdown` `MarkdownParser(schema, createMarkdown({ mdInHtml: false }), tokenSpec)`; token specs for all standard tokens + `pg_tabs_*`, `pg_tab_*`, `pg_admonition_*`; a **pre-pass on `html_block` tokens** that classifies them: kg figure → `figureKg` (parse attrs + inline script text), `<figure markdown="span">` with `![]()`+figcaption → `figureImage`, `<model-viewer …>` → `modelViewer`, else `htmlBlock`. A paragraph whose only content is `--8<-- "ref"` → `snippet`. Front matter (`---…---`) is captured and returned separately: `parseMarkdown` returns `{ doc, frontMatter?: string }`.
- Attribute syntax `{ .cls key="v" }` on images/links (markdown-it-attrs) → preserved as node attrs (`width`, `class`) so the serializer can re-emit them.
**Tests:** parser produces the expected node tree for: fixture `index.md`, `guide/tabs.md`, `guide/figures.md`; a synthetic sample per custom node; Nucleation index.md parses without `htmlBlock` fallbacks except where genuinely raw (assert count of `htmlBlock` nodes ≤ 1 and name which); basics.md parses `figureImage` ×3, `tabs` ×7.

### Task A3 — doc → markdown serializer + round-trip proof
**Files:** `packages/editor/src/model/serializer.ts`; tests `packages/editor/test/roundtrip.test.ts`.
**Produces:** `serializeMarkdown(doc, opts?: { frontMatter?: string }) → string` via `prosemirror-markdown` `MarkdownSerializer` with node serializers: tabs → blank-line-separated `=== "Label"` blocks with 4-space-indented bodies; admonition → `!!! kind "Title"` / `??? kind "Title"` (omit `"Title"` when it equals the capitalised kind) + indented body; snippet → `--8<-- "ref"`; figureKg → canonical `<figure class="kg" …>` (attribute order: class, data-scene, id, data-static, data-controls, data-readout, extras; inline: `<script type="text/kineglyph">\n…\n</script>`); figureImage → `<figure markdown="span">\n  ![alt](src){ width="480" }\n  <figcaption>…</figcaption>\n</figure>`; modelViewer → `<model-viewer …></model-viewer>`; htmlBlock → raw; images/links with attrs → `{ … }` suffix; tables → GFM; code fence with language; highlight → `<mark style="background:…">…</mark>`; textColor → `<span style="color:…">…</span>`. Headings emit `{#id}` only when the id was explicit in the source (track `explicitId` attr from parser).
**Tests (the guarantee, verbatim from Global constraints):** for each source (fixture 3 pages; the Nucleation pages `docs/index.md` and `docs/features/basics.md`, read from the vendored copies under `fixtures/nucleation/` rather than from a sibling checkout; synthetic per-node samples): fixed point after one pass; doc equality; rendered-HTML equality via core (with `expandSnippets` where the page has directives — use `NodeContentFs`-like test helper with the right roots). Print a unified diff on failure. Also a test that `serialize(parse(md))` for Nucleation index.md differs from `md` only in whitespace/normalisation (report the diff size; not asserted equal).

## Self-review
Spec coverage: structured tokens ✓ (A1), model + parser ✓ (A2), serializer + guarantee ✓ (A3); UI/store/backends → Plan B; Kineglyph sceneFromSpec → Plan B. Type consistency: node names/attrs listed in A2 are the contract A3 and Plan B use. Golden test in A1 protects the site.
