/**
 * The Kineglyph figure, as the author sees it while editing: the figure itself.
 *
 * A `figureKg` node carries a reference, not a picture — a module path, an inline module, or a
 * pre-rendered asset — so this view resolves the reference the same way the published page will and
 * mounts the result. A module is read out of the store rather than fetched, which is what makes the
 * figure update the instant the builder saves the scene, before anything has reached a server.
 *
 * The three affordances below the figure are deliberately different from each other. "Open in
 * builder" appears only for a module the builder wrote (`// pagina:spec`), because re-opening a
 * hand-authored scene in a form would mean throwing away everything the form cannot express.
 * "Edit source" is always there for a module or an inline scene, and it is the plain truth: the
 * module's text. "Remove" deletes the node.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { defaultTheme, mountKineglyph, type KineglyphController } from "kineglyph";
import { Code2, PencilRuler, Trash2 } from "lucide-react";
import { useArticleStore, useStoreRevision } from "../useStore.js";
import { useFigureBuilder, usePagePath } from "../context.js";
import { evaluateSceneModule, parseSpecFromModule, type SceneSource } from "../kineglyph.js";
import { relativePath, resolvePath } from "../paths.js";

const swallowKeys = (event: KeyboardEvent): void => event.stopPropagation();

const attrOf = (attrs: Record<string, unknown>, key: string): string =>
  typeof attrs[key] === "string" ? (attrs[key] as string) : "";

export function FigureKgView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps): ReactNode {
  const store = useArticleStore();
  const revision = useStoreRevision(store);
  const pagePath = usePagePath();
  const openBuilder = useFigureBuilder();

  const kind = attrOf(node.attrs, "kind") || "static";
  const sceneHref = attrOf(node.attrs, "scene");
  const inlineSource = attrOf(node.attrs, "source");
  const staticHref = attrOf(node.attrs, "static");
  const id = attrOf(node.attrs, "id");

  const stage = useRef<HTMLDivElement>(null);
  const controller = useRef<KineglyphController | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  /** The module text behind the figure — for the builder, the source editor, and the preview. */
  const [source, setSource] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const scenePath = sceneHref === "" ? undefined : resolvePath(pagePath, sceneHref);

  // The source of truth for a module figure is the store's mirror of the scene file, so an edit
  // made anywhere — this view, the builder, another tab — reaches the figure through one path.
  useEffect(() => {
    if (kind === "inline") {
      setSource(inlineSource);
      return;
    }
    if (kind !== "module" || scenePath === undefined) {
      setSource(undefined);
      return;
    }
    const mirrored = store.files.get(scenePath)?.text;
    if (mirrored !== undefined) {
      setSource(mirrored);
      return;
    }
    let cancelled = false;
    void store
      .open(scenePath)
      .then((file) => {
        if (!cancelled) setSource(file.text ?? "");
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSource(undefined);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, scenePath, inlineSource, store, revision]);

  // Mounting evaluates the module, which is a dynamic import: it can fail for a syntax error, a
  // missing export, or an import map that does not resolve `kineglyph`. Every one of those is the
  // author's business, so the message is shown rather than logged.
  useEffect(() => {
    const element = stage.current;
    if (element === null || source === undefined || source.trim() === "") return;
    let cancelled = false;
    controller.current?.destroy();
    controller.current = undefined;
    void evaluateSceneModule(source)
      .then((scene) => {
        if (cancelled || stage.current === null) return;
        if (scene === undefined || scene === null || typeof scene !== "object")
          throw new Error("the module's default export is not a scene");
        controller.current = mountKineglyph(stage.current, { scene: scene as SceneSource, theme: defaultTheme });
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(
    () => () => {
      controller.current?.destroy();
      controller.current = undefined;
    },
    [],
  );

  const spec = source === undefined ? null : parseSpecFromModule(source);

  const remove = useCallback((): void => {
    const pos = getPos();
    if (pos === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  }, [editor, getPos, node.nodeSize]);

  const saveSource = (): void => {
    if (kind === "inline") updateAttributes({ source: draft });
    else if (scenePath !== undefined) store.setText(scenePath, draft);
    setSource(draft);
    setEditing(false);
  };

  const build = (): void => {
    if (openBuilder === undefined) return;
    openBuilder({
      ...(spec === null ? {} : { spec }),
      ...(scenePath === undefined ? {} : { scenePath }),
      onSave: (savedPath, savedSpec) => {
        updateAttributes({ kind: "module", scene: relativePath(pagePath, savedPath), id: savedSpec.id, source: null });
      },
    });
  };

  return (
    <NodeViewWrapper className="pge-card pge-figure" contentEditable={false} onKeyDown={swallowKeys}>
      <div className="pge-card__head">
        <span className="pge-card__badge">figure</span>
        <span className="pge-card__title">{id === "" ? (sceneHref === "" ? "(no scene)" : sceneHref) : id}</span>
        <span className="pge-card__spacer" />
        {spec === null || openBuilder === undefined ? null : (
          <button type="button" className="pge-btn pge-btn--sm" onClick={build}>
            <PencilRuler size={14} aria-hidden="true" /> Open in builder
          </button>
        )}
        {kind === "static" ? null : (
          <button
            type="button"
            className="pge-btn pge-btn--sm"
            aria-pressed={editing}
            onClick={() => {
              setDraft(source ?? "");
              setEditing((v) => !v);
            }}
          >
            <Code2 size={14} aria-hidden="true" /> Edit source
          </button>
        )}
        <button type="button" className="pge-icon" title="Remove figure" aria-label="Remove figure" onClick={remove}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      {kind === "static" ? (
        staticHref === "" ? (
          <p className="pge-card__note">No static asset.</p>
        ) : (
          <img className="pge-figure__static" src={staticHref} alt={id === "" ? "figure" : id} />
        )
      ) : (
        <div className="pge-figure__stage" ref={stage} />
      )}

      {error === undefined ? null : <p className="pge-card__error">{error}</p>}

      {editing ? (
        <div className="pge-figure__source">
          <textarea
            className="pge-textarea"
            rows={Math.min(Math.max(draft.split("\n").length + 1, 6), 24)}
            spellCheck={false}
            value={draft}
            aria-label="Scene module source"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="pge-figure__actions">
            <button type="button" className="pge-btn pge-btn--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="pge-btn pge-btn--sm pge-btn--primary" onClick={saveSource}>
              Save
            </button>
          </div>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
