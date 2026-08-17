/**
 * `@pagina/editor` — the WYSIWYG editor for pagina's markdown dialect.
 *
 * The headless document model (schema + markdown parser/serializer) lives behind the `./model`
 * subpath and the optimistic store behind `./store`, so either can be used without pulling in any
 * UI. This entry is what a host page loads: the *distribution* surface, in the three shapes the
 * design calls for — `PaginaEditor` (React), `mountEditor` (imperative), and `defineElement`
 * (a custom element, which is what makes Blade/Livewire and `pagina dev --edit` trivial).
 *
 * `dist/editor.js` bundles React; `kineglyph` stays external and is resolved by the host page's
 * import map, so a figure in the preview runs on the same runtime instance the site uses.
 */
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./ui/App.js";
import { publishArticle } from "./ui/publish.js";
import { ArticleStore, HttpBackend, type ArticleBackend } from "./store/index.js";

export * from "./model/index.js";
export * from "./store/index.js";
export {
  publishArticle, renderArticleFigures, loadFigureThemes, DEFAULT_FIGURE_WIDTH, type RenderedFigures,
  type FigureThemes, type FigureSvgs,
} from "./ui/publish.js";

/** Options `mountEditor` takes; the custom element derives them from its attributes. */
export interface EditorOptions {
  /** An already-built backend. Wins over `backendUrl`; how tests and embedders inject their own. */
  readonly backend?: ArticleBackend;
  /** Where the article HTTP contract is mounted, e.g. `/__pagina/edit`. */
  readonly backendUrl?: string;
  /** Sent on every backend request — CSRF tokens, `Authorization`, … */
  readonly headers?: Readonly<Record<string, string>>;
  /** Folder-relative markdown path to open, e.g. `guide/tabs.md`. */
  readonly page?: string;
  /** The site's base path. */
  readonly base?: string;
  /** Forces the colour scheme instead of following the host document's `data-theme`. */
  readonly theme?: "light" | "dark";
  /**
   * Where `<model-viewer>` is loaded from. Defaults to Google's CDN; a site that self-hosts the
   * element, or pins a different version, points this at its own copy.
   */
  readonly modelViewerUrl?: string;
}

/** What a mounted editor hands back to its host. */
export interface EditorHandle {
  /** The store the UI is bound to — the supported way to script a mounted editor. */
  readonly store: ArticleStore;
  destroy(): void;
  /** Opens another page in the editor pane. */
  open(path: string): void;
  /**
   * Renders the whole article — pages *and* every figure, to light+dark SVG in the browser — and
   * ships it through the backend's publish endpoint.
   */
  publish(): Promise<{ publishedAt: string }>;
}

export interface PaginaEditorProps {
  readonly store: ArticleStore;
  /** The page to open first. Defaults to `index.md`. */
  readonly page?: string;
  readonly theme?: "light" | "dark";
  /** Receives an `open(path)` callback once the app is mounted. */
  readonly onReady?: (open: (path: string) => void) => void;
  /** See {@link EditorOptions.modelViewerUrl}. */
  readonly modelViewerUrl?: string;
}

/** The editor as a React component, for hosts that already have a React tree. */
export function PaginaEditor({ store, page = "index.md", theme, onReady, modelViewerUrl }: PaginaEditorProps): ReactNode {
  if (theme !== undefined && typeof document !== "undefined") document.documentElement.dataset["theme"] = theme;
  return createElement(App, { store, page, onReady, modelViewerUrl });
}

const DEFAULT_BACKEND_URL = "/__pagina/edit";

function backendFor(options: EditorOptions): ArticleBackend {
  if (options.backend !== undefined) return options.backend;
  return new HttpBackend({
    baseUrl: options.backendUrl ?? DEFAULT_BACKEND_URL,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
}

/**
 * Mounts the editor into `el` and returns a handle.
 *
 * The store is created here rather than by the caller so the common case is one call, and it is
 * exposed on the handle so the uncommon case — scripting the editor, or sharing the store with a
 * surrounding app — does not need a second entry point.
 */
export function mountEditor(el: HTMLElement, options: EditorOptions = {}): EditorHandle {
  const store = new ArticleStore(backendFor(options), {
    ...(options.base === undefined ? {} : { base: options.base }),
  });
  if (options.theme !== undefined) document.documentElement.dataset["theme"] = options.theme;

  // `open` is only usable once React has mounted; until then it queues the last path asked for.
  let open: ((path: string) => void) | undefined;
  let queued: string | undefined;
  const onReady = (fn: (path: string) => void): void => {
    open = fn;
    if (queued !== undefined) {
      fn(queued);
      queued = undefined;
    }
  };

  const root: Root = createRoot(el);
  root.render(
    createElement(App, {
      store,
      page: options.page ?? "index.md",
      onReady,
      ...(options.modelViewerUrl === undefined ? {} : { modelViewerUrl: options.modelViewerUrl }),
    }),
  );

  return {
    store,
    destroy(): void {
      // React refuses to unmount synchronously from inside a lifecycle callback, and
      // `disconnectedCallback` is exactly that; deferring one microtask keeps both happy.
      queueMicrotask(() => root.unmount());
      store.destroy();
    },
    open(path: string): void {
      if (open === undefined) queued = path;
      else open(path);
    },
    publish(): Promise<{ publishedAt: string }> {
      // Renders every module/inline figure to light+dark SVG on the host page's Kineglyph runtime
      // before shipping, so a published page shows its diagrams without running any JavaScript.
      return publishArticle(store);
    },
  };
}

/**
 * `<pagina-editor>`: the editor as a custom element.
 *
 * Attributes: `backend-url`, `page`, `base`, `theme`, `model-viewer-url`, and `headers` (a JSON
 * object). The mounted
 * store is exposed as `.store` and publishing as `.publish()`, so a Blade or Livewire page can
 * drive the editor without importing anything.
 */
export class PaginaEditorElement extends HTMLElement {
  #handle: EditorHandle | undefined;

  /** The mounted store, or `undefined` before `connectedCallback`. */
  get store(): ArticleStore | undefined {
    return this.#handle?.store;
  }

  open(path: string): void {
    this.#handle?.open(path);
  }

  async publish(): Promise<{ publishedAt: string }> {
    if (this.#handle === undefined) throw new Error("pagina: <pagina-editor> is not mounted");
    return await this.#handle.publish();
  }

  connectedCallback(): void {
    if (this.#handle !== undefined) return;
    /**
     * An **empty** attribute means "not set", not "the empty string".
     *
     * A host templates these (`page="{{ $page }}"`, `headers="{{ $json }}"`), and a template that
     * has nothing to say renders `""` rather than omitting the attribute — that is normal Blade,
     * normal Blade-alikes, and normal JSX. Reading `""` as a value meant `page=""` opened the path
     * `""`, which the backend answered with its *file listing*, and the author got a JSON dump
     * where their article should be. Every default below is now reachable the way its documentation
     * says it is.
     */
    const attr = (name: string): string | undefined => {
      const value = this.getAttribute(name);
      return value === null || value.trim() === "" ? undefined : value;
    };
    const theme = attr("theme");
    let headers: Record<string, string> | undefined;
    const raw = attr("headers");
    if (raw !== undefined) {
      try {
        headers = JSON.parse(raw) as Record<string, string>;
      } catch {
        console.warn("pagina: <pagina-editor headers> is not valid JSON; ignoring it");
      }
    }
    this.#handle = mountEditor(this, {
      ...(attr("backend-url") === undefined ? {} : { backendUrl: attr("backend-url")! }),
      ...(attr("page") === undefined ? {} : { page: attr("page")! }),
      ...(attr("base") === undefined ? {} : { base: attr("base")! }),
      ...(attr("model-viewer-url") === undefined ? {} : { modelViewerUrl: attr("model-viewer-url")! }),
      ...(theme === "light" || theme === "dark" ? { theme } : {}),
      ...(headers === undefined ? {} : { headers }),
    });
  }

  disconnectedCallback(): void {
    this.#handle?.destroy();
    this.#handle = undefined;
  }
}

/** Registers `<pagina-editor>`. Safe to call more than once, and a no-op outside a browser. */
export function defineElement(tag = "pagina-editor"): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get(tag) !== undefined) return;
  customElements.define(tag, PaginaEditorElement);
}
