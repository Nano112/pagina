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

const HOST_PAGES = {
  "/host-reset": () => resetHostPage(["editor.css"]),
  "/host-reset-editor-first": () => resetHostPage(["editor.css", "pagina.css"]),
  "/host-reset-pagina-first": () => resetHostPage(["pagina.css", "editor.css"]),
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
        res.end(hostPage());
        return;
      }
      // The published site, served as flat files at its own base — no rewriting, no index
      // synthesis beyond the directory index every static host does.
      if (path.startsWith(SITE_BASE)) {
        const rel = path.slice(SITE_BASE.length) + (path.endsWith("/") ? "index.html" : "");
        const file = resolve(SITE, rel);
        if (file.startsWith(`${SITE}/`)) {
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
