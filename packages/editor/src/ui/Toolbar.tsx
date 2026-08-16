/**
 * The toolbar.
 *
 * Every control is a thin wrapper over a TipTap command chain, and every one reports whether it is
 * currently *available* (`editor.can()`) and whether it is *active* — a disabled button that would
 * throw is worse than no button, and a toggle that does not show its state is a guess.
 */
import { useRef, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import type { ArticleStore } from "../store/index.js";

const ADMONITION_KINDS = ["note", "tip", "info", "warning", "danger", "example", "quote"] as const;

interface ButtonProps {
  readonly onClick: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly active?: boolean;
  readonly disabled?: boolean;
}

function ToolButton({ onClick, title, children, active = false, disabled = false }: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="pge-tool"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // The editor loses focus the moment a button takes it, which would collapse the selection
      // the command is about to act on.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface ToolbarProps {
  readonly editor: Editor | null;
  readonly store: ArticleStore;
}

/**
 * What the toolbar shows about the current selection.
 *
 * `useEditor` does not re-render on every transaction (that is legacy behaviour in TipTap 3), so
 * the toolbar subscribes to just this projection of the editor state instead — which is also why
 * the buttons stay responsive while typing without re-rendering the document.
 */
interface ToolbarState {
  readonly block: string;
  readonly marks: Readonly<Record<string, boolean>>;
  readonly canTable: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly linkHref: string;
}

const EMPTY_STATE: ToolbarState = {
  block: "paragraph",
  marks: {},
  canTable: false,
  canUndo: false,
  canRedo: false,
  linkHref: "",
};

const MARKS = ["bold", "italic", "strike", "code", "link", "highlight", "bulletList", "orderedList", "blockquote"] as const;

export function Toolbar({ editor, store }: ToolbarProps): ReactNode {
  const fileInput = useRef<HTMLInputElement>(null);
  const state = useEditorState<ToolbarState>({
    editor,
    selector: ({ editor: e }): ToolbarState => {
      if (e === null) return EMPTY_STATE;
      const level = ([1, 2, 3, 4] as const).find((l) => e.isActive("heading", { level: l }));
      const href: unknown = e.getAttributes("link")["href"];
      return {
        block: e.isActive("codeBlock") ? "codeBlock" : level === undefined ? "paragraph" : `h${level}`,
        marks: Object.fromEntries(MARKS.map((m) => [m, e.isActive(m)])),
        canTable: e.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        linkHref: typeof href === "string" ? href : "",
      };
    },
  }) ?? EMPTY_STATE;

  if (editor === null) return <div className="pge-toolbar" aria-busy="true" />;

  const chain = () => editor.chain().focus();
  const on = (name: string): boolean => state.marks[name] === true;

  const setBlock = (value: string): void => {
    if (value === "paragraph") chain().setParagraph().run();
    else if (value === "codeBlock") chain().toggleCodeBlock().run();
    else chain().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };

  const insertAdmonition = (kind: string): void => {
    chain()
      .insertContent({
        type: "admonition",
        attrs: { kind, title: "", collapsible: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Write the note here." }] }],
      })
      .run();
  };

  const insertTabs = (): void => {
    const tab = (label: string, text: string) => ({
      type: "tab",
      attrs: { label },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    chain().insertContent({ type: "tabs", content: [tab("Tab 1", "First tab."), tab("Tab 2", "Second tab.")] }).run();
  };

  const insertSnippet = (): void => {
    const ref = globalThis.prompt?.("Snippet reference (path[:section])", "snippets/example.py");
    if (ref === null || ref === undefined || ref === "") return;
    chain().insertContent({ type: "snippet", attrs: { ref } }).run();
  };

  const insertLink = (): void => {
    const href = globalThis.prompt?.("Link URL", state.linkHref === "" ? "https://" : state.linkHref);
    if (href === null || href === undefined) return;
    if (href === "") chain().unsetLink().run();
    else chain().setLink({ href }).run();
  };

  const upload = async (file: File): Promise<void> => {
    const result = await store.uploadFile(file);
    if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(result.path)) {
      chain().insertContent({ type: "image", attrs: { src: result.path, alt: file.name } }).run();
    } else if (/\.glb$/i.test(result.path)) {
      chain().insertContent({ type: "modelViewer", attrs: { src: result.path, alt: file.name } }).run();
    } else {
      chain().insertContent(`[${file.name}](${result.path})`).run();
    }
  };

  return (
    <div className="pge-toolbar" role="toolbar" aria-label="Formatting">
      <select
        className="pge-select"
        value={state.block}
        onChange={(e) => setBlock(e.target.value)}
        aria-label="Block type"
      >
        <option value="paragraph">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="codeBlock">Code block</option>
      </select>

      <span className="pge-toolbar__sep" />

      <ToolButton title="Bold" active={on("bold")} onClick={() => chain().toggleBold().run()}>
        <b>B</b>
      </ToolButton>
      <ToolButton title="Italic" active={on("italic")} onClick={() => chain().toggleItalic().run()}>
        <i>I</i>
      </ToolButton>
      <ToolButton title="Strike" active={on("strike")} onClick={() => chain().toggleStrike().run()}>
        <s>S</s>
      </ToolButton>
      <ToolButton title="Code" active={on("code")} onClick={() => chain().toggleCode().run()}>
        <code>{"</>"}</code>
      </ToolButton>
      <ToolButton title="Link" active={on("link")} onClick={insertLink}>
        ↗
      </ToolButton>
      <label className="pge-tool pge-tool--color" title="Text colour">
        <span aria-hidden="true">A</span>
        <input
          type="color"
          aria-label="Text colour"
          onChange={(e) => chain().setColor(e.target.value).run()}
        />
      </label>
      <ToolButton title="Highlight" active={on("highlight")} onClick={() => chain().toggleHighlight().run()}>
        ▨
      </ToolButton>

      <span className="pge-toolbar__sep" />

      <ToolButton title="Bullet list" active={on("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        •
      </ToolButton>
      <ToolButton title="Numbered list" active={on("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        1.
      </ToolButton>
      <ToolButton title="Quote" active={on("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </ToolButton>
      <ToolButton title="Horizontal rule" onClick={() => chain().setHorizontalRule().run()}>
        —
      </ToolButton>
      <ToolButton
        title="Table"
        disabled={!state.canTable}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        ▦
      </ToolButton>

      <span className="pge-toolbar__sep" />

      <select
        className="pge-select"
        value=""
        onChange={(e) => {
          if (e.target.value !== "") insertAdmonition(e.target.value);
          e.target.value = "";
        }}
        aria-label="Insert admonition"
      >
        <option value="">Admonition…</option>
        {ADMONITION_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <ToolButton title="Tabs" onClick={insertTabs}>
        ⧉
      </ToolButton>
      <ToolButton title="Snippet" onClick={insertSnippet}>
        ✂
      </ToolButton>
      <ToolButton
        title="Kineglyph figure"
        onClick={() =>
          chain()
            .insertContent({ type: "figureKg", attrs: { kind: "static", id: `figure-${Date.now().toString(36)}` } })
            .run()
        }
      >
        ◈
      </ToolButton>
      <ToolButton
        title="3D model"
        onClick={() => chain().insertContent({ type: "modelViewer", attrs: { src: "media/model.glb", alt: "" } }).run()}
      >
        ⬢
      </ToolButton>
      <ToolButton title="Upload image or file" onClick={() => fileInput.current?.click()}>
        ⇧
      </ToolButton>
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file !== undefined) void upload(file);
        }}
      />

      <span className="pge-toolbar__spacer" />

      <ToolButton title="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        ↺
      </ToolButton>
      <ToolButton title="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        ↻
      </ToolButton>
    </div>
  );
}
