/**
 * The Kineglyph figure builder: a form on the left, the real figure on the right.
 *
 * Everything here edits one {@link SimpleSceneSpec}. The preview is not a mock-up — it is
 * `sceneFromSpec` through `mountKineglyph`, the same path the published page takes — so the only
 * difference between what the author sees and what a reader gets is the surrounding page. When the
 * spec does not validate the preview holds its last good frame and the problems appear next to the
 * fields they belong to, keyed by Kineglyph's own `"<path>: <problem>"` messages; inventing a second
 * validator here would be a second thing to keep in step with the runtime.
 *
 * Saving writes `scenes/<id>.mjs` through the store and hands the caller the path; who owns the
 * `data-scene` attribute — a node view updating itself, or the toolbar inserting a new figure — is
 * the caller's business, not the builder's.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SimpleEdge, SimpleNode, SimpleSceneSpec } from "kineglyph";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { ArticleStore } from "../store/index.js";
import type { FigureBuilderRequest } from "./context.js";
import { blankSpec, previewSpec, specProblems, specToModuleSource, type SpecProblem } from "./kineglyph.js";
import { slugify } from "./paths.js";

/** The tones a spec may name, each shown with the theme token that stands closest to it. */
const TONES: readonly { readonly name: string; readonly token: string }[] = [
  { name: "neutral", token: "--pg-muted" },
  { name: "accent", token: "--pg-accent" },
  { name: "success", token: "--pg-tip" },
  { name: "warning", token: "--pg-warning" },
  { name: "danger", token: "--pg-danger" },
  { name: "info", token: "--pg-note" },
  { name: "muted", token: "--pg-muted" },
  { name: "text", token: "--pg-fg" },
  { name: "textMuted", token: "--pg-muted" },
  { name: "border", token: "--pg-line" },
  { name: "connector", token: "--pg-line" },
];

const NODE_KINDS = ["heading", "caption", "code", "text", "box"] as const;

/**
 * `{ …base, [key]: value }` with the key dropped entirely when `value` is empty.
 *
 * Optional spec fields must be *absent*, never `""`: Kineglyph reads an empty optional string as a
 * mistake ("must not be empty") rather than as "unset", and it is right to.
 */
function withOptional<T extends object, K extends string>(base: T, key: K, value: string): T {
  const rest = { ...base } as Record<string, unknown>;
  if (value.trim() === "") delete rest[key];
  else rest[key] = value;
  return rest as T;
}

/** Moves item `index` by `delta`, or returns the list unchanged when that would fall off an end. */
function moved<T>(list: readonly T[], index: number, delta: number): readonly T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item!);
  return out;
}

/** Every id in the tree, in document order — what an edge may point at. */
function allIds(nodes: readonly SimpleNode[]): readonly string[] {
  return nodes.flatMap((node) => (node.kind === "box" ? [node.id, ...allIds(node.children ?? [])] : [node.id]));
}

/** An id that is not taken yet, so adding a node never lands on a duplicate. */
function freeId(nodes: readonly SimpleNode[], base: string): string {
  const taken = new Set(allIds(nodes));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ---------------------------------------------------------------------------------------------
// Field pieces
// ---------------------------------------------------------------------------------------------

function Field({
  label,
  problem,
  children,
}: {
  readonly label: string;
  readonly problem?: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <label className="pge-field">
      <span>{label}</span>
      {children}
      {problem === undefined ? null : <em className="pge-field__error">{problem}</em>}
    </label>
  );
}

function TonePicker({
  value,
  onChange,
}: {
  readonly value: string | undefined;
  readonly onChange: (tone: string | undefined) => void;
}): ReactNode {
  return (
    <div className="pge-tones" role="group" aria-label="Tone">
      <button
        type="button"
        className="pge-tones__swatch pge-tones__swatch--none"
        aria-pressed={value === undefined}
        title="Default tone"
        aria-label="Default tone"
        onClick={() => onChange(undefined)}
      />
      {TONES.map((tone) => (
        <button
          key={tone.name}
          type="button"
          className="pge-tones__swatch"
          style={{ background: `var(${tone.token})` }}
          aria-pressed={value === tone.name}
          title={tone.name}
          aria-label={tone.name}
          onClick={() => onChange(tone.name)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

interface NodeListProps {
  readonly nodes: readonly SimpleNode[];
  readonly onChange: (nodes: readonly SimpleNode[]) => void;
  /** `nodes` or `nodes[0].children` — the prefix Kineglyph's error paths use for this list. */
  readonly path: string;
  readonly problems: readonly SpecProblem[];
  readonly depth?: number;
}

/** One editable level of the node tree; a `box` recurses for its children. */
function NodeList({ nodes, onChange, path, problems, depth = 0 }: NodeListProps): ReactNode {
  const problemAt = (field: string): string | undefined => problems.find((p) => p.path === field)?.problem;

  const replace = (index: number, node: SimpleNode): void =>
    onChange(nodes.map((existing, i) => (i === index ? node : existing)));

  const add = (): void =>
    onChange([...nodes, { id: freeId(nodes, `n${nodes.length + 1}`), kind: "text", text: "New text" }]);

  return (
    <div className="pge-nodes" data-depth={depth}>
      {nodes.map((node, index) => {
        const at = `${path}[${index}]`;
        return (
          <div className="pge-node" key={index}>
            <div className="pge-node__head">
              <select
                className="pge-select pge-select--sm"
                value={node.kind}
                aria-label="Node kind"
                onChange={(e) => {
                  const kind = e.target.value as (typeof NODE_KINDS)[number];
                  replace(
                    index,
                    kind === "box"
                      ? { id: node.id, kind: "box", title: "New box" }
                      : { id: node.id, kind, text: node.kind === "box" ? (node.title ?? "New text") : node.text },
                  );
                }}
              >
                {NODE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <input
                className="pge-input pge-input--id"
                value={node.id}
                aria-label="Node id"
                spellCheck={false}
                onChange={(e) => replace(index, { ...node, id: e.target.value })}
              />
              <span className="pge-node__spacer" />
              <button type="button" className="pge-icon" title="Move up" aria-label="Move up" onClick={() => onChange(moved(nodes, index, -1))}>
                <ArrowUp size={14} aria-hidden="true" />
              </button>
              <button type="button" className="pge-icon" title="Move down" aria-label="Move down" onClick={() => onChange(moved(nodes, index, 1))}>
                <ArrowDown size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pge-icon"
                title="Remove node"
                aria-label="Remove node"
                onClick={() => onChange(nodes.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>

            {problemAt(`${at}.id`) === undefined ? null : <em className="pge-field__error">{problemAt(`${at}.id`)}</em>}

            {node.kind === "box" ? (
              <>
                <Field label="Title" problem={problemAt(`${at}.title`)}>
                  <input
                    className="pge-input"
                    value={node.title ?? ""}
                    onChange={(e) => replace(index, withOptional(node, "title", e.target.value))}
                  />
                </Field>
                <Field label="Body" problem={problemAt(`${at}.body`)}>
                  <input
                    className="pge-input"
                    value={node.body ?? ""}
                    onChange={(e) => replace(index, withOptional(node, "body", e.target.value))}
                  />
                </Field>
                <Field label="Inner layout">
                  <select
                    className="pge-select pge-select--sm"
                    value={node.layout ?? "stack"}
                    onChange={(e) => replace(index, { ...node, layout: e.target.value as "stack" | "row" })}
                  >
                    <option value="stack">stack</option>
                    <option value="row">row</option>
                  </select>
                </Field>
              </>
            ) : (
              <Field label="Text" problem={problemAt(`${at}.text`)}>
                <textarea
                  className="pge-textarea pge-textarea--sm"
                  rows={node.kind === "code" ? 4 : 2}
                  value={node.text}
                  onChange={(e) => replace(index, { ...node, text: e.target.value })}
                />
              </Field>
            )}

            <Field label="Tone" problem={problemAt(`${at}.tone`)}>
              <TonePicker
                value={node.tone}
                onChange={(tone) => replace(index, withOptional(node, "tone", tone ?? ""))}
              />
            </Field>

            {node.kind === "box" ? (
              <div className="pge-node__children">
                <span className="pge-node__legend">Children</span>
                <NodeList
                  nodes={node.children ?? []}
                  path={`${at}.children`}
                  problems={problems}
                  depth={depth + 1}
                  onChange={(children) =>
                    replace(index, children.length === 0 ? withOptional(node, "children", "") : { ...node, children: [...children] })
                  }
                />
              </div>
            ) : null}
          </div>
        );
      })}
      <button type="button" className="pge-btn pge-btn--sm" onClick={add}>
        <Plus size={14} aria-hidden="true" /> Add node
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------------------------

function EdgeList({
  edges,
  ids,
  problems,
  onChange,
}: {
  readonly edges: readonly SimpleEdge[];
  readonly ids: readonly string[];
  readonly problems: readonly SpecProblem[];
  readonly onChange: (edges: readonly SimpleEdge[]) => void;
}): ReactNode {
  const replace = (index: number, edge: SimpleEdge): void => onChange(edges.map((e, i) => (i === index ? edge : e)));
  const problemAt = (field: string): string | undefined => problems.find((p) => p.path === field)?.problem;

  return (
    <div className="pge-edges">
      {edges.map((edge, index) => (
        <div className="pge-edge" key={index}>
          <select
            className="pge-select pge-select--sm"
            value={edge.from}
            aria-label="Edge source"
            onChange={(e) => replace(index, { ...edge, from: e.target.value })}
          >
            {[edge.from, ...ids.filter((id) => id !== edge.from)].map((id) => (
              <option key={id} value={id}>
                {id === "" ? "—" : id}
              </option>
            ))}
          </select>
          <span aria-hidden="true">→</span>
          <select
            className="pge-select pge-select--sm"
            value={edge.to}
            aria-label="Edge target"
            onChange={(e) => replace(index, { ...edge, to: e.target.value })}
          >
            {[edge.to, ...ids.filter((id) => id !== edge.to)].map((id) => (
              <option key={id} value={id}>
                {id === "" ? "—" : id}
              </option>
            ))}
          </select>
          <input
            className="pge-input"
            value={edge.label ?? ""}
            placeholder="label"
            aria-label="Edge label"
            onChange={(e) => replace(index, withOptional(edge, "label", e.target.value))}
          />
          <select
            className="pge-select pge-select--sm"
            value={edge.style ?? "solid"}
            aria-label="Edge style"
            onChange={(e) => replace(index, { ...edge, style: e.target.value as NonNullable<SimpleEdge["style"]> })}
          >
            <option value="solid">solid</option>
            <option value="dashed">dashed</option>
            <option value="flow">flow</option>
          </select>
          <select
            className="pge-select pge-select--sm"
            value={edge.head ?? "arrow"}
            aria-label="Edge head"
            onChange={(e) => replace(index, { ...edge, head: e.target.value as NonNullable<SimpleEdge["head"]> })}
          >
            <option value="arrow">arrow</option>
            <option value="none">none</option>
          </select>
          <button
            type="button"
            className="pge-icon"
            title="Remove edge"
            aria-label="Remove edge"
            onClick={() => onChange(edges.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
          {(problemAt(`edges[${index}].from`) ?? problemAt(`edges[${index}].to`) ?? problemAt(`edges[${index}].label`)) === undefined ? null : (
            <em className="pge-field__error">
              {problemAt(`edges[${index}].from`) ?? problemAt(`edges[${index}].to`) ?? problemAt(`edges[${index}].label`)}
            </em>
          )}
        </div>
      ))}
      <button
        type="button"
        className="pge-btn pge-btn--sm"
        disabled={ids.length < 2}
        onClick={() => onChange([...edges, { from: ids[0] ?? "", to: ids[1] ?? "" }])}
      >
        <Plus size={14} aria-hidden="true" /> Add edge
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

export interface FigureBuilderProps {
  readonly store: ArticleStore;
  readonly request: FigureBuilderRequest;
  readonly onClose: () => void;
}

export function FigureBuilder({ store, request, onClose }: FigureBuilderProps): ReactNode {
  const [spec, setSpec] = useState<SimpleSceneSpec>(() => request.spec ?? blankSpec(""));
  // An id derived from the title is a convenience, not a rule: once the author edits it (or the
  // spec arrived with one) the title stops driving it, or renaming a figure would rename its file.
  const [autoId, setAutoId] = useState(() => (request.spec?.id ?? "") === "");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof previewSpec> | undefined>(undefined);

  const problems = useMemo(() => specProblems(spec), [spec]);
  const valid = problems.length === 0;
  const problemAt = (field: string): string | undefined => problems.find((p) => p.path === field)?.problem;
  const ids = useMemo(() => allIds(spec.nodes), [spec.nodes]);

  // Only a valid spec is mounted; an invalid one leaves the last good figure on screen rather than
  // blanking the preview on every half-typed field.
  useEffect(() => {
    const element = stage.current;
    if (element === null || !valid) return;
    controller.current?.destroy();
    controller.current = undefined;
    try {
      controller.current = previewSpec(element, spec);
    } catch (e) {
      console.warn("pagina: figure preview failed", e);
    }
  }, [spec, valid]);

  useEffect(
    () => () => {
      controller.current?.destroy();
      controller.current = undefined;
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setTitle = (title: string): void =>
    setSpec((current) => ({ ...withOptional(current, "title", title), ...(autoId ? { id: slugify(title) } : {}) }));

  const save = (): void => {
    const path = request.scenePath ?? `scenes/${spec.id}.mjs`;
    const source = specToModuleSource(spec);
    setSaveError(undefined);
    const write = store.files.has(path)
      ? Promise.resolve(store.setText(path, source))
      : store.createFile(path, source).then(() => undefined);
    void write
      .then(() => {
        request.onSave(path, spec);
        onClose();
      })
      .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="pge-modal" role="dialog" aria-modal="true" aria-label="Figure builder">
      <div className="pge-modal__panel">
        <header className="pge-modal__head">
          <h2 className="pge-modal__title">Figure builder</h2>
          <span className="pge-modal__path">{request.scenePath ?? `scenes/${spec.id === "" ? "…" : spec.id}.mjs`}</span>
          <button type="button" className="pge-icon" title="Close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="pge-modal__body">
          <div className="pge-builder__form">
            <Field label="Title" problem={problemAt("title")}>
              <input className="pge-input" value={spec.title ?? ""} autoFocus onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Id" problem={problemAt("id")}>
              <input
                className="pge-input"
                value={spec.id}
                spellCheck={false}
                onChange={(e) => {
                  setAutoId(false);
                  setSpec((current) => ({ ...current, id: e.target.value }));
                }}
              />
            </Field>
            <Field label="Description" problem={problemAt("description")}>
              <input
                className="pge-input"
                value={spec.description ?? ""}
                placeholder="Read out to assistive technology"
                onChange={(e) => setSpec((current) => withOptional(current, "description", e.target.value))}
              />
            </Field>

            <div className="pge-builder__row">
              <Field label="Layout">
                <select
                  className="pge-select pge-select--sm"
                  value={spec.layout}
                  onChange={(e) => setSpec((current) => ({ ...current, layout: e.target.value as "stack" | "row" }))}
                >
                  <option value="stack">stack</option>
                  <option value="row">row</option>
                </select>
              </Field>
              <Field label="Gap" problem={problemAt("gap")}>
                <input
                  className="pge-input pge-input--num"
                  type="number"
                  min={0}
                  value={spec.gap ?? 16}
                  onChange={(e) => setSpec((current) => ({ ...current, gap: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Padding" problem={problemAt("padding")}>
                <input
                  className="pge-input pge-input--num"
                  type="number"
                  min={0}
                  value={spec.padding ?? 24}
                  onChange={(e) => setSpec((current) => ({ ...current, padding: Number(e.target.value) }))}
                />
              </Field>
              <Field label="Background">
                <select
                  className="pge-select pge-select--sm"
                  value={spec.background ?? "canvas"}
                  onChange={(e) => setSpec((current) => ({ ...current, background: e.target.value as "canvas" | "surface" | "none" }))}
                >
                  <option value="canvas">canvas</option>
                  <option value="surface">surface</option>
                  <option value="none">none</option>
                </select>
              </Field>
              <Field label="Timeline">
                <select
                  className="pge-select pge-select--sm"
                  value={spec.timeline ?? "reveal"}
                  onChange={(e) => setSpec((current) => ({ ...current, timeline: e.target.value as "reveal" | "none" }))}
                >
                  <option value="reveal">reveal</option>
                  <option value="none">none</option>
                </select>
              </Field>
            </div>

            <h3 className="pge-builder__legend">Nodes</h3>
            <NodeList
              nodes={spec.nodes}
              path="nodes"
              problems={problems}
              onChange={(nodes) => setSpec((current) => ({ ...current, nodes: [...nodes] }))}
            />

            <h3 className="pge-builder__legend">Edges</h3>
            <EdgeList
              edges={spec.edges ?? []}
              ids={ids}
              problems={problems}
              onChange={(edges) =>
                setSpec((current) => {
                  const next = { ...current } as SimpleSceneSpec & { edges?: SimpleEdge[] };
                  if (edges.length === 0) delete next.edges;
                  else next.edges = [...edges];
                  return next;
                })
              }
            />
          </div>

          <div className="pge-builder__preview">
            <div className="pge-builder__stage" ref={stage} />
            {valid ? null : (
              <ul className="pge-builder__problems">
                {problems.map((problem, i) => (
                  <li key={i}>
                    <code>{problem.path}</code> {problem.problem}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="pge-modal__foot">
          {saveError === undefined ? null : <span className="pge-modal__error">{saveError}</span>}
          <span className="pge-modal__spacer" />
          <button type="button" className="pge-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pge-btn pge-btn--primary" disabled={!valid} onClick={save}>
            Save figure
          </button>
        </footer>
      </div>
    </div>
  );
}
