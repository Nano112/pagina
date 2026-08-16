/**
 * The three-pane shell: pages | document | preview.
 *
 * The panes are a CSS grid whose middle/right split is one draggable handle, stored as a fraction
 * so the layout survives a window resize; the preview can also be folded away entirely, which is
 * what the grid's `data-preview` attribute switches on. Nothing here talks to a backend — the whole
 * app has exactly one dependency, the {@link ArticleStore} it is handed.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ArticleStore } from "../store/index.js";
import { EditorPane, usePageEditor } from "./Editor.js";
import { Preview } from "./Preview.js";
import { Sidebar } from "./Sidebar.js";
import { StatusBar } from "./StatusBar.js";
import { Toolbar } from "./Toolbar.js";
import { StoreProvider } from "./useStore.js";

/** Fraction of the pane area the preview takes; clamped so neither side can be dragged away. */
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.7;

export interface AppProps {
  readonly store: ArticleStore;
  /** The page to open first. */
  readonly page: string;
  /** Lets a host outside React drive `open(path)` — `mountEditor`'s handle uses this. */
  readonly onReady?: ((open: (path: string) => void) => void) | undefined;
}

export function App({ store, page, onReady }: AppProps): ReactNode {
  const [path, setPath] = useState(page);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [showPreview, setShowPreview] = useState(true);
  const [split, setSplit] = useState(0.42);
  const panes = useRef<HTMLDivElement>(null);
  const { editor, save } = usePageEditor(store, path);

  useEffect(() => {
    let cancelled = false;
    void store
      .load()
      .then(() => {
        if (!cancelled) setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  useEffect(() => setPath(page), [page]);
  useEffect(() => onReady?.(setPath), [onReady]);

  // Cmd/Ctrl-S is the one shortcut the shell owns; everything else belongs to the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [save]);

  const startDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const area = panes.current;
    if (area === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = area.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      const fraction = (box.right - ev.clientX) / box.width;
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, fraction)));
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }, []);

  return (
    <StoreProvider value={store}>
      <div className="pge-app" data-preview={showPreview ? "" : undefined}>
        <div className="pge-bar">
          <Toolbar editor={editor} store={store} />
          <button
            type="button"
            className="pge-btn pge-btn--sm pge-bar__preview"
            aria-pressed={showPreview}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>

        {loadError === undefined ? null : <p className="pge-fatal">Could not load the article: {loadError}</p>}

        <div
          className="pge-panes"
          ref={panes}
          style={{ ["--pge-split" as string]: showPreview ? `${(split * 100).toFixed(2)}%` : "0%" }}
        >
          <Sidebar store={store} current={path} onOpen={setPath} />
          <EditorPane editor={editor} />
          {showPreview ? (
            <>
              <div
                className="pge-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize preview"
                onPointerDown={startDrag}
              />
              {loaded ? <Preview store={store} path={path} /> : <div className="pge-pane pge-pane--preview" />}
            </>
          ) : null}
        </div>

        <StatusBar store={store} path={path} onSave={() => void save()} />
      </div>
    </StoreProvider>
  );
}
