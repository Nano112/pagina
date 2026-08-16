/**
 * `@pagina/editor` — the WYSIWYG editor for pagina's markdown dialect.
 *
 * The headless document model (schema + markdown parser/serializer) lives behind the `./model`
 * subpath and the optimistic store behind `./store`, so either can be used without pulling in any
 * UI. This entry is what a host page loads: it is the *distribution* surface — `PaginaEditor`,
 * `mountEditor` and `defineElement` — and `pagina dev --edit` serves a page that imports exactly
 * these three names.
 *
 * The bodies below are a placeholder: the real editor UI lands in `src/ui` (task B4a) and replaces
 * their internals without changing the names, so the dev-server host page keeps working across
 * that change.
 */
export * from "./model/index.js";

/** Options `mountEditor` takes; the custom element derives them from its attributes. */
export interface EditorOptions {
  /** Where the article HTTP contract is mounted, e.g. `/__pagina/edit`. */
  readonly backendUrl?: string;
  /** Folder-relative markdown path to open, e.g. `guide/tabs.md`. */
  readonly page?: string;
  /** The site's base path. */
  readonly base?: string;
}

/** What a mounted editor hands back to its host. */
export interface EditorHandle {
  destroy(): void;
}

/**
 * Mounts the editor into `el`. Placeholder: renders a loading notice so a host page can be
 * verified end to end before the UI exists.
 */
export function mountEditor(el: HTMLElement, options: EditorOptions = {}): EditorHandle {
  el.textContent = "editor loading…";
  el.setAttribute("data-pagina-editor-page", options.page ?? "index.md");
  return { destroy: () => { el.textContent = ""; } };
}

/** The `<pagina-editor>` custom element. Attributes: `backend-url`, `page`, `base`. */
export class PaginaEditor extends HTMLElement {
  #handle: EditorHandle | undefined;

  connectedCallback(): void {
    const attr = (name: string): string | undefined => this.getAttribute(name) ?? undefined;
    this.#handle = mountEditor(this, {
      ...(attr("backend-url") === undefined ? {} : { backendUrl: attr("backend-url")! }),
      ...(attr("page") === undefined ? {} : { page: attr("page")! }),
      ...(attr("base") === undefined ? {} : { base: attr("base")! }),
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
  customElements.define(tag, PaginaEditor);
}
