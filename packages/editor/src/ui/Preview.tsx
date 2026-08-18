/**
 * The right pane: the page as the site will render it.
 *
 * `@pagina/core` is pure, so the preview is the *real* renderer running in the browser over the
 * store's mirror — unsaved text included — not an approximation and not a server round trip. What
 * that HTML then needs in order to behave like a page (figures hydrated on the article's theme,
 * tab groups that respond to a click) is {@link RenderedHtml}'s job, shared with the published
 * view, because both are core's output in a browser and both used to get it wrong differently.
 */
import { useEffect, useState, type ReactNode } from "react";
import { kineglyphThemeHref } from "@pagina/core";
import type { ArticleStore } from "../store/index.js";
import { useStoreRevision } from "./useStore.js";
import { RenderedHtml } from "./RenderedHtml.js";

/** Quiet period after an edit before the page is re-rendered. */
const RENDER_DEBOUNCE_MS = 300;

export interface PreviewProps {
  readonly store: ArticleStore;
  readonly path: string;
}

export function Preview({ store, path }: PreviewProps): ReactNode {
  // Any store event may change what this page renders to — its own text, a snippet it includes, or
  // `article.yaml` — so the preview simply follows the store's revision.
  const revision = useStoreRevision(store);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  // The article's declared theme, re-read whenever `article.yaml` changes — editing the `kineglyph:`
  // block is exactly when a preview must stop showing the old colours.
  const themeUrl = store.article === undefined ? undefined : kineglyphThemeHref(store.article, store.base);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void store
        .render(path)
        .then((page) => {
          if (cancelled) return;
          setHtml(page.html);
          setError(undefined);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
        });
    }, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [store, path, revision]);

  return (
    <div className="pge-pane pge-pane--preview">
      <div className="pge-pane__head">
        <span className="pge-pane__title">Preview</span>
        <span className="pge-pane__path">{path}</span>
      </div>
      {error === undefined ? null : <p className="pge-preview__error">{error}</p>}
      <div className="pge-preview">
        <RenderedHtml html={html} themeUrl={themeUrl} />
      </div>
    </div>
  );
}
