/**
 * The right pane: the page as the site will render it.
 *
 * `@pagina/core` is pure, so the preview is the *real* renderer running in the browser over the
 * store's mirror — unsaved text included — not an approximation and not a server round trip. The
 * result goes into a `.pg-content` container so the site's own stylesheet lays it out exactly as it
 * will on the page, and Kineglyph figures are then hydrated by the same `mountAll` the shell uses.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
// Must stay a bare specifier: the host page's import map (and `@pagina/vite`'s dev alias) points it
// at the one runtime instance the site itself uses, and the editor bundle keeps it external.
import { mountAll, type EmbeddedFigure } from "kineglyph";
import type { ArticleStore } from "../store/index.js";
import { useStoreRevision } from "./useStore.js";

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
  const root = useRef<HTMLDivElement>(null);
  const figures = useRef<EmbeddedFigure[]>([]);

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

  // Hydration runs after every paint of new HTML. The previous controllers own DOM that React has
  // just replaced, so they are destroyed first — otherwise each render leaks a running figure.
  useEffect(() => {
    const container = root.current;
    if (container === null) return;
    for (const figure of figures.current) figure.controller.destroy();
    figures.current = [];
    let cancelled = false;
    void mountAll({ root: container })
      .then((mounted) => {
        if (cancelled) for (const figure of mounted) figure.controller.destroy();
        else figures.current = mounted;
      })
      .catch((e: unknown) => {
        console.warn("pagina: preview figures failed to mount", e);
      });
    return () => {
      cancelled = true;
    };
  }, [html]);

  useEffect(
    () => () => {
      for (const figure of figures.current) figure.controller.destroy();
      figures.current = [];
    },
    [],
  );

  return (
    <div className="pge-pane pge-pane--preview">
      <div className="pge-pane__head">
        <span className="pge-pane__title">Preview</span>
        <span className="pge-pane__path">{path}</span>
      </div>
      {error === undefined ? null : <p className="pge-preview__error">{error}</p>}
      <div className="pge-preview">
        <div className="pg-content" ref={root} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
