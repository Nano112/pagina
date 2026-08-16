import { relative, resolve } from "node:path";
import type MarkdownIt from "markdown-it";
import { createServer, type ViteDevServer } from "vite";
import { parseArticleConfig, renderArticle, type RenderedArticle } from "@pagina/core";
import { NodeContentFs } from "./node-fs.js";
import { kineglyphRoot, resolveKineglyphBundle } from "./kineglyph.js";
import { loadKineglyphThemes, prerenderFigures, type KineglyphThemes } from "./prerender.js";
import type { Shell } from "./build.js";

export interface DevServerOptions {
  readonly folder: string;
  readonly shell: Shell;
  readonly port?: number;
  readonly base?: string;
  readonly md?: MarkdownIt;
}

const FIGURE_URL = /\/_pagina\/figures\/[^/]+\/(.+)\.(light|dark)\.svg$/;

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

  return createServer({
    configFile: false,
    root: folder,
    base,
    logLevel: "info",
    appType: "custom",
    server: {
      ...(o.port === undefined ? {} : { port: o.port }),
      fs: { allow: [folder, kineglyphRoot(), resolve(o.shell.clientEntry, "..")] },
      watch: { ignored: ["**/node_modules/**"] },
    },
    resolve: { conditions: ["development"], alias: { kineglyph: kgWebEntry } },
    optimizeDeps: { exclude: ["@kineglyph/plot", "@kineglyph/svg"] },
    plugins: [{
      name: "pagina-dev",
      configureServer(s) {
        const contentFs = new NodeContentFs(folder);
        let article: Promise<RenderedArticle> | undefined;
        let themes: Promise<{ themes: KineglyphThemes; width?: number }> | undefined;
        const figCache = new Map<string, { theme: string; svg: string }[]>();
        const getArticle = (): Promise<RenderedArticle> =>
          (article ??= renderArticle({ fs: contentFs, strict: false, base, ...(o.md === undefined ? {} : { md: o.md }) }));
        const getThemes = (): Promise<{ themes: KineglyphThemes; width?: number }> =>
          (themes ??= (async () => {
            const cfg = parseArticleConfig(await contentFs.read("article.yaml"));
            return { themes: await loadKineglyphThemes(folder, cfg), ...(cfg.kineglyph?.width === undefined ? {} : { width: cfg.kineglyph.width }) };
          })());

        /** Pre-renders exactly one figure (both themes) and caches it. */
        const renderFigure = async (id: string): Promise<{ theme: string; svg: string }[] | undefined> => {
          const cached = figCache.get(id);
          if (cached !== undefined) return cached;
          const a = await getArticle();
          const meta = a.manifest.figures[id];
          const page = meta === undefined ? undefined : a.pages[meta.page];
          const fig = page?.figures.find((f) => f.id === id);
          if (page === undefined || fig === undefined || fig.kind === "static") return undefined;
          const t = await getThemes();
          const one: RenderedArticle = { ...a, pages: { [page.href]: { ...page, figures: [fig] } } };
          const results = (await prerenderFigures(one, folder, t.themes, t.width, base)).get(id);
          if (results !== undefined) figCache.set(id, results);
          return results;
        };

        s.watcher.add(folder);
        s.watcher.on("all", (_event, file) => {
          if (!file.startsWith(folder)) return;
          const rel = relative(folder, file).split("\\").join("/");
          if (rel.endsWith(".mjs") || rel.endsWith(".js")) {
            figCache.clear();
            s.ws.send({ type: "custom", event: "kineglyph:update", data: { url: `${base.replace(/\/$/, "")}/${rel}` } });
            return;
          }
          article = undefined;
          themes = undefined;
          figCache.clear();
          s.ws.send({ type: "full-reload" });
        });

        s.middlewares.use((req, res, next) => {
          void (async () => {
            try {
              if (req.method !== "GET" && req.method !== "HEAD") return next();
              const path = new URL(req.url ?? "/", "http://localhost").pathname;

              if (path.startsWith(`${base.replace(/\/$/, "")}/_pagina/figures/`)) {
                const m = FIGURE_URL.exec(path);
                if (m === null) return next();
                const svg = (await renderFigure(m[1]!))?.find((r) => r.theme === m[2])?.svg;
                if (svg === undefined) return next();
                res.setHeader("content-type", "image/svg+xml");
                res.end(svg);
                return;
              }

              if (!(req.headers.accept ?? "").includes("text/html")) return next();
              const a = await getArticle();
              const rest = path.startsWith(base) ? `/${path.slice(base.length)}` : path;
              const href = rest.endsWith("/") ? rest : `${rest}/`;
              if (a.pages[href] === undefined) return next();
              const pages = await o.shell.render(a, {
                base,
                dev: true,
                clientUrl: `/@fs${o.shell.clientEntry}`,
                cssUrl: `/@fs${resolve(o.shell.clientEntry, "../pagina.css")}`,
                kineglyphRuntimeUrl: `/@fs${kgWebEntry}`,
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
