/**
 * React node views for the dialect's custom nodes.
 *
 * Each one edits the node's *attributes* through a small form and leaves the node's content to
 * ProseMirror via `NodeViewContent`, so nothing here has to know how the markdown is written —
 * that stays the serializer's job. Atoms (`snippet`, `figureKg`, `figureImage`, `modelViewer`,
 * `htmlBlock`) have no content and are marked `contentEditable={false}`, which is also what keeps
 * their form controls usable: without it the browser would treat an `<input>` inside the editable
 * area as editable text.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plus, X } from "lucide-react";
import { useArticleStore } from "./useStore.js";
import { RemoveBlock, useBlockChrome } from "./nodes/chrome.js";

export { FigureKgView } from "./nodes/FigureKgView.js";
export { ModelViewerView } from "./nodes/ModelViewerView.js";
export { AdmonitionView, ADMONITION_ICONS, ADMONITION_KIND_NAMES } from "./nodes/AdmonitionView.js";

/** Keystrokes inside a node view's form belong to the form, not to the editor's shortcut map. */
const swallowKeys = (event: KeyboardEvent): void => {
  event.stopPropagation();
};

/** The document position of the `index`-th child of a node that starts at `pos`. */
function childPos(node: ProseMirrorNode, pos: number, index: number): number {
  let at = pos + 1;
  for (let i = 0; i < index; i += 1) at += node.child(i).nodeSize;
  return at;
}

const label = (node: ProseMirrorNode, index: number): string => {
  const value: unknown = node.child(index).attrs["label"];
  return typeof value === "string" && value !== "" ? value : `Tab ${index + 1}`;
};

/**
 * `=== "Label"` groups: a tab strip over the tab node views.
 *
 * Which panel is visible is React state here but the panels themselves are ProseMirror's DOM, so
 * visibility is applied by toggling `hidden` on them rather than by rendering — a node view may not
 * decide whether another node view's DOM exists.
 */
export function TabsView({ node, editor, getPos }: ReactNodeViewProps): ReactNode {
  const { remove, chromeProps } = useBlockChrome(editor, getPos, node);
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<number | undefined>(undefined);
  const panels = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const base = useId();
  const count = node.childCount;
  const current = Math.min(active, Math.max(count - 1, 0));

  const currentRef = useRef(current);
  currentRef.current = current;

  const tabId = (index: number): string => `${base}-tab-${index}`;
  const panelId = (index: number): string => `${base}-panel-${index}`;

  /**
   * Hides every panel but the active one, and wires the panel half of the tab pattern.
   *
   * The panels are found by selector rather than by walking children, because TipTap puts its own
   * wrappers between `NodeViewContent` and the content DOM and how many is not this component's
   * business. The `closest` filter keeps a nested tabs group's panels out of this one's reckoning.
   *
   * `role`/`id`/`aria-labelledby` are set here rather than in `TabView` for the same reason the
   * visibility is: the panel's DOM belongs to ProseMirror, and the strip that points at it lives in
   * this component — only this component knows which index a given panel is.
   */
  const apply = useCallback((): void => {
    const container = panels.current;
    if (container === null) return;
    [...container.querySelectorAll<HTMLElement>("section.pge-tab")]
      .filter((panel) => panel.parentElement?.closest(".pge-tabs__panels") === container)
      .forEach((panel, i) => {
        panel.hidden = i !== currentRef.current;
        panel.id = panelId(i);
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tabId(i));
      });
  }, [base]);

  /**
   * ←/→/Home/End across the strip, the way a tablist is required to behave.
   *
   * Selection follows focus, which is the right choice for a small set of panels whose content is
   * already in the document: there is nothing to load, so a separate "activate" step would only be
   * an extra keystroke. Focus is moved explicitly because the strip is a *roving tabindex* — only
   * the selected tab is in the tab order, so Tab leaves the strip rather than walking it.
   */
  const onStripKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, number | undefined> = { ArrowLeft: -1, ArrowRight: 1 };
    const delta = moves[event.key];
    const next =
      delta !== undefined
        ? (current + delta + count) % count
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? count - 1
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setActive(next);
    strip.current?.querySelectorAll<HTMLElement>("button.pge-tabs__tab")[next]?.focus();
  };

  useEffect(apply, [apply, current, count, node]);

  // ProseMirror fills the content DOM in on its own schedule — after this component's first commit,
  // and again on every edit inside a panel — so a one-shot effect would run against an empty
  // container and leave every tab visible. Only `childList` is watched, so setting `hidden` here
  // cannot re-trigger this.
  useEffect(() => {
    const container = panels.current;
    if (container === null) return;
    const observer = new MutationObserver(apply);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [apply]);

  const dispatch = (build: (pos: number) => void): void => {
    const pos = getPos();
    if (pos === undefined) return;
    build(pos);
  };

  const rename = (index: number, value: string): void =>
    dispatch((pos) => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(childPos(node, pos, index), "label", value));
    });

  const addTab = (): void =>
    dispatch((pos) => {
      const type = editor.schema.nodes["tab"];
      const tab = type?.createAndFill({ label: `Tab ${count + 1}` });
      if (tab === null || tab === undefined) return;
      editor.view.dispatch(editor.state.tr.insert(pos + node.nodeSize - 1, tab));
      setActive(count);
    });

  const removeTab = (index: number): void =>
    dispatch((pos) => {
      if (count <= 1) return;
      const from = childPos(node, pos, index);
      editor.view.dispatch(editor.state.tr.delete(from, from + node.child(index).nodeSize));
      setActive(Math.max(index - 1, 0));
    });

  return (
    <NodeViewWrapper className="pge-tabs" data-pge-tabs="">
      <div
        className="pge-tabs__strip"
        contentEditable={false}
        role="tablist"
        ref={strip}
        onKeyDown={onStripKey}
        {...chromeProps}
      >
        {Array.from({ length: count }, (_, i) =>
          renaming === i ? (
            <input
              key={i}
              className="pge-tabs__rename"
              autoFocus
              defaultValue={label(node, i)}
              onKeyDown={(e) => {
                swallowKeys(e);
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                rename(i, e.currentTarget.value.trim());
                setRenaming(undefined);
              }}
            />
          ) : (
            <button
              key={i}
              type="button"
              role="tab"
              id={tabId(i)}
              className="pge-tabs__tab"
              aria-selected={i === current}
              aria-controls={panelId(i)}
              // Roving tabindex: one stop for the whole strip, arrows move within it.
              tabIndex={i === current ? 0 : -1}
              onClick={() => setActive(i)}
              onDoubleClick={() => setRenaming(i)}
              title="Double-click to rename"
            >
              {label(node, i)}
            </button>
          ),
        )}
        <span className="pge-tabs__spacer" />
        <button type="button" className="pge-icon" onClick={addTab} title="Add tab" aria-label="Add tab">
          <Plus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pge-icon"
          onClick={() => removeTab(current)}
          disabled={count <= 1}
          title="Remove tab"
          aria-label="Remove tab"
        >
          <X size={14} aria-hidden="true" />
        </button>
        <RemoveBlock thing="tab group" onRemove={remove} />
      </div>
      <div className="pge-tabs__panels" ref={panels}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}

/** One tab panel. Its label lives in the strip above, so the panel itself is just its content. */
export function TabView(): ReactNode {
  return (
    <NodeViewWrapper as="section" className="pge-tab">
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

/**
 * `--8<-- "path:section"`. The include is resolved at render time, not here, so the node view shows
 * the reference plus a read-only peek at the file it points at — enough to tell a typo from a hit.
 */
export function SnippetView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps): ReactNode {
  const store = useArticleStore();
  const { remove, chromeProps } = useBlockChrome(editor, getPos, node);
  const ref = typeof node.attrs["ref"] === "string" ? node.attrs["ref"] : "";
  const [peek, setPeek] = useState<string>("");

  useEffect(() => {
    const path = ref.split(":")[0] ?? "";
    if (path === "") {
      setPeek("");
      return;
    }
    let cancelled = false;
    void store
      .open(path)
      .then((file) => {
        if (!cancelled) setPeek((file.text ?? "").split("\n").slice(0, 8).join("\n"));
      })
      .catch(() => {
        if (!cancelled) setPeek("");
      });
    return () => {
      cancelled = true;
    };
  }, [ref, store]);

  return (
    <NodeViewWrapper className="pge-card pge-snippet" contentEditable={false} onKeyDown={swallowKeys}>
      <div className="pge-card__head" {...chromeProps}>
        <span className="pge-card__badge">snippet</span>
        <input
          className="pge-input"
          value={ref}
          placeholder="path/to/file.py:section"
          onChange={(e) => updateAttributes({ ref: e.target.value })}
          aria-label="Snippet reference"
        />
        <RemoveBlock thing="snippet" onRemove={remove} />
      </div>
      {peek === "" ? (
        <p className="pge-card__note">Resolved when the page is rendered.</p>
      ) : (
        <pre className="pge-card__peek">{peek}</pre>
      )}
    </NodeViewWrapper>
  );
}

/** `<figure markdown="span">` around an image: source, caption, width. */
export function FigureImageView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps): ReactNode {
  const attr = (key: string): string => (typeof node.attrs[key] === "string" ? (node.attrs[key] as string) : "");
  const { remove, chromeProps } = useBlockChrome(editor, getPos, node);
  const src = attr("src");
  return (
    <NodeViewWrapper className="pge-card pge-figimg" contentEditable={false} onKeyDown={swallowKeys}>
      <div className="pge-card__head" {...chromeProps}>
        <span className="pge-card__badge">image</span>
        <span className="pge-card__title">{src === "" ? "(no source)" : src}</span>
        <span className="pge-card__spacer" />
        <RemoveBlock thing="image figure" onRemove={remove} />
      </div>
      {src === "" ? <div className="pge-figimg__empty">No image source</div> : <img src={src} alt={attr("alt")} />}
      <div className="pge-card__fields">
        <label className="pge-field">
          <span>src</span>
          <input className="pge-input" value={src} onChange={(e) => updateAttributes({ src: e.target.value })} />
        </label>
        <label className="pge-field">
          <span>caption</span>
          <input
            className="pge-input"
            value={attr("caption")}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
          />
        </label>
        <label className="pge-field pge-field--narrow">
          <span>width</span>
          <input
            className="pge-input"
            value={attr("width")}
            placeholder="480"
            onChange={(e) => updateAttributes({ width: e.target.value })}
          />
        </label>
      </div>
    </NodeViewWrapper>
  );
}

/** Raw HTML the dialect has no node for: edited as text, kept byte-for-byte. */
export function HtmlBlockView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps): ReactNode {
  const html = typeof node.attrs["html"] === "string" ? node.attrs["html"] : "";
  const { remove, chromeProps } = useBlockChrome(editor, getPos, node);
  return (
    <NodeViewWrapper className="pge-card pge-html" contentEditable={false} onKeyDown={swallowKeys}>
      <div className="pge-card__head" {...chromeProps}>
        <span className="pge-card__badge">html</span>
        <span className="pge-card__spacer" />
        <RemoveBlock thing="HTML block" onRemove={remove} />
      </div>
      <textarea
        className="pge-textarea"
        value={html}
        rows={Math.min(Math.max(html.split("\n").length, 2), 16)}
        onChange={(e) => updateAttributes({ html: e.target.value })}
        aria-label="Raw HTML"
      />
    </NodeViewWrapper>
  );
}
