/**
 * A Node application that already has a page, serving a pagina article inside it.
 *
 * This is the case `docs/index.md` is about: the documentation is not a site of its own, it is a
 * section of somebody else's application, under that application's header and in its palette. So
 * nothing here renders markdown at request time and nothing here runs Vite. The server reads an
 * *unpacked article bundle* — the `.rendered/` tree `pagina pack` puts inside a `.pgz` — and drops
 * the HTML fragment for a page into its own layout.
 *
 * Run it:
 *
 *   node examples/node-host/server.mjs [bundle-or-folder]
 *
 * With no argument it packs and unpacks `docs/` for you, at the base it is about to mount the
 * article at. That base matters: the hrefs inside `.rendered/` are baked in at pack time, so
 * `--base /docs/` and `MOUNT = "/docs/"` are one decision written in two places, and the server
 * refuses to start if they disagree.
 *
 * What it demonstrates, in order of how much of pagina it uses:
 *
 *  1. `.rendered/pages/<slug>.html` in a host layout, with the article's own nav rebuilt from
 *     `.rendered/manifest.json`. No pagina code runs per request.
 *  2. `--pg-*` mapped onto the host's palette. The prose, the callouts *and* the pre-rendered
 *     figures re-tint from that one block, because a published figure is inline SVG whose paints
 *     are `var(--kg-color-…, …)` references into the same tokens.
 *  3. `viteEditMiddleware` from `@pagina/vite`, which despite the package name is a plain
 *     connect-style middleware over `node:fs`, mounted under `node:http`. It is the server half of
 *     the editor's HTTP contract; `<pagina-editor>` on `/admin/` is the client half.
 *
 * What it does **not** do is listed at the bottom of the file, and in `docs/install.md`.
 */
// --8<-- [start:imports]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pageSlug } from "@pagina/core";
import { viteEditMiddleware, resolveKineglyphBundle } from "@pagina/vite";
// --8<-- [end:imports]

const require_ = createRequire(import.meta.url);
const repo = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

/** Where the article hangs off this application. Must equal the `--base` it was packed at. */
const MOUNT = "/docs/";
/** Where the editor's HTTP contract is mounted. `<pagina-editor backend-url>` names the same path. */
const API = "/api/article";
const PORT = Number(process.env.PORT ?? 5173);

// ---- the article ------------------------------------------------------------------------------

/**
 * An unpacked bundle: a directory holding the article source *and* a `.rendered/` tree.
 *
 * `pagina unpack` writes exactly this, and so does the editor's `publish` endpoint (into
 * `.pagina/rendered/`). Either is fine; this one takes the unpack layout because it is the one a
 * host receives as a file from elsewhere.
 */
const article = resolve(process.argv[2] ?? seedArticle());

function seedArticle() {
  const dir = resolve(repo, "examples/node-host/.article");
  if (existsSync(join(dir, ".rendered/manifest.json"))) return dir;
  const cli = resolve(repo, "packages/cli/dist/cli.js");
  if (!existsSync(cli)) throw new Error(`${cli} does not exist — run \`npm run build\` first`);
  const pgz = `${dir}.pgz`;
  console.log(`seeding ${dir} from docs/ at base ${MOUNT}`);
  execFileSync("node", [cli, "pack", resolve(repo, "docs"), "-o", pgz, "--base", MOUNT], { stdio: "inherit" });
  execFileSync("node", [cli, "unpack", pgz, dir, "--force"], { stdio: "inherit" });
  return dir;
}

const manifest = JSON.parse(await readFile(join(article, ".rendered/manifest.json"), "utf8"));
const descriptor = JSON.parse(await readFile(join(article, "bundle.json"), "utf8"));
if (descriptor.base !== MOUNT) {
  throw new Error(
    `this bundle was rendered at base ${descriptor.base}, and the server mounts it at ${MOUNT}. ` +
    `Re-pack with --base ${MOUNT}, or change MOUNT.`,
  );
}

// ---- what the host serves out of node_modules ---------------------------------------------------
// Resolved rather than copied, so an upgrade cannot leave a stale file behind. A real deployment
// copies these into `public/` at build time; the rule there is to copy from `dist/` and never from
// `client/`, whose `@import`s will 404 next to your copy. See docs/theming.md.

const ASSETS = {
  "/assets/pagina.css": require_.resolve("@pagina/shell-static/pagina.css"),
  "/assets/editor.css": require_.resolve("@pagina/editor/editor.css"),
  "/assets/editor.js": resolve(require_.resolve("@pagina/editor/package.json"), "../dist/editor.js"),
  // The bare specifier `kineglyph` that scene modules and the editor's preview import. The page's
  // import map is what resolves it, and it must resolve to *one* copy: two runtimes on a page is
  // two registries of scene state.
  "/assets/kineglyph.js": resolveKineglyphBundle("import"),
};

const TYPES = {
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2",
};

// ---- the host's own identity --------------------------------------------------------------------
// --8<-- [start:theme]
/**
 * The entire theming contract, exercised.
 *
 * Twenty-two `--pg-*` plus three per admonition kind. Nothing below names a pagina selector, and
 * pagina is never told this file exists. The figures follow it too: a published figure is inline
 * SVG whose every paint is `var(--kg-color-<role>, <drawn colour>)`, and `pagina.css` already
 * points each role at the `--pg-*` that means the same thing.
 */
const HOST_THEME = `
:root {
  color-scheme: dark;
  --pg-bg: #0b0d12;
  --pg-bg-raised: #141824;
  --pg-bg-sunken: #070911;
  --pg-fg: #e6e9f2;
  --pg-muted: #93a0bd;
  --pg-accent: #ffb020;
  --pg-accent-fg: #1a1200;
  --pg-line: #222839;
  --pg-line-strong: #384056;
  --pg-radius: 2px;
  --pg-radius-lg: 3px;
  --pg-font: ui-monospace, "SF Mono", Menlo, monospace;
  --pg-font-display: ui-monospace, "SF Mono", Menlo, monospace;
  --pg-measure: 78ch;
  --pg-code-bg: #0f1320;
  --pg-shiki-bg: #0f1320;
  --pg-note: #7aa2ff; --pg-note-surface: #101628; --pg-note-fg: #a9c0ff;
  --pg-tip: #3ddc84; --pg-tip-surface: #0c1a14; --pg-tip-fg: #7ce9ae;
  --pg-info: #4fd6ee; --pg-info-surface: #0b1a1e; --pg-info-fg: #8ae4f5;
  --pg-warning: #ffc857; --pg-warning-surface: #1c1710; --pg-warning-fg: #ffd888;
  --pg-danger: #ff5c8a; --pg-danger-surface: #1d1017; --pg-danger-fg: #ff92b1;
  --pg-example: #c08bff; --pg-example-surface: #16111f; --pg-example-fg: #d4b0ff;
  --pg-quote: #8f95a6; --pg-quote-surface: #12141d; --pg-quote-fg: #b3b8c4;
}
body { margin: 0; background: var(--pg-bg); color: var(--pg-fg); font-family: var(--pg-font); }
.app-header {
  display: flex; gap: 1.5rem; align-items: baseline;
  padding: 0.9rem 1.5rem; border-bottom: 1px solid var(--pg-line); background: var(--pg-bg-sunken);
}
.app-header b { color: var(--pg-accent); letter-spacing: 0.08em; text-transform: uppercase; }
.app-header a { color: var(--pg-muted); text-decoration: none; }
.app-layout { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 2rem; padding: 2rem 1.5rem; }
.app-side a { display: block; padding: 0.2rem 0; color: var(--pg-muted); text-decoration: none; font-size: 0.9rem; }
.app-side a[aria-current] { color: var(--pg-accent); }
.app-side strong { display: block; margin: 1rem 0 0.3rem; font-size: 0.75rem; letter-spacing: 0.08em; color: var(--pg-fg); }
@media (max-width: 700px) { .app-layout { grid-template-columns: minmax(0, 1fr); } }
`;
// --8<-- [end:theme]

// ---- pages ---------------------------------------------------------------------------------------
// --8<-- [start:layout]
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * An escaped attribute, built rather than written inline.
 *
 * Escaping a URL into an attribute is right anyway, and here it is also load-bearing for the page
 * you are reading this on: pagina rewrites every relative `href` and `src` in a rendered page, code
 * blocks included, and counts what it finds as an asset the article must carry. Spelling the
 * attribute out around a template placeholder would make this sample a missing asset the moment it
 * was quoted into a page. See docs/install.md.
 */
const attr = (name, value) => `${name}="${escape(value)}"`;
const href = (url) => attr("href", url);

/**
 * The manifest addresses pages *without* the base; the page fragments address them *with* it.
 *
 * `manifest.pages` is keyed `/`, `/theming/`, and `manifest.nav` matches, while the `href`s inside
 * `.rendered/pages/*.html` are already `/docs/theming/`. So a host converts in one direction only,
 * and these two helpers are the whole of it.
 */
const mounted = (href) => `${MOUNT}${href.slice(1)}`;
const unmounted = (path) => `/${path.slice(MOUNT.length)}`;

/** The article's nav, out of the manifest. */
function sidebar(current) {
  const link = (e) => `<a ${href(mounted(e.href))}${e.href === current ? " aria-current='page'" : ""}>${escape(e.title)}</a>`;
  return manifest.nav
    .map((e) => (e.children ? `<strong>${escape(e.title)}</strong>${e.children.map(link).join("")}` : link(e)))
    .join("");
}

/**
 * One host page: the application's chrome, the host's tokens, pagina's stylesheet, and the
 * fragment.
 *
 * `class="pg-content"` on the wrapper is the whole of what pagina's reading layer needs. The
 * fragment inside it is what `pagina build` would have written into its own shell, figures already
 * inlined as SVG.
 */
const layout = (page, current, fragment) => `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.title)} — Example Corp</title>
<link rel="stylesheet" href="/assets/pagina.css">
<style>${HOST_THEME}</style>
</head>
<body>
<header class="app-header">
  <b>Example Corp</b>
  <a href="/">Product</a><a ${href(MOUNT)}>Docs</a><a href="/admin/">Edit</a>
</header>
<div class="app-layout">
  <nav class="app-side">${sidebar(current)}</nav>
  <main>
    <article class="pg-content">${fragment}</article>
  </main>
</div>
</body></html>`;
// --8<-- [end:layout]

/** The editor, in the same application. Three lines of markup and an import map. */
// --8<-- [start:editor-page]
const editorPage = () => `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Editing — Example Corp</title>
<link rel="stylesheet" href="/assets/editor.css">
<style>${HOST_THEME}</style>
<script type="importmap">{"imports":{"kineglyph":"/assets/kineglyph.js"}}</script>
</head>
<body>
<header class="app-header"><b>Example Corp</b><a ${href(MOUNT)}>Back to the docs</a></header>
<pagina-editor backend-url="${API}" page="index.md" base="${MOUNT}" theme="dark"
               style="display:block;height:calc(100vh - 3.2rem)"></pagina-editor>
<script type="module">
  import { defineElement } from "/assets/editor.js";
  defineElement();
</script>
</body></html>`;
// --8<-- [end:editor-page]

const home = () => `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Example Corp</title><style>${HOST_THEME}</style></head>
<body><header class="app-header"><b>Example Corp</b><a ${href(MOUNT)}>Docs</a><a href="/admin/">Edit</a></header>
<div class="app-layout"><div></div><main><h1>The product</h1>
<p>A page that is not documentation, so you can see the header the docs inherit.
Its palette is the one in <code>HOST_THEME</code>, and pagina knows nothing about it.</p>
<p><a ${href(MOUNT)}>Read the docs →</a></p></main></div></body></html>`;

// ---- the server ------------------------------------------------------------------------------------
// --8<-- [start:server]
const edit = viteEditMiddleware(article, { base: API, siteBase: MOUNT });

const send = (res, status, type, body) => {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.end(body);
};

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  // The editor's HTTP contract first. It calls `next()` for anything that is not its own.
  edit(req, res, () => {
    void (async () => {
      try {
        const asset = ASSETS[path];
        if (asset) return send(res, 200, TYPES[extname(asset)] ?? "application/octet-stream", await readFile(asset));
        if (path === "/") return send(res, 200, TYPES[".html"], home());
        if (path === "/admin" || path === "/admin/") return send(res, 200, TYPES[".html"], editorPage());

        if (path.startsWith(MOUNT)) {
          // A page: the manifest is the router, addressed without the mount.
          const href = unmounted(path);
          const page = manifest.pages[href];
          if (page) {
            const fragment = await readFile(join(article, ".rendered/pages", `${pageSlug(href)}.html`), "utf8");
            return send(res, 200, TYPES[".html"], layout(page, href, fragment));
          }
          // Otherwise an asset of the article: media, a scene module, a figure SVG. These keep the
          // paths their pages already use, so the folder can be served flat under the mount.
          const rel = path.slice(MOUNT.length);
          if (rel && !rel.includes("..") && !rel.startsWith(".")) {
            const file = join(article, rel);
            if (file.startsWith(`${article}/`) && existsSync(file))
              return send(res, 200, TYPES[extname(file)] ?? "application/octet-stream", await readFile(file));
          }
        }
        send(res, 404, "text/plain; charset=utf-8", "not found");
      } catch (error) {
        send(res, 500, "text/plain; charset=utf-8", String(error?.stack ?? error));
      }
    })();
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`example host   http://127.0.0.1:${PORT}/`);
  console.log(`  docs         http://127.0.0.1:${PORT}${MOUNT}`);
  console.log(`  editor       http://127.0.0.1:${PORT}/admin/`);
});
// --8<-- [end:server]

/*
 * What this example does not cover, stated because finding it written down is more use than
 * discovering it:
 *
 *  - **No search, and no live figures.** Both are jobs of pagina's client bundle, which
 *    `pagina build` emits into `_pagina/` and which no package exports as a file. The figures here
 *    are the pre-rendered SVG, so they are visible, themed and readable with scripting off; they
 *    do not animate. A host that wants both runs `pagina build --base /docs/` as well and serves
 *    `_pagina/` from the same mount. `docs/search.md` documents the two attributes that switch
 *    search on.
 *  - **No authentication.** `viteEditMiddleware` authenticates nothing: mounting it as written
 *    lets anyone who can reach the port rewrite the folder. A real host checks a session before
 *    the request reaches `edit(req, res, next)`, and `<pagina-editor headers="…">` is where a CSRF
 *    token or an `Authorization` header goes.
 *  - **Nothing is cached.** Every request reads from disk. `.rendered/` is immutable for the life
 *    of a bundle, so a real host reads it once at boot or puts a normal cache in front.
 *  - **Editing does not re-render.** The editor writes markdown into `article/`; the pages served
 *    above come from `.rendered/`, which changes only when the editor's `POST /publish` runs. That
 *    payload is what a host stores; this example accepts it and drops it.
 */
