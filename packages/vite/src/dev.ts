import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type MarkdownIt from "markdown-it";
import { createServer, type ViteDevServer } from "vite";
import { SEARCH_INDEX_PATH, buildSearchIndex, inlineArticleFigures, parseArticleConfig, renderArticle, serializeSearchIndex, type DrawnFigure, type RenderedArticle, type Shell, type ThemeLevel } from "@pagina/core";
import { NodeContentFs } from "./node-fs.js";
import { kineglyphRoot, resolveKineglyphBundle } from "./kineglyph.js";
import { drawnFigure, figureWidths, loadKineglyphThemes, prerenderFigures, type KineglyphThemes, type PrerenderedFigure } from "./prerender.js";
import { viteEditMiddleware, type EditWatcher } from "./edit-middleware.js";
import { pagePathForHref, renderEditPage } from "./edit-page.js";

export interface DevServerOptions {
  readonly folder: string;
  readonly shell: Shell;
  readonly port?: number;
  readonly base?: string;
  readonly md?: MarkdownIt;
  /** Interface to bind. Defaults to loopback only (`"127.0.0.1"`); pass `true` to bind
   *  all interfaces (e.g. so a reverse proxy reaching the host over a bridge network, such as
   *  gerrymander's, can see the port). */
  readonly host?: string | boolean;
  /** Host-header allowlist for Vite's DNS-rebinding protection. Defaults to `[".test",
   *  "localhost", "127.0.0.1"]`, which covers gerrymander-style `*.test` dev proxies without
   *  disabling the check entirely; pass `true` only if you understand the tradeoff. */
  readonly allowedHosts?: readonly string[] | true;
  /** Serve the editor: the HTTP contract at `/__pagina/edit` and the host page at `/__edit/`.
   *  Off by default — it makes the folder writable over HTTP, so it is opt-in per run. */
  readonly edit?: boolean;
  /** How much pagina CSS the pages link: `"full"` (default), `"tokens"` or `"none"`. */
  readonly theme?: ThemeLevel;
  /** Render pagina's own header row. Default `true`; `false` when a host supplies chrome. */
  readonly chrome?: boolean;
  /** Absolute origin the site will be served from, overriding `article.yaml`'s `site_url`. Only
   *  affects the SEO tags — the dev server itself is always loopback. */
  readonly siteUrl?: string;
  /** Absolute URL of the deployment this one mirrors, so canonical/`og:url` can be previewed as
   *  they will be published rather than only seen after a deploy. */
  readonly mirrorOf?: string;
}

const FIGURE_URL = /\/_pagina\/figures\/[^/]+\/(.+)\.(light|dark)\.svg$/;

/** Where the HTTP contract is mounted in the dev server, per the connectivity spec. */
const EDIT_API_BASE = "/__pagina/edit";
/** Where the editor host page lives. Base-independent: it is dev chrome, not part of the site. */
const EDIT_PAGE_BASE = "/__edit";

/**
 * The `@pagina/editor` package directory, so the dev server can serve its source through
 * `/@fs`. In this repo (and in any consumer that has it installed) it sits next to `@pagina/vite`
 * either as a sibling package or as a `node_modules` entry; a built consumer would point at
 * `dist/editor.js` instead, which is why the entry is resolved separately below.
 */
function resolveEditorRoot(): string | undefined {
  return resolvePaginaPackage("editor");
}

/**
 * A sibling `@pagina/*` package's directory, the same three ways the editor is found.
 *
 * `@pagina/core` needs one too, and for a reason that is easy to miss: the client bundle imports
 * the search runtime from `@pagina/core`, whose `development` condition resolves to
 * `packages/core/src/index.ts` — a file outside every path in `server.fs.allow` below. In a build
 * that is Rollup's problem and it never asks; in dev it is a 403 on a module the page needs.
 */
function resolvePaginaPackage(name: string): string | undefined {
  const here = resolve(fileURLToPath(import.meta.url), "..");
  const candidates = [
    resolve(here, `../../${name}`),          // packages/vite/{src,dist} → packages/<name>
    resolve(here, `../node_modules/@pagina/${name}`),
    resolve(process.cwd(), `node_modules/@pagina/${name}`),
  ];
  return candidates.find((dir) => existsSync(resolve(dir, "package.json")));
}

/**
 * Kineglyph is consumed from a linked checkout, so its packages are TypeScript sources
 * outside `node_modules`. Vite's dep optimizer must not try to pre-bundle any of them —
 * excluding only some leaves the rest half-optimised and duplicated at runtime.
 */
const KINEGLYPH_PACKAGES = [
  "@kineglyph/core", "@kineglyph/svg", "@kineglyph/anime", "@kineglyph/plot",
  "@kineglyph/scenes", "@kineglyph/web", "@kineglyph/web/bundle", "@kineglyph/export",
];

/**
 * A Vite dev server for an article folder. The caller owns the lifecycle
 * (`await server.listen()` / `await server.close()`).
 *
 * Pages are rendered on demand through the shell and passed through
 * `transformIndexHtml`; figures are pre-rendered lazily, per figure, on first request and
 * cached until a scene module changes. Scene modules are served by Vite from the folder
 * root, with the bare `kineglyph` specifier aliased to `@kineglyph/web/bundle` source.
 */
export async function createDevServer(o: DevServerOptions): Promise<ViteDevServer> {
  const base = o.base ?? "/";
  const folder = resolve(o.folder);
  const kgWebEntry = resolveKineglyphBundle("development");
  const editorRoot = o.edit === true ? resolveEditorRoot() : undefined;
  const coreRoot = resolvePaginaPackage("core");

  /** The folder-relative posix path of `file`, or `undefined` if it is outside the folder.
   *  A plain `startsWith(folder)` would also match a sibling like `<folder>-backup/x.mjs`. */
  const inFolder = (file: string): string | undefined => {
    const rel = relative(folder, resolve(file));
    if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
    return rel.split("\\").join("/");
  };

  return createServer({
    configFile: false,
    root: folder,
    base,
    logLevel: "info",
    appType: "custom",
    server: {
      // Loopback-only and a narrow Host-header allowlist by default: DNS-rebinding protection
      // stays on for every consumer of this library. A caller fronting the server with a
      // reverse proxy that reaches the host over a bridge network (e.g. gerrymander's, via
      // `host.docker.internal`) opts into a wider bind/allowlist explicitly via `host`/
      // `allowedHosts` rather than getting it by default.
      host: o.host ?? "127.0.0.1",
      allowedHosts: o.allowedHosts === true ? true : [...(o.allowedHosts ?? [".test", "localhost", "127.0.0.1"])],
      ...(o.port === undefined ? {} : { port: o.port }),
      fs: {
        allow: [folder, kineglyphRoot(), resolve(o.shell.clientEntry, ".."),
          ...(coreRoot === undefined ? [] : [coreRoot]),
          ...(editorRoot === undefined ? [] : [editorRoot])],
      },
      watch: { ignored: ["**/node_modules/**"] },
    },
    resolve: { conditions: ["development"], alias: { kineglyph: kgWebEntry } },
    optimizeDeps: {
      exclude: [...KINEGLYPH_PACKAGES],
      /**
       * Where the dependency crawl starts, stated rather than discovered.
       *
       * `root` is the *article* folder and `appType` is `custom`, so Vite's default entry crawl —
       * every `.html` under the root — finds nothing at all. Dependency discovery therefore
       * happened lazily, on the first module request from the first page load, and the
       * re-optimization that followed answered the requests already in flight with
       * `504 (Outdated Optimize Dep)`. The browser recovers by reloading, which is why this was
       * invisible by hand and why the very first end-to-end spec failed the moment there was CI
       * to run it on a cold `node_modules/.vite`.
       *
       * Naming the two real entries — the page shell's client, and the editor when it is being
       * served — moves the whole optimize pass to startup, before anything can be in flight. It
       * also means a human's first page load is not the one that pays for it.
       */
      entries: [o.shell.clientEntry, ...(editorRoot === undefined ? [] : [resolve(editorRoot, "src/index.ts")])],
    },
    plugins: [{
      name: "pagina-dev",
      // Scene modules are hot-swapped entirely through the `kineglyph:update` custom event
      // dispatched from the `watcher.on("all")` handler below. Without this hook, Vite's own
      // default HMR propagation for the same file change finds no `import.meta.hot.accept()`
      // boundary in the dynamic-import chain and falls back to a full page reload — which
      // would both duplicate the update and defeat the point of hot-swapping.
      handleHotUpdate(ctx) {
        const rel = inFolder(ctx.file);
        if (rel === undefined) return;
        if (rel.endsWith(".mjs") || rel.endsWith(".js")) return [];
      },
      configureServer(s) {
        const contentFs = new NodeContentFs(folder);
        let article: Promise<RenderedArticle> | undefined;
        let themes: Promise<{ themes: KineglyphThemes; widths: readonly number[] }> | undefined;
        const figCache = new Map<string, PrerenderedFigure[]>();
        const getArticle = (): Promise<RenderedArticle> =>
          (article ??= renderArticle({ fs: contentFs, strict: false, base, ...(o.md === undefined ? {} : { md: o.md }), ...(o.siteUrl === undefined ? {} : { siteUrl: o.siteUrl }) }));
        const getThemes = (): Promise<{ themes: KineglyphThemes; widths: readonly number[] }> =>
          (themes ??= (async () => {
            const cfg = parseArticleConfig(await contentFs.read("article.yaml"));
            return { themes: await loadKineglyphThemes(folder, cfg), widths: figureWidths(cfg) };
          })());

        /**
         * Pre-renders exactly one figure (both themes) and caches it. A figure that fails
         * to render is logged and reported as "not there": the request 404s, the static
         * `<img>` simply does not load, and the client runtime still hydrates the figure.
         */
        const renderFigure = async (id: string): Promise<PrerenderedFigure[] | undefined> => {
          const cached = figCache.get(id);
          if (cached !== undefined) return cached;
          const a = await getArticle();
          const meta = a.manifest.figures[id];
          const page = meta === undefined ? undefined : a.pages[meta.page];
          const fig = page?.figures.find((f) => f.id === id);
          if (page === undefined || fig === undefined || fig.kind === "static") return undefined;
          const t = await getThemes();
          const one: RenderedArticle = { ...a, pages: { [page.href]: { ...page, figures: [fig] } } };
          const { figures, diagnostics } = await prerenderFigures(one, folder, t.themes, t.widths, base);
          for (const d of diagnostics) s.config.logger.error(`[pagina] ${d.code}: ${d.message}`);
          const results = figures.get(id);
          if (results !== undefined) figCache.set(id, results);
          return results;
        };

        // Mounted first so a `PUT /__pagina/edit/files/...` never reaches the page middleware,
        // and so Vite's own static/transform middlewares never see the contract's routes.
        if (o.edit === true) {
          s.middlewares.use(viteEditMiddleware(folder, {
            base: EDIT_API_BASE,
            siteBase: base,
            watcher: s.watcher as unknown as EditWatcher,
          }));
        }

        s.watcher.add(folder);
        s.watcher.on("all", (_event, file) => {
          const rel = inFolder(file);
          if (rel === undefined) return;
          if (rel.endsWith(".mjs") || rel.endsWith(".js")) {
            // A scene module may be the theme module too, so drop the memoised themes with it.
            themes = undefined;
            figCache.clear();
            // A hot-swap costs nobody their work, so it goes out for every change including the
            // editor's own — saving a scene from the figure builder is exactly when the figure
            // should be refreshed.
            s.ws.send({ type: "custom", event: "kineglyph:update", data: { url: `${base.replace(/\/$/, "")}/${rel}` } });
            return;
          }
          article = undefined;
          themes = undefined;
          figCache.clear();
          // Broadcast to every client, always. A `full-reload` is right for a reader's tab and
          // wrong for exactly one client — `/__edit/`, whose own save caused this — and the
          // server cannot tell the sockets apart. That decision is made where the identity is:
          // the editor page drops a reload that lands inside its own write window
          // (`SELF_WRITE_GUARD` in `edit-page.ts`). Suppressing it here would silence every other
          // tab too.
          s.ws.send({ type: "full-reload" });
        });

        s.middlewares.use((req, res, next) => {
          void (async () => {
            try {
              if (req.method !== "GET" && req.method !== "HEAD") return next();
              const path = new URL(req.url ?? "/", "http://localhost").pathname;

              if (o.edit === true && (path === EDIT_PAGE_BASE || path.startsWith(`${EDIT_PAGE_BASE}/`))) {
                if (editorRoot === undefined) {
                  res.statusCode = 500;
                  res.setHeader("content-type", "text/plain; charset=utf-8");
                  res.end("pagina: --edit needs @pagina/editor installed next to @pagina/vite");
                  return;
                }
                const themeCss = resolve(editorRoot, "src/ui/theme.css");
                const html = await s.transformIndexHtml(path, renderEditPage({
                  backendUrl: EDIT_API_BASE,
                  page: pagePathForHref(path.slice(EDIT_PAGE_BASE.length)),
                  base,
                  kineglyphRuntimeUrl: `/@fs${kgWebEntry}`,
                  editorEntryUrl: `/@fs${resolve(editorRoot, "src/index.ts")}`,
                  siteCssUrl: `/@fs${resolve(o.shell.clientEntry, "../pagina.css")}`,
                  ...(existsSync(themeCss) ? { editorCssUrl: `/@fs${themeCss}` } : {}),
                }));
                res.setHeader("content-type", "text/html");
                res.end(html);
                return;
              }

              if (path === `${base.replace(/\/$/, "")}/${SEARCH_INDEX_PATH}`) {
                // Every figure, not the current page's: the index covers the article, and a
                // diagram's `<title>`/`<desc>` is only in the HTML once the figure is inlined. On
                // a big article the first search of a session therefore waits for the figures it
                // has not drawn yet — once, and only if someone searches. A build pays this cost
                // anyway, and a dev server that indexed less than a build would be a dev server
                // that hides the difference.
                const a = await getArticle();
                const drawn = new Map<string, DrawnFigure>();
                for (const page of Object.values(a.pages)) {
                  for (const fig of page.figures) {
                    if (fig.kind === "static") continue;
                    const d = drawnFigure(await renderFigure(fig.id));
                    if (d !== undefined) drawn.set(fig.id, d);
                  }
                }
                const withFigures = inlineArticleFigures(a, (id) => drawn.get(id)).article;
                res.setHeader("content-type", "application/json; charset=utf-8");
                // Never cached in dev: the article behind it changes on every save.
                res.setHeader("cache-control", "no-store");
                res.end(serializeSearchIndex(buildSearchIndex(withFigures)));
                return;
              }

              if (path.startsWith(`${base.replace(/\/$/, "")}/_pagina/figures/`)) {
                const m = FIGURE_URL.exec(path);
                if (m === null) return next();
                const svg = (await renderFigure(m[1]!))?.find((r) => r.theme === m[2])?.svg;
                if (svg === undefined) {
                  res.statusCode = 404;
                  res.end();
                  return;
                }
                res.setHeader("content-type", "image/svg+xml");
                res.end(svg);
                return;
              }

              if (!(req.headers.accept ?? "").includes("text/html")) return next();
              const a = await getArticle();
              const rest = path.startsWith(base) ? `/${path.slice(base.length)}` : path;
              // `/guide/figures/index.html` addresses the same page as `/guide/figures/`.
              const href = rest.endsWith("/index.html") ? rest.slice(0, -"index.html".length)
                : rest.endsWith("/") ? rest : `${rest}/`;
              const requested = a.pages[href];
              if (requested === undefined) return next();
              // Figures are inlined into the page here as they are in a build, so dev shows the
              // same document a reader gets — themed by the host's CSS, and legible with the
              // runtime turned off. Only this page's figures are rendered, and each is cached.
              const rendered = new Map<string, DrawnFigure>();
              for (const fig of requested.figures) {
                if (fig.kind === "static") continue;
                const drawn = drawnFigure(await renderFigure(fig.id));
                if (drawn !== undefined) rendered.set(fig.id, drawn);
              }
              const withFigures = inlineArticleFigures(a, (id) => rendered.get(id)).article;
              // The tokens the figures above were drawn with, so the page paints them the same way.
              const declaredTheme = a.manifest.article.kineglyph?.theme === undefined ? undefined : (await getThemes()).themes;
              const pages = await o.shell.render(withFigures, {
                base,
                dev: true,
                edit: o.edit === true,
                clientUrl: `/@fs${o.shell.clientEntry}`,
                cssUrl: `/@fs${resolve(o.shell.clientEntry, "../pagina.css")}`,
                tokensCssUrl: `/@fs${resolve(o.shell.clientEntry, "../tokens.css")}`,
                kineglyphRuntimeUrl: `/@fs${kgWebEntry}`,
                searchUrl: `${base.replace(/\/$/, "")}/${SEARCH_INDEX_PATH}`,
                ...(o.theme === undefined ? {} : { theme: o.theme }),
                ...(o.chrome === undefined ? {} : { chrome: o.chrome }),
                ...(o.siteUrl === undefined ? {} : { siteUrl: o.siteUrl }),
                ...(o.mirrorOf === undefined ? {} : { mirrorOf: o.mirrorOf }),
                ...(declaredTheme === undefined ? {} : { kineglyphTheme: declaredTheme }),
              });
              const rel = href === "/" ? "index.html" : `${href.replace(/^\/|\/$/g, "")}/index.html`;
              const html = await s.transformIndexHtml(path, String(pages[rel] ?? ""));
              res.setHeader("content-type", "text/html");
              res.end(html);
            } catch (error) {
              next(error);
            }
          })();
        });
      },
    }],
  });
}
