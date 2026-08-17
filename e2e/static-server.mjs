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

/** Exactly the five files `sync-assets.sh` copies into the Laravel package, minus the two CSS. */
const ASSETS = {
  "/vendor/pagina/editor.js": resolve(repo, "packages/editor/dist/editor.js"),
  "/vendor/pagina/editor.iife.js": resolve(repo, "packages/editor/dist/editor.iife.js"),
  "/vendor/pagina/editor.css": resolve(repo, "packages/editor/dist/editor.css"),
  "/vendor/pagina/pagina.css": resolve(repo, "packages/shell-static/client/pagina.css"),
  "/vendor/pagina/kineglyph-web.js": resolve(
    require_.resolve("@kineglyph/web/package.json"),
    "../dist/kineglyph-web.js",
  ),
};

const TYPES = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

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
<pagina-editor data-editor backend-url="${API}" page="index.md" base="/" theme="light"></pagina-editor>
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
      res.statusCode = 404;
      res.end("not found");
    })();
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`static host on http://127.0.0.1:${PORT}/edit`);
});
