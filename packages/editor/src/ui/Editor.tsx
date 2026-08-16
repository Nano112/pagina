/**
 * The centre pane: a TipTap editor bound to one markdown file.
 *
 * The binding is a loop with a deliberate cut in it. Opening a file parses its markdown into a
 * document; editing serializes the document back and hands the text to the store; the store then
 * emits `change` for that file — including for the very edit we just made. Re-parsing that echo
 * would blow away the selection on every keystroke, so `lastText` remembers the exact text this
 * pane last wrote and an incoming `change` carrying it is ignored. Anything else (a conflict
 * resolved to "theirs", another tab, a file changed on disk) *is* adopted.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from "@tiptap/react";
import type { AnyExtension, Extensions } from "@tiptap/core";
import { editorExtensions } from "../model/schema.js";
import { parseMarkdown } from "../model/parser.js";
import { serializeMarkdown } from "../model/serializer.js";
import type { ArticleStore } from "../store/index.js";
import {
  AdmonitionView, FigureImageView, FigureKgView, HtmlBlockView, ModelViewerView, SnippetView, TabView, TabsView,
} from "./nodeviews.js";

/** How long the editor sits still before its text is handed to the store. */
const SERIALIZE_DEBOUNCE_MS = 400;

const NODE_VIEWS = {
  tabs: TabsView,
  tab: TabView,
  admonition: AdmonitionView,
  snippet: SnippetView,
  figureKg: FigureKgView,
  figureImage: FigureImageView,
  modelViewer: ModelViewerView,
  htmlBlock: HtmlBlockView,
} as const;

/**
 * The document model's extensions with a React node view attached to each custom node.
 *
 * The views are added here rather than in `src/model` on purpose: the model layer is DOM-free and
 * runs in Node (the serializer round-trip tests import it), so it must not reach for React.
 */
function uiExtensions(): Extensions {
  return editorExtensions().map((extension) => {
    const view = NODE_VIEWS[extension.name as keyof typeof NODE_VIEWS] as
      | (typeof NODE_VIEWS)[keyof typeof NODE_VIEWS]
      | undefined;
    if (view === undefined) return extension;
    return (extension as AnyExtension).extend({ addNodeView: () => ReactNodeViewRenderer(view) });
  });
}

export interface PageEditor {
  /** `null` until TipTap has built the view. */
  readonly editor: Editor | null;
  /** Serializes now (if an edit is pending) and writes every dirty file. Bound to Cmd/Ctrl-S. */
  readonly save: () => Promise<void>;
  /**
   * Why the last serialize failed, if it did.
   *
   * A throwing serializer is the one failure the store cannot see: the text never reaches it, so it
   * reports "Saved" over a document whose edits are going nowhere. The message goes to the status
   * bar instead, and the pending write is kept — the next successful serialize writes it.
   */
  readonly serializeError: string | undefined;
}

/**
 * Binds a TipTap editor to `path` in `store`. Lives in a hook rather than in the pane component so
 * the toolbar and the keyboard shortcuts can reach the same editor instance without prop drilling
 * a ref through the layout.
 */
export function usePageEditor(store: ArticleStore, path: string): PageEditor {
  /** Front matter is not part of the ProseMirror document; it is carried across the round trip. */
  const frontMatter = useRef<string | undefined>(undefined);
  const [serializeError, setSerializeError] = useState<string | undefined>(undefined);
  /** One console line per distinct failure, not one per keystroke while the document stays broken. */
  const loggedError = useRef<string | undefined>(undefined);
  /** The last text *this pane* wrote to the store — the echo guard. */
  const lastText = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The pending serialize+write, so it can be forced on save or when the pane switches files. */
  const pending = useRef<(() => void) | undefined>(undefined);
  /** True while `setContent` runs, so the resulting `update` is not mistaken for an author edit. */
  const applying = useRef(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  const flushPending = useCallback((): void => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    const run = pending.current;
    pending.current = undefined;
    run?.();
  }, []);

  const editor = useEditor(
    {
      extensions: uiExtensions(),
      content: "",
      immediatelyRender: false,
      editorProps: { attributes: { class: "pge-doc pg-content", spellcheck: "true" } },
      onUpdate: ({ editor: instance }) => {
        if (applying.current) return;
        const target = pathRef.current;
        const write = (): void => {
          const fm = frontMatter.current;
          let text: string;
          try {
            text = serializeMarkdown(instance.state.doc, fm === undefined ? {} : { frontMatter: fm });
          } catch (e) {
            // The write is *not* dropped: it is put back, so the next debounce — or a Cmd-S once
            // the document is repaired — retries it, and the author keeps typing meanwhile.
            pending.current = write;
            const message = e instanceof Error ? e.message : String(e);
            setSerializeError(message);
            if (loggedError.current !== message) {
              loggedError.current = message;
              console.error("pagina: could not serialize the page", e);
            }
            return;
          }
          setSerializeError(undefined);
          loggedError.current = undefined;
          lastText.current = text;
          store.setText(target, text);
        };
        pending.current = write;
        if (timer.current !== undefined) clearTimeout(timer.current);
        timer.current = setTimeout(flushPending, SERIALIZE_DEBOUNCE_MS);
      },
    },
    [store],
  );

  const applyText = useCallback(
    (instance: Editor, text: string): void => {
      const parsed = parseMarkdown(text);
      frontMatter.current = parsed.frontMatter;
      lastText.current = text;
      applying.current = true;
      try {
        instance.commands.setContent(parsed.doc.toJSON(), { emitUpdate: false });
      } finally {
        applying.current = false;
      }
    },
    [],
  );

  // Open the file. The cleanup writes any pending edit against the *old* path first, so switching
  // pages inside the debounce window cannot drop the last keystrokes.
  useEffect(() => {
    if (editor === null) return;
    let cancelled = false;
    void store
      .open(path)
      .then((file) => {
        if (!cancelled) applyText(editor, file.text ?? "");
      })
      .catch(() => {
        if (!cancelled) applyText(editor, "");
      });
    return () => {
      cancelled = true;
      flushPending();
    };
  }, [editor, store, path, applyText, flushPending]);

  // Adopt changes that did not come from this pane.
  useEffect(() => {
    if (editor === null) return;
    return store.on("change", (changed) => {
      if (changed !== path) return;
      const text = store.files.get(path)?.text;
      if (text === undefined || text === lastText.current) return;
      applyText(editor, text);
    });
  }, [editor, store, path, applyText]);

  const save = useCallback(async (): Promise<void> => {
    flushPending();
    await store.flush();
  }, [store, flushPending]);

  return { editor, save, serializeError };
}

export interface EditorPaneProps {
  readonly editor: Editor | null;
  /**
   * Files dropped on or pasted into the pane. Handled here rather than through TipTap's own
   * `handleDrop`/`handlePaste` because an upload is asynchronous and a ProseMirror handler must
   * decide synchronously whether it consumed the event; taking the files first and inserting when
   * the upload resolves is the honest shape.
   */
  readonly onFiles?: ((files: readonly File[]) => void) | undefined;
  /** The slash menu, which has to be positioned against this pane. */
  readonly children?: ReactNode;
}

/** The editable surface. Kept dumb: everything stateful is in {@link usePageEditor}. */
export function EditorPane({ editor, onFiles, children }: EditorPaneProps): ReactNode {
  const take = (files: FileList | null | undefined): boolean => {
    const list = files === null || files === undefined ? [] : [...files];
    if (list.length === 0 || onFiles === undefined) return false;
    onFiles(list);
    return true;
  };

  return (
    <div
      className="pge-pane pge-pane--editor"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (take(e.dataTransfer.files)) e.preventDefault();
      }}
      onPaste={(e) => {
        if (take(e.clipboardData.files)) e.preventDefault();
      }}
    >
      <EditorContent editor={editor} className="pge-editor" />
      {children}
    </div>
  );
}
