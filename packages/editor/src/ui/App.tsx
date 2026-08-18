/**
 * The three-pane shell: pages | document | preview.
 *
 * Both splits are draggable {@link Splitter}s stored as numbers here, so the layout survives a
 * window resize and — for the sidebar, which an author sets once and wants kept — a reload. The
 * preview can also be folded away entirely, which is what the grid's `data-preview` attribute
 * switches on. Nothing here talks to a backend — the whole app has exactly one dependency, the
 * {@link ArticleStore} it is handed.
 *
 * Below the layout's breakpoint the sidebar is not narrow, it is *gone*: three panes do not fit on
 * a phone and squeezing them there helps nobody. What replaces it is a floating control that opens
 * the same `<Sidebar>` in a modal, because "the file list is hidden and there is no other way to
 * reach it" meant switching pages, creating one and uploading were all simply unavailable on a
 * phone — the demo page had to say so in prose.
 *
 * It also owns the three things a node view cannot reach on its own — which page is open, where the
 * `<model-viewer>` module lives, and how to raise the figure builder — and publishes them as
 * context; it owns uploads, because a file may arrive from the toolbar, from a drop or from a
 * paste, and all three end in the same place; and it owns publishing, which is the one command that
 * takes the author out of the editor entirely (see {@link PublishedView}).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { kineglyphThemeHref } from "@pagina/core";
import type { RenderedArticle } from "@pagina/core";
import { PanelLeft, Send } from "lucide-react";
import type { ArticleStore } from "../store/index.js";
import { EditorPane, usePageEditor } from "./Editor.js";
import { FigureBuilder } from "./FigureBuilder.js";
import { Preview } from "./Preview.js";
import { PublishedView } from "./PublishedView.js";
import { Sidebar } from "./Sidebar.js";
import { SlashMenu } from "./SlashMenu.js";
import { Splitter } from "./Splitter.js";
import { StatusBar, type StatusNotice } from "./StatusBar.js";
import { Toolbar } from "./Toolbar.js";
import { StoreProvider } from "./useStore.js";
import { useDialog } from "./useDialog.js";
import { publishArticle } from "./publish.js";
import {
  ConfigProvider, DEFAULT_MODEL_VIEWER_URL, FigureBuilderProvider, NoticeProvider, PagePathProvider,
  type EditorNotice, type FigureBuilderRequest,
} from "./context.js";
import { loadSidebarWidth, saveSidebarWidth, SIDEBAR_MAX, SIDEBAR_MIN } from "./layout.js";
import { uploadAndInsert } from "./uploads.js";

/** Fraction of the pane area the preview takes; clamped so neither side can be dragged away. */
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.7;

/** Below this *editor* width the three panes stop fitting and the layout stacks into one column. */
const COMPACT_WIDTH = 900;

export interface AppProps {
  readonly store: ArticleStore;
  /** The page to open first. */
  readonly page: string;
  /** Lets a host outside React drive `open(path)` — `mountEditor`'s handle uses this. */
  readonly onReady?: ((open: (path: string) => void) => void) | undefined;
  /** Where `<model-viewer>` is loaded from; the host may self-host it. */
  readonly modelViewerUrl?: string | undefined;
}

/** The pages list in a modal, for the widths at which the sidebar is not on screen. */
function PagesDialog({ store, current, onOpen, onClose }: {
  readonly store: ArticleStore;
  readonly current: string;
  readonly onOpen: (path: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const ref = useDialog(onClose);
  return (
    <div className="pge-modal pge-modal--pages" role="dialog" aria-modal="true" aria-label="Pages and files" ref={ref}>
      <div className="pge-modal__panel pge-modal__panel--pages">
        <header className="pge-modal__head">
          <h2 className="pge-modal__title">Pages</h2>
          <span className="pge-modal__spacer" />
          <button type="button" className="pge-btn pge-btn--sm" onClick={onClose}>
            Close
          </button>
        </header>
        <Sidebar
          store={store}
          current={current}
          onOpen={(path) => {
            onOpen(path);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

export function App({ store, page, onReady, modelViewerUrl = DEFAULT_MODEL_VIEWER_URL }: AppProps): ReactNode {
  const [path, setPath] = useState(page);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [showPreview, setShowPreview] = useState(true);
  const [split, setSplit] = useState(0.42);
  const [sidebar, setSidebar] = useState(loadSidebarWidth);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [builder, setBuilder] = useState<FigureBuilderRequest | undefined>(undefined);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ article: RenderedArticle; publishedAt: string } | undefined>(undefined);
  /** The shell's line in the status bar: an upload in flight, or a command that declined to run. */
  const [said, setSaid] = useState<StatusNotice | undefined>(undefined);
  const [compact, setCompact] = useState(false);
  const app = useRef<HTMLDivElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { editor, save, serializeError } = usePageEditor(store, path);

  /**
   * The layout follows the editor's own width, not the window's.
   *
   * This is a component, not a page. A media query asks how wide the *viewport* is, which is the
   * wrong question the moment the editor is embedded in something narrower than it: pagina's docs
   * demo is a 656 px frame in a 1180 px page, and the three-pane layout there gave the document
   * about a hundred pixels — one word per line — while every media query in the sheet reported a
   * comfortable desktop. A container query would be the CSS answer, but `container-type` brings
   * layout containment with it, and that makes `.pge-app` the containing block for `position:
   * fixed` — which would put the slash menu, positioned from ProseMirror's *viewport* coordinates,
   * somewhere else entirely. A `ResizeObserver` asks the same question with none of that.
   */
  useLayoutEffect(() => {
    const element = app.current;
    if (element === null) return;
    // Measured once, synchronously, before the browser paints: the observer's first delivery is a
    // frame away, and a three-pane layout that flashes and then collapses is worse than one that
    // never appeared. It is also the whole answer where a `ResizeObserver` never delivers at all —
    // a throttled or offscreen frame, an environment without one — so the layout is never left
    // wrong, only slightly stale.
    setCompact(element.clientWidth < COMPACT_WIDTH);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setCompact((entry?.contentRect.width ?? element.clientWidth) < COMPACT_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
  useEffect(() => saveSidebarWidth(sidebar), [sidebar]);

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

  /**
   * Publish: save first, render everything here in the browser, then *show* the result.
   *
   * The save is not a nicety — publishing renders the store's mirror, and an author who presses
   * Publish inside the serialize debounce would otherwise publish the document as it was four
   * hundred milliseconds ago.
   */
  const publish = useCallback((): void => {
    setPublishing(true);
    setSaid({ kind: "info", text: "Publishing — rendering every page and figure…" });
    void (async () => {
      try {
        await save();
        const result = await publishArticle(store);
        setPublished({ article: result.article, publishedAt: result.publishedAt });
        setSaid(undefined);
      } catch (e) {
        setSaid({ kind: "error", text: `Publish failed: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        setPublishing(false);
      }
    })();
  }, [store, save]);

  const pickFile = useCallback(() => fileInput.current?.click(), []);
  const openBuilder = useCallback((request: FigureBuilderRequest) => setBuilder(request), []);
  const notify = useCallback((notice: EditorNotice) => setSaid(notice), []);

  /** The sidebar grows rightwards from the pane area's left edge; the preview leftwards from its right. */
  const measureSidebar = useCallback(({ clientX }: { clientX: number }): number => {
    const box = panes.current?.getBoundingClientRect();
    return box === undefined ? SIDEBAR_MIN : clientX - box.left;
  }, []);
  const measureSplit = useCallback(({ clientX }: { clientX: number }): number => {
    const box = panes.current?.getBoundingClientRect();
    return box === undefined ? MIN_SPLIT * 100 : ((box.right - clientX) / box.width) * 100;
  }, []);

  // A failed serialize outranks an upload note: one is a warning, the other is work not being saved.
  const notice: StatusNotice | undefined =
    serializeError === undefined ? said : { kind: "error", text: `Couldn't serialize this page — ${serializeError}` };

  const themeUrl = store.article === undefined ? undefined : kineglyphThemeHref(store.article, store.base);

  if (published !== undefined) {
    return (
      <div className="pge-app pge-app--published">
        <PublishedView
          article={published.article}
          path={path}
          publishedAt={published.publishedAt}
          themeUrl={themeUrl}
          onBack={() => setPublished(undefined)}
        />
      </div>
    );
  }

  return (
    <StoreProvider value={store}>
      <ConfigProvider value={{ modelViewerUrl }}>
        <PagePathProvider value={path}>
          <FigureBuilderProvider value={openBuilder}>
            <NoticeProvider value={notify}>
            <div
              className="pge-app"
              ref={app}
              data-preview={showPreview ? "" : undefined}
              data-compact={compact ? "" : undefined}
            >
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
                <button
                  type="button"
                  className="pge-btn pge-btn--sm pge-btn--primary pge-bar__publish"
                  disabled={publishing || !loaded}
                  onClick={publish}
                  title="Render every page and figure here, ship them, and read the result"
                >
                  <Send size={13} aria-hidden="true" /> {publishing ? "Publishing…" : "Publish"}
                </button>
              </div>

              {loadError === undefined ? null : <p className="pge-fatal">Could not load the article: {loadError}</p>}

              <div
                className="pge-panes"
                ref={panes}
                style={{
                  ["--pge-sidebar" as string]: `${String(Math.round(sidebar))}px`,
                  ["--pge-split" as string]: showPreview ? `${(split * 100).toFixed(2)}%` : "0%",
                }}
              >
                <Sidebar store={store} current={path} onOpen={setPath} />
                <Splitter
                  className="pge-handle pge-handle--sidebar"
                  label="Resize the pages sidebar"
                  value={sidebar}
                  min={SIDEBAR_MIN}
                  max={SIDEBAR_MAX}
                  step={16}
                  onChange={setSidebar}
                  measure={measureSidebar}
                />
                <EditorPane editor={editor} onFiles={takeFiles}>
                  <SlashMenu editor={editor} store={store} onPickFile={pickFile} />
                </EditorPane>
                {showPreview ? (
                  <>
                    <Splitter
                      label="Resize the preview"
                      value={split * 100}
                      min={MIN_SPLIT * 100}
                      max={MAX_SPLIT * 100}
                      step={2}
                      decimals={1}
                      onChange={(percent) => setSplit(percent / 100)}
                      measure={measureSplit}
                    />
                    {loaded ? <Preview store={store} path={path} /> : <div className="pge-pane pge-pane--preview" />}
                  </>
                ) : null}
              </div>

              <button
                type="button"
                className="pge-pages-fab"
                onClick={() => setPagesOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={pagesOpen}
              >
                <PanelLeft size={15} aria-hidden="true" /> Pages
              </button>

              {pagesOpen ? (
                <PagesDialog store={store} current={path} onOpen={setPath} onClose={() => setPagesOpen(false)} />
              ) : null}

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
