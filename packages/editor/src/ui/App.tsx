/**
 * The three-pane shell: pages | document | preview.
 *
 * The panes are a CSS grid whose middle/right split is one draggable handle, stored as a fraction
 * so the layout survives a window resize; the preview can also be folded away entirely, which is
 * what the grid's `data-preview` attribute switches on. Nothing here talks to a backend — the whole
 * app has exactly one dependency, the {@link ArticleStore} it is handed.
 *
 * It also owns the three things a node view cannot reach on its own — which page is open, where the
 * `<model-viewer>` module lives, and how to raise the figure builder — and publishes them as
 * context; and it owns uploads, because a file may arrive from the toolbar, from a drop or from a
 * paste, and all three end in the same place.
 */
import {
  useCallback, useEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import type { ArticleStore } from "../store/index.js";
import { EditorPane, usePageEditor } from "./Editor.js";
import { FigureBuilder } from "./FigureBuilder.js";
import { Preview } from "./Preview.js";
import { Sidebar } from "./Sidebar.js";
import { SlashMenu } from "./SlashMenu.js";
import { StatusBar, type StatusNotice } from "./StatusBar.js";
import { Toolbar } from "./Toolbar.js";
import { StoreProvider } from "./useStore.js";
import {
  ConfigProvider, DEFAULT_MODEL_VIEWER_URL, FigureBuilderProvider, NoticeProvider, PagePathProvider,
  type EditorNotice, type FigureBuilderRequest,
} from "./context.js";
import { uploadAndInsert } from "./uploads.js";

/** Fraction of the pane area the preview takes; clamped so neither side can be dragged away. */
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.7;

export interface AppProps {
  readonly store: ArticleStore;
  /** The page to open first. */
  readonly page: string;
  /** Lets a host outside React drive `open(path)` — `mountEditor`'s handle uses this. */
  readonly onReady?: ((open: (path: string) => void) => void) | undefined;
  /** Where `<model-viewer>` is loaded from; the host may self-host it. */
  readonly modelViewerUrl?: string | undefined;
}

export function App({ store, page, onReady, modelViewerUrl = DEFAULT_MODEL_VIEWER_URL }: AppProps): ReactNode {
  const [path, setPath] = useState(page);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [showPreview, setShowPreview] = useState(true);
  const [split, setSplit] = useState(0.42);
  const [builder, setBuilder] = useState<FigureBuilderRequest | undefined>(undefined);
  /** The shell's line in the status bar: an upload in flight, or a command that declined to run. */
  const [said, setSaid] = useState<StatusNotice | undefined>(undefined);
  const panes = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { editor, save, serializeError } = usePageEditor(store, path);

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

  /** Uploads in order, so several dropped files land in the document in the order they were shown. */
  const takeFiles = useCallback(
    (files: readonly File[]): void => {
      if (editor === null || files.length === 0) return;
      setSaid({ kind: "info", text: files.length === 1 ? `Uploading ${files[0]!.name}…` : `Uploading ${files.length} files…` });
      void (async () => {
        try {
          for (const file of files) await uploadAndInsert(editor, store, file, path);
          setSaid({ kind: "info", text: files.length === 1 ? `Uploaded ${files[0]!.name}` : `Uploaded ${files.length} files` });
        } catch (e) {
          setSaid({ kind: "error", text: `Upload failed: ${e instanceof Error ? e.message : String(e)}` });
        }
      })();
    },
    [editor, store, path],
  );

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

  const pickFile = useCallback(() => fileInput.current?.click(), []);
  const openBuilder = useCallback((request: FigureBuilderRequest) => setBuilder(request), []);
  const notify = useCallback((notice: EditorNotice) => setSaid(notice), []);

  // A failed serialize outranks an upload note: one is a warning, the other is work not being saved.
  const notice: StatusNotice | undefined =
    serializeError === undefined ? said : { kind: "error", text: `Couldn't serialize this page — ${serializeError}` };

  return (
    <StoreProvider value={store}>
      <ConfigProvider value={{ modelViewerUrl }}>
        <PagePathProvider value={path}>
          <FigureBuilderProvider value={openBuilder}>
            <NoticeProvider value={notify}>
            <div className="pge-app" data-preview={showPreview ? "" : undefined}>
              <div className="pge-bar">
                <Toolbar editor={editor} store={store} onPickFile={pickFile} />
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
                <EditorPane editor={editor} onFiles={takeFiles}>
                  <SlashMenu editor={editor} store={store} onPickFile={pickFile} />
                </EditorPane>
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

              <StatusBar store={store} path={path} onSave={() => void save()} notice={notice} />

              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  takeFiles(files);
                }}
              />

              {builder === undefined ? null : (
                <FigureBuilder store={store} request={builder} onClose={() => setBuilder(undefined)} />
              )}
            </div>
            </NoticeProvider>
          </FigureBuilderProvider>
        </PagePathProvider>
      </ConfigProvider>
    </StoreProvider>
  );
}
