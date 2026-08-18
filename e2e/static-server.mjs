/**
 * The editor as a *host application* sees it: built assets, served flat, over a plain Node
 * server. No Vite anywhere in the browser.
 *
 * This exists because every other check in this repo goes through `pagina dev`, and Vite's dev
 * pipeline hides a whole class of bundle defect — it defines `process.env.NODE_ENV`, polyfills
 * CJS interop, and rewrites bare specifiers, so a bundle that cannot survive on its own still
 * works there. The Laravel package (`packages/pagina-laravel` in schemati) publishes
 * `editor.js`, `editor.css` and `kineglyph-web.js` into `public/vendor/pagina/` and links them
 * from a Blade view; this page is that view's shape, down to the import map and the
 * `defineElement()` call, so what passes here is what will load there.
 *
 * `viteEditMiddleware` is used for the contract only. Despite the package it lives in, it is a
 * plain connect middleware over `node:fs` — the same endpoints Laravel's controllers implement —
 * and running it under `node:http` is the point: the server is not Vite either.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { viteEditMiddleware } from "@pagina/vite";

const require_ = createRequire(import.meta.url);
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..");

const PORT = Number(process.env.PAGINA_STATIC_PORT ?? 4600);
const ARTICLE = resolve(here, ".tmp/static-article");
const API = "/api/articles/fixture";
/** The built site `e2e/setup.ts` produces, and the base it was built for. Keep the two in step. */
const SITE = resolve(here, ".tmp/site");
const SITE_BASE = "/site/";
/** The same article built again with a Kineglyph theme of its own; `figure-theme.spec.ts` reads it. */
const THEMED_SITE = resolve(here, ".tmp/themed-site");
const THEMED_BASE = "/themed/";

/**
 * Exactly the files `sync-assets.sh` copies into the Laravel package.
 *
 * `pagina.css` is the *built* `dist/pagina.css`, not `client/pagina.css`: the source is three
 * files held together by `@import`, and a host that copies it copies a sheet whose imports
 * resolve to 404s next to it. Publishing the flattened artefact is the fix; serving it here is
 * how we notice if it ever stops being emitted.
 */
const ASSETS = {
  "/vendor/pagina/editor.js": resolve(repo, "packages/editor/dist/editor.js"),
  "/vendor/pagina/editor.iife.js": resolve(repo, "packages/editor/dist/editor.iife.js"),
  // The docs demo's implementation. It must sit *beside* `editor.js`, because it finds the bundle
  // (and its stylesheet) with `new URL("editor.js", import.meta.url)` — the same arrangement
  // `tools/build-docs-site.sh` puts on the published site.
  "/vendor/pagina/demo.js": resolve(repo, "packages/editor/dist/demo.js"),
  "/vendor/pagina/editor.css": resolve(repo, "packages/editor/dist/editor.css"),
  "/vendor/pagina/pagina.css": resolve(repo, "packages/shell-static/dist/pagina.css"),
  "/vendor/pagina/pagina.tokens.css": resolve(repo, "packages/shell-static/dist/pagina.tokens.css"),
  "/vendor/pagina/kineglyph-web.js": resolve(
    require_.resolve("@kineglyph/web/package.json"),
    "../dist/kineglyph-web.js",
  ),
};

const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/**
 * A host's CSS reset, shaped like Tailwind's preflight: inside `@layer base`, and linked *before*
 * pagina's assets.
 *
 * This is the trap. `h1 { font-size: inherit }` is what every reset says, pagina's own bare shell
 * never had one, and browser heading defaults papered over the gap in every test we had. A sheet
 * that does not carry the reading layer leaves the preview's `h1` at body size — which is to say
 * the preview stops resembling the page it previews, which is the pane's entire job.
 *
 * Layered rather than unlayered on purpose: pagina's contract is that *unlayered* host CSS wins,
 * so an unlayered reset flattening the headings would be pagina working as designed. A preflight
 * in `@layer base` is the real-world case, and pagina's layers must sort after it however the
 * `<link>`s are ordered.
 */
const RESET = `<style>
@layer base;
@layer base {
  h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; margin: 0; }
  p, blockquote, figure, pre, ul, ol { margin: 0; }
  ul, ol { list-style: none; padding: 0; }
  a { color: inherit; text-decoration: inherit; }
  img { display: block; max-width: 100%; }
}
</style>`;

/** The Blade view's shape: import map, stylesheet, element, `defineElement()`, publish button. */
const page = () => `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><title>Editing (static host)</title>
<link rel="stylesheet" href="/vendor/pagina/pagina.css">
<link rel="stylesheet" href="/vendor/pagina/editor.css">
<script type="importmap">{"imports":{"kineglyph":"/vendor/pagina/kineglyph-web.js"}}</script>
</head>
<body>
<button type="button" data-publish>Publish</button>
<span data-publish-status>idle</span>
<!-- \`page\` is deliberately empty: that is what \`page="{{ $page }}"\` renders for an article
     opened at its root, and reading it as a value rather than as "unset" made the editor open
     the path "", which a backend answers with its file listing. -->
<pagina-editor data-editor backend-url="${API}" page="" base="/" theme="light"></pagina-editor>
<script type="module">
  import { defineElement } from "/vendor/pagina/editor.js";
  defineElement();
  window.__paginaDefined = true;
  document.querySelector("[data-publish]").addEventListener("click", async () => {
    const status = document.querySelector("[data-publish-status]");
    status.textContent = "publishing";
    try {
      const result = await document.querySelector("[data-editor]").publish();
      status.textContent = "published " + result.publishedAt;
    } catch (error) {
      status.textContent = "failed: " + (error?.message ?? error);
    }
  });
</script>
</body></html>`;

/**
 * The same editor page, under a host that has a CSS reset and knows nothing about pagina's
 * layer order.
 *
 * Two variants, because the guarantee has two halves:
 *
 *  - `sheets: ["editor.css"]` — a host that links *only* the editor's stylesheet still gets a
 *    preview that matches the published page. `editor.css` carries the reading layer itself.
 *  - `sheets: ["editor.css", "pagina.css"]` — the editor's sheet first, which is the order that
 *    used to break: `editor.css` declared only `pagina.tokens, pagina.editor`, so loading it
 *    first registered `pagina.editor` *ahead* of `pagina.reading`. schemat.io worked around it
 *    by linking `pagina.css` first. Every pagina sheet now declares the whole order, so both
 *    orders produce the same cascade and the workaround is unnecessary.
 */
const resetHostPage = (sheets) => `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><title>Editing (host with a reset)</title>
${RESET}
${sheets.map((s) => `<link rel="stylesheet" href="/vendor/pagina/${s}">`).join("\n")}
<script type="importmap">{"imports":{"kineglyph":"/vendor/pagina/kineglyph-web.js"}}</script>
</head>
<body>
<pagina-editor data-editor backend-url="${API}" page="" base="/" theme="light"></pagina-editor>
<script type="module">
  import { defineElement } from "/vendor/pagina/editor.js";
  defineElement();
  window.__paginaDefined = true;
</script>
</body></html>`;

/**
 * A host's *own* theme, on top of the reset: near-black translucent surfaces, a magenta accent,
 * a display face that is not the system stack.
 *
 * This is schemat.io's shape, and it is here because "looks good in pagina's default palette" is
 * not the claim being made — the claim is that a host retints every kind of admonition by
 * defining tokens, and never by fighting a rule. If a colour anywhere in the block were
 * hard-coded, this page is where it would show.
 */
const HOST_THEME = `<style>
:root {
  --pg-bg: #0b0b0f;
  --pg-bg-raised: #15151d;
  --pg-bg-sunken: #08080c;
  --pg-fg: #ece9f2;
  --pg-muted: #9a93ab;
  --pg-accent: #ff2bd1;
  --pg-accent-fg: #14040f;
  --pg-line: #262233;
  --pg-line-strong: #3b3550;
  --pg-radius: 0.5rem;
  --pg-radius-lg: 0.875rem;
  --pg-font: Figtree, system-ui, sans-serif;
  --pg-font-display: Figtree, system-ui, sans-serif;
  --pg-code-bg: #111019;
  --pg-shiki-bg: #111019;

  --pg-note: #7aa2ff;   --pg-note-surface: #12131f;   --pg-note-fg: #a9c0ff;
  --pg-tip: #3ddc84;    --pg-tip-surface: #0e1a15;    --pg-tip-fg: #7ce9ae;
  --pg-info: #4fd6ee;   --pg-info-surface: #0d1a1e;   --pg-info-fg: #8ae4f5;
  --pg-warning: #ffc857; --pg-warning-surface: #1d1710; --pg-warning-fg: #ffd888;
  --pg-danger: #ff5c8a; --pg-danger-surface: #1e1017;  --pg-danger-fg: #ff92b1;
  --pg-example: #c08bff; --pg-example-surface: #17111f; --pg-example-fg: #d4b0ff;
  --pg-quote: #8f88a6;  --pg-quote-surface: #131320;   --pg-quote-fg: #b3adc4;
}
body { background: var(--pg-bg); color: var(--pg-fg); }
</style>`;

/** The published page: core's HTML, in a host's article shell, with the built site sheet. */
const publishedPage = (html, theme) => `<!doctype html>
<html lang="en"${theme === "dark" ? ' data-theme="dark"' : ""}>
<head>
<meta charset="utf-8"><title>Admonitions (published, ${theme})</title>
${RESET}
<link rel="stylesheet" href="/vendor/pagina/pagina.css">
${theme === "dark" ? HOST_THEME : ""}
</head>
<body>
<main style="max-width:56rem;margin:0 auto;padding:2rem 1.5rem">
  <article class="pg-content" data-published>${html}</article>
</main>
</body></html>`;

/** The same page, open in the editor, under the same host. */
const editorPage = (theme) => `<!doctype html>
<html lang="en"${theme === "dark" ? ' data-theme="dark"' : ""}>
<head>
<meta charset="utf-8"><title>Admonitions (editing, ${theme})</title>
${RESET}
<link rel="stylesheet" href="/vendor/pagina/pagina.css">
<link rel="stylesheet" href="/vendor/pagina/editor.css">
${theme === "dark" ? HOST_THEME : ""}
<script type="importmap">{"imports":{"kineglyph":"/vendor/pagina/kineglyph-web.js"}}</script>
</head>
<body>
<pagina-editor data-editor backend-url="${API}" page="guide/admonitions.md" base="/" theme="${theme}"></pagina-editor>
<script type="module">
  import { defineElement } from "/vendor/pagina/editor.js";
  defineElement();
  window.__paginaDefined = true;
</script>
</body></html>`;

/** Core's HTML for the page the global setup wrote into the article folder. */
async function renderAdmonitions() {
  const { createMarkdown, renderMarkdown } = await import("@pagina/core");
  const source = await readFile(resolve(ARTICLE, "guide/admonitions.md"), "utf8");
  return renderMarkdown(createMarkdown(), source).html;
}

/**
 * The **built** site page, unchanged, wearing the host's dark palette.
 *
 * Not a hand-written approximation of what the shell emits: the file `buildStatic` wrote, read off
 * disk, with `data-theme="dark"` and the host's token block injected into its head. So the cover
 * header, the SEO tags and the layer order under test are the artefact's own, and the only thing
 * the host contributes is the twenty custom properties it is supposed to contribute.
 */
async function siteUnderHostTheme(rel) {
  const html = await readFile(resolve(SITE, rel), "utf8");
  // The reset goes **before** the page's own `<link>`, which is where a host's preflight actually
  // sits — and where the layer-order guarantee is measured: `@layer base` declared first must
  // still lose to pagina's layers.
  return html
    .replace('<html lang="en" data-theme="light"', '<html lang="en" data-theme="dark"')
    .replace("<head>", `<head>\n${RESET}\n${HOST_THEME}`);
}

/**
 * The docs demo, on a server that is not Vite: `startDemo` against browser storage.
 *
 * This page is the shape of `docs/demo.md` — an empty container and one module import — which is
 * the whole point of moving the demo's implementation into `packages/editor/src/demo.ts`. Before
 * that it was a hundred lines of inline script in a markdown file: the one executable thing in the
 * repository that eslint, `tsc` and every test lane skipped. `e2e/demo.spec.ts` drives this.
 */
const demoPage = () => `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><title>Demo (browser storage)</title>
<link rel="stylesheet" href="/vendor/pagina/pagina.css">
<script type="importmap">{"imports":{"kineglyph":"/vendor/pagina/kineglyph-web.js"}}</script>
<!-- Wide enough for three panes on a desktop viewport, and exactly the viewport on a phone: the
     shell's layout follows its own width, so this is what switches it between the two. -->
<style>body { margin: 0 } #demo { width: min(1200px, 100vw) }</style>
</head>
<body>
<!-- The demo sits below the fold, as it does on the docs page, so "not loaded until it is wanted"
     is a thing this page can actually be wrong about. -->
<div style="height: 150vh"></div>
<div id="demo"></div>
<script type="module">
  import { startDemo } from "/vendor/pagina/demo.js";
  startDemo(document.getElementById("demo"));
  window.__demoStarted = true;
</script>
</body></html>`;

const HOST_PAGES = {
  "/demo": () => demoPage(),
  "/site-dark": () => siteUnderHostTheme("index.html"),
  // A sub-page of the same article, same host, same palette — the proof that the hero is the
  // *article's* and not every page's. It is a route rather than an assertion on `/site-dark`
  // because "absent" is only convincing next to a picture of where it is present.
  "/site-dark-sub": () => siteUnderHostTheme("guide/tabs/index.html"),
  "/host-reset": () => resetHostPage(["editor.css"]),
  "/host-reset-editor-first": () => resetHostPage(["editor.css", "pagina.css"]),
  "/host-reset-pagina-first": () => resetHostPage(["pagina.css", "editor.css"]),
  // The figures page, built, in the host's magenta-and-Figtree palette — the proof that a host
  // which mapped `--pg-*` gets its diagrams re-tinted too, having defined no `--kg-*` at all.
  "/site-figures-dark": () => siteUnderHostTheme("guide/figures/index.html"),
  "/admonitions/published": async () => publishedPage(await renderAdmonitions(), "light"),
  "/admonitions/published-dark": async () => publishedPage(await renderAdmonitions(), "dark"),
  "/admonitions/editing": () => editorPage("light"),
  "/admonitions/editing-dark": () => editorPage("dark"),
};

const edit = viteEditMiddleware(ARTICLE, { base: API, siteBase: "/" });

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  edit(req, res, () => {
    void (async () => {
      const asset = ASSETS[path];
      if (asset !== undefined) {
        try {
          const bytes = await readFile(asset);
          res.setHeader("content-type", TYPES[extname(asset)] ?? "application/octet-stream");
          res.end(bytes);
        } catch {
          res.statusCode = 404;
          res.end(`missing built asset: ${asset} — run \`npm run build\``);
        }
        return;
      }
      if (path === "/" || path === "/edit") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(page());
        return;
      }
      const hostPage = HOST_PAGES[path];
      if (hostPage !== undefined) {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(await hostPage());
        return;
      }
      // The published sites, served as flat files at their own bases — no rewriting, no index
      // synthesis beyond the directory index every static host does.
      for (const [prefix, root] of [[SITE_BASE, SITE], [THEMED_BASE, THEMED_SITE]]) {
        if (!path.startsWith(prefix)) continue;
        const rel = path.slice(prefix.length) + (path.endsWith("/") ? "index.html" : "");
        const file = resolve(root, rel);
        if (file.startsWith(`${root}/`)) {
          try {
            const bytes = await readFile(file);
            res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
            res.end(bytes);
            return;
          } catch { /* fall through to 404 */ }
        }
      }
      res.statusCode = 404;
      res.end("not found");
    })();
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`static host on http://127.0.0.1:${PORT}/edit`);
});
