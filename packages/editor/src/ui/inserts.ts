/**
 * Every block the editor can insert, in one list.
 *
 * The toolbar and the slash menu are two ways of reaching the same set, and a set defined twice
 * drifts: a kind of admonition gains a toolbar entry and never appears under `/`, or the two
 * disagree about what "Figure" does. So the commands live here, each one a small object the two
 * surfaces render differently, and neither surface knows how a block is built.
 */
import type { Editor } from "@tiptap/core";
import type { SimpleSceneSpec } from "kineglyph";
import type { ArticleStore } from "../store/index.js";
import type { FigureBuilderRequest } from "./context.js";
import { relativePath } from "./paths.js";

/** What an insert may reach for. Everything but the editor is optional so a test can omit it. */
export interface InsertContext {
  readonly editor: Editor;
  readonly store: ArticleStore;
  /** The page being edited — how a scene or an upload becomes a relative href. */
  readonly pagePath: string;
  /** Raises the figure builder, when the app provides one. */
  readonly openBuilder?: ((request: FigureBuilderRequest) => void) | undefined;
  /** Opens the host's file chooser and uploads whatever comes back. */
  readonly pickFile?: (() => void) | undefined;
}

export interface InsertAction {
  readonly id: string;
  readonly label: string;
  /** Groups the slash menu's list; also the toolbar's section order. */
  readonly group: "Text" | "Lists" | "Blocks" | "Media";
  /** Extra words the slash menu matches on, beyond the label. */
  readonly keywords?: readonly string[];
  run(ctx: InsertContext): void;
}

const ADMONITION_KINDS = ["note", "tip", "info", "warning", "danger", "example", "quote"] as const;

/** A fresh figure id that no scene file has taken yet. */
function newSceneId(store: ArticleStore): string {
  for (let n = 1; ; n += 1) {
    const id = `figure-${n}`;
    if (!store.files.has(`scenes/${id}.mjs`)) return id;
  }
}

/** Inserts the `figureKg` node a saved spec calls for. Shared by the builder's two entry points. */
export function insertFigureNode(ctx: InsertContext, scenePath: string, spec: SimpleSceneSpec): void {
  ctx.editor
    .chain()
    .focus()
    .insertContent({
      type: "figureKg",
      attrs: { kind: "module", id: spec.id, scene: relativePath(ctx.pagePath, scenePath) },
    })
    .run();
}

export const INSERTS: readonly InsertAction[] = [
  ...([1, 2, 3, 4] as const).map(
    (level): InsertAction => ({
      id: `heading-${level}`,
      label: `Heading ${level}`,
      group: "Text",
      keywords: ["title", `h${level}`],
      run: ({ editor }) => void editor.chain().focus().setHeading({ level }).run(),
    }),
  ),
  {
    id: "paragraph",
    label: "Paragraph",
    group: "Text",
    keywords: ["text", "body"],
    run: ({ editor }) => void editor.chain().focus().setParagraph().run(),
  },
  {
    id: "bullet-list",
    label: "Bullet list",
    group: "Lists",
    keywords: ["ul", "unordered"],
    run: ({ editor }) => void editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    label: "Numbered list",
    group: "Lists",
    keywords: ["ol", "ordered"],
    run: ({ editor }) => void editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "task-quote",
    label: "Quote",
    group: "Blocks",
    keywords: ["blockquote", "citation"],
    run: ({ editor }) => void editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code-block",
    label: "Code block",
    group: "Blocks",
    keywords: ["pre", "fence", "```"],
    run: ({ editor }) => void editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "table",
    label: "Table",
    group: "Blocks",
    keywords: ["grid", "rows"],
    run: ({ editor }) => void editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "hr",
    label: "Divider",
    group: "Blocks",
    keywords: ["rule", "hr", "---"],
    run: ({ editor }) => void editor.chain().focus().setHorizontalRule().run(),
  },
  ...ADMONITION_KINDS.map(
    (kind): InsertAction => ({
      id: `admonition-${kind}`,
      label: `Admonition: ${kind}`,
      group: "Blocks",
      keywords: ["callout", "aside", kind],
      run: ({ editor }) =>
        void editor
          .chain()
          .focus()
          .insertContent({
            type: "admonition",
            attrs: { kind, title: "", collapsible: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Write the note here." }] }],
          })
          .run(),
    }),
  ),
  {
    id: "tabs",
    label: "Tabs",
    group: "Blocks",
    keywords: ["group", "switch"],
    run: ({ editor }) => {
      const tab = (label: string, text: string) => ({
        type: "tab",
        attrs: { label },
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      editor.chain().focus().insertContent({ type: "tabs", content: [tab("Tab 1", "First tab."), tab("Tab 2", "Second tab.")] }).run();
    },
  },
  {
    id: "snippet",
    label: "Snippet include",
    group: "Blocks",
    keywords: ["include", "--8<--"],
    run: ({ editor }) => {
      const ref = globalThis.prompt?.("Snippet reference (path[:section])", "snippets/example.py");
      if (ref === null || ref === undefined || ref === "") return;
      editor.chain().focus().insertContent({ type: "snippet", attrs: { ref } }).run();
    },
  },
  {
    id: "figure",
    label: "Kineglyph figure",
    group: "Media",
    keywords: ["diagram", "scene", "kineglyph"],
    run: (ctx) => {
      if (ctx.openBuilder === undefined) {
        ctx.editor.chain().focus().insertContent({ type: "figureKg", attrs: { kind: "static", id: newSceneId(ctx.store) } }).run();
        return;
      }
      ctx.openBuilder({
        spec: { version: 1, id: newSceneId(ctx.store), title: "", layout: "stack", nodes: [] },
        onSave: (scenePath, spec) => insertFigureNode(ctx, scenePath, spec),
      });
    },
  },
  {
    id: "model",
    label: "3D model",
    group: "Media",
    keywords: ["glb", "gltf", "model-viewer"],
    run: ({ editor }) => void editor.chain().focus().insertContent({ type: "modelViewer", attrs: { src: "", alt: "" } }).run(),
  },
  {
    id: "upload",
    label: "Image or file upload",
    group: "Media",
    keywords: ["image", "picture", "attach", "file"],
    run: (ctx) => ctx.pickFile?.(),
  },
];

/** The actions whose label or keywords contain `query`, case-insensitively. */
export function filterInserts(query: string): readonly InsertAction[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return INSERTS;
  return INSERTS.filter(
    (action) =>
      action.label.toLowerCase().includes(needle) ||
      (action.keywords ?? []).some((word) => word.toLowerCase().includes(needle)),
  );
}
