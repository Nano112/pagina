/**
 * The editor as a *host application* sees it: built assets, served flat, over a plain Node
 * server. No Vite anywhere in the browser.
 *
 * This exists because every other check in this repo goes through `pagina dev`, and Vite's dev
 * pipeline hides a whole class of bundle defect — it defines `process.env.NODE_ENV`, polyfills
 * CJS interop, and rewrites bare specifiers, so a bundle that cannot survive on its own still
 * works there. The Laravel package (`packages/pagina-laravel` in schemati) publishes
 * `editor.js`, `editor.css` and `@kineglyph/web`'s `dist/` into `public/vendor/pagina/` and links
 * them from a Blade view; this page is that view's shape, down to the import map and the
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
/** The cover-less copy, and its own contract mount: `og-cards.spec.ts` publishes *this* one. */
const CARDS_ARTICLE = resolve(here, ".tmp/cards-article");
const CARDS_API = "/api/articles/cards";
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
  // The font social cards are set in. It sits beside `editor.js` because that is where the bundle
  // looks for it — a card is rasterised through an `<img>`, which cannot fetch anything, so the
  // bytes have to be inlined into the SVG and therefore fetched by the editor first.
  "/vendor/pagina/pagina-card-font.ttf": resolve(repo, "packages/editor/dist/pagina-card-font.ttf"),
  // The theming showcase and the theme lab, served as `tools/build-docs-site.sh` publishes them:
  // five plain-`tsc` ESM modules that find each other by relative specifier. `e2e/theme-lab.spec.ts`
  // drives them over the *built* site, because "a figure re-tints with the page" is a claim about
  // pre-rendered inline SVG in a real artefact and jsdom has no opinion on it.
  "/vendor/pagina/theming/index.js": resolve(repo, "packages/shell-static/dist/theming/index.js"),
  "/vendor/pagina/theming/lab.js": resolve(repo, "packages/shell-static/dist/theming/lab.js"),
  "/vendor/pagina/theming/showcase.js": resolve(repo, "packages/shell-static/dist/theming/showcase.js"),
  "/vendor/pagina/theming/identities.js": resolve(repo, "packages/shell-static/dist/theming/identities.js"),
  "/vendor/pagina/theming/catalogue.js": resolve(repo, "packages/shell-static/dist/theming/catalogue.js"),
  "/vendor/pagina/pagina.css": resolve(repo, "packages/shell-static/dist/pagina.css"),
  "/vendor/pagina/pagina.tokens.css": resolve(repo, "packages/shell-static/dist/pagina.tokens.css"),
  "/vendor/pagina/kineglyph-web.js": resolve(
    require_.resolve("@kineglyph/web/package.json"),
    "../dist/kineglyph-web.js",
  ),
};

/**
 * `@kineglyph/web`'s `dist/`, because since 0.3.0 the runtime is a *directory*, not a file.
 *
 * Up to 0.2.0 `dist/kineglyph-web.js` was self-contained apart from one `import()` of the lab
 * editor, which never fired on a page with no lab. 0.3.0 splits a shared `rolldown-runtime-*.js`
 * out of it and imports that *statically*, on the first line — so a host that copies the one file
 * a host used to copy serves a module whose very first import 404s. The import map's `kineglyph`
 * entry then fails to load, `RenderedHtml` never resolves it, and `<pagina-editor>` sits in the
 * DOM with no `.ProseMirror` in it, silently, with nothing in the network log but one missing
 * script. That is what the 0.2.0 → 0.3.0 bump did to sixteen specs here.
 *
 * The fix is to stop treating the runtime as a single artefact: a host publishes the whole `dist/`
 * (see `docs/design/2026-08-19-kineglyph-runtime-is-a-directory.md`). Serving it flat under the
 * same `/vendor/pagina/` prefix is what `sync-assets.sh` copying the folder produces, and it needs
 * no knowledge of which chunks a given release happens to emit — the hashes change every time.
 */
const KINEGLYPH_DIST = resolve(require_.resolve("@kineglyph/web/package.json"), "../dist");
const VENDOR = "/vendor/pagina/";

const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".png": "image/png",
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
const page = (api = API, cardFontUrl = undefined) => `<!doctype html>
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
<pagina-editor data-editor backend-url="${api}" page="" base="/" theme="light"${cardFontUrl === undefined ? "" : ` card-font-url="${cardFontUrl}"`}></pagina-editor>
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

/**
 * The built figures page with the theming showcase and the theme lab bolted onto it.
 *
 * The page is the artefact `buildStatic` wrote — its own stylesheet link, its own pre-rendered
 * inline-SVG figure, its own client bundle — because both claims under test are about a real
 * published page. The lab's is "everything follows at once, including a diagram"; the showcase's is
 * "the CSS printed under a frame is the CSS the frame is wearing". Neither survives being tested
 * against a hand-written approximation of a page.
 *
 * `autoMount` reads the stylesheet URLs off the page's own `<link>`, so nothing here has to be told
 * where the site's assets are — which is the same thing that makes it work at `/pagina/` on GitHub
 * Pages and at `/` on a domain root.
 */
async function siteWithTheming(rel) {
  const html = await readFile(resolve(SITE, rel), "utf8");
  return html.replace(
    "</body>",
    `<div data-pg-theme-showcase></div>
<div data-pg-theme-lab></div>
<script type="module">
  import { autoMount } from "/vendor/pagina/theming/index.js";
  window.__paginaTheming = autoMount();
</script>
</body>`,
  );
}

const HOST_PAGES = {
  "/demo": () => demoPage(),
  "/theming": () => siteWithTheming("guide/figures/index.html"),
  "/site-dark": () => siteUnderHostTheme("index.html"),
  // A sub-page of the same article, same host, same palette — the proof that the hero is the
  // *article's* and not every page's. It is a route rather than an assertion on `/site-dark`
  // because "absent" is only convincing next to a picture of where it is present.
  "/site-dark-sub": () => siteUnderHostTheme("guide/tabs/index.html"),
  // The cover-less article, open in the editor: what `og-cards.spec.ts` publishes.
  "/cards-edit": () => page(CARDS_API),
  // The same editor, pointed at a font that is not there. Publishing must still succeed: a picture
  // that did not render is never allowed to cost an author their work.
  "/cards-edit-no-font": () => page(CARDS_API, "/vendor/pagina/not-a-font.ttf"),
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
const editCards = viteEditMiddleware(CARDS_ARTICLE, { base: CARDS_API, siteBase: "/" });

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  edit(req, res, () => { editCards(req, res, () => {
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
      // A chunk of the Kineglyph runtime, beside it, exactly as a host that published the folder
      // would serve it. Flat only — a `/` in the remainder is not a file this directory holds.
      if (path.startsWith(VENDOR) && !path.slice(VENDOR.length).includes("/")) {
        const file = resolve(KINEGLYPH_DIST, path.slice(VENDOR.length));
        if (file.startsWith(`${KINEGLYPH_DIST}/`)) {
          try {
            const bytes = await readFile(file);
            res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
            res.end(bytes);
            return;
          } catch { /* not a runtime chunk either — fall through to the 404 below */ }
        }
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
          } catch { /* fall through to the site's own 404 */ }
        }
        // What GitHub Pages does with an address that matches nothing: the site's `404.html`, under
        // a 404 status, from whatever depth was asked for. It is the only way the page is ever
        // actually served, and the only way a relative URL on it would be caught.
        try {
          const bytes = await readFile(resolve(root, "404.html"));
          res.statusCode = 404;
          res.setHeader("content-type", TYPES[".html"]);
          res.end(bytes);
          return;
        } catch { /* fall through to the bare 404 below */ }
      }
      res.statusCode = 404;
      res.end("not found");
    })();
  }); });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`static host on http://127.0.0.1:${PORT}/edit`);
});
