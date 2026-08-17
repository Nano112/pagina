/**
 * The toolbar.
 *
 * Every control is a thin wrapper over a TipTap command chain, and every one reports whether it is
 * currently *available* (`editor.can()`) and whether it is *active* — a disabled button that would
 * throw is worse than no button, and a toggle that does not show its state is a guess.
 *
 * The block inserts are not defined here: they come from `inserts.ts`, the same list the slash menu
 * offers, so the two can never drift apart. What is defined here is which of them are worth a
 * permanent button.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Baseline, Bold, ChevronDown, Code, Highlighter, Image, Italic, Link2, List, ListOrdered, Minus,
  MessageSquareWarning, Quote, Redo2, Scissors, Shapes, Sparkles, Strikethrough, Table, Undo2, Box,
} from "lucide-react";
import type { ArticleStore } from "../store/index.js";
import { ColorButton } from "./ColorPicker.js";
import { useFigureBuilder, useNotify, usePagePath } from "./context.js";
import { INSERTS, type InsertContext } from "./inserts.js";

const ADMONITION_KINDS = ["note", "tip", "info", "warning", "danger", "example", "quote"] as const;

/** `⌘` on a Mac, `Ctrl` everywhere else — a tooltip that names the wrong key is worse than none. */
const MOD =
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";

const hint = (title: string, keys?: string): string => (keys === undefined ? title : `${title} (${keys})`);

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

const ICON = { size: 16, "aria-hidden": true } as const;

/**
 * A `<select>` in pagina's own clothes.
 *
 * A native select paints itself in the *operating system's* chrome — a light macOS pill on a dark
 * host page, which is the same complaint that got the admonition node view redesigned, one surface
 * over. `appearance: none` removes the paint but takes the disclosure arrow with it, so the caret
 * has to be markup: hence this wrapper, which is the "markup change" a token-coloured caret costs.
 *
 * It stays a real `<select>`. The popup list is still the platform's — that part cannot be styled
 * without reimplementing a listbox — but `color-scheme` follows the theme, so it opens dark on a
 * dark page, and everything the author sees while the menu is closed is pagina's.
 */
function Select({ label, value, onChange, children, small = false }: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
  readonly small?: boolean;
}): ReactNode {
  return (
    <span className="pge-select-wrap" data-small={small ? "" : undefined}>
      <select
        className={small ? "pge-select pge-select--sm" : "pge-select"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        title={label}
      >
        {children}
      </select>
      <ChevronDown className="pge-select-wrap__caret" size={small ? 12 : 14} aria-hidden="true" />
    </span>
  );
}

/**
 * A toolbar button that opens a small menu of commands.
 *
 * The admonition inserts used to be a `<select>`, which was wrong twice over: it looked like an OS
 * control, and it *was* an OS control — a form field pretending to be a command menu, complete
 * with the "reset my own value after every choice" hack that gives away the pretence. This is a
 * button and a menu, styled from tokens, and it closes on Escape, on an outside click and on a
 * choice.
 */
function MenuButton({ title, icon, items, onPick }: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly items: readonly { readonly id: string; readonly label: string }[];
  readonly onPick: (id: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (root.current?.contains(e.target as Node) !== true) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="pge-menu" ref={root}>
      <button
        type="button"
        className="pge-tool pge-menu__button"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <ChevronDown className="pge-menu__caret" size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div className="pge-menu__list" role="menu" aria-label={title}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="pge-menu__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                onPick(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

export interface ToolbarProps {
  readonly editor: Editor | null;
  readonly store: ArticleStore;
  /** Opens the host's file chooser; the upload itself is the app's job, not the toolbar's. */
  readonly onPickFile: () => void;
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
  readonly color: string;
  readonly highlight: string;
}

const EMPTY_STATE: ToolbarState = {
  block: "paragraph",
  marks: {},
  canTable: false,
  canUndo: false,
  canRedo: false,
  linkHref: "",
  color: "",
  highlight: "",
};

const MARKS = ["bold", "italic", "strike", "code", "link", "highlight", "bulletList", "orderedList", "blockquote"] as const;

/** Runs the shared insert with the id `id`. Throws only if the list and the toolbar disagree. */
function runInsert(id: string, ctx: InsertContext): void {
  const action = INSERTS.find((candidate) => candidate.id === id);
  if (action === undefined) throw new Error(`pagina: no insert named "${id}"`);
  action.run(ctx);
}

export function Toolbar({ editor, store, onPickFile }: ToolbarProps): ReactNode {
  const pagePath = usePagePath();
  const openBuilder = useFigureBuilder();
  const notify = useNotify();
  const state = useEditorState<ToolbarState>({
    editor,
    selector: ({ editor: e }): ToolbarState => {
      if (e === null) return EMPTY_STATE;
      const level = ([1, 2, 3, 4] as const).find((l) => e.isActive("heading", { level: l }));
      const href: unknown = e.getAttributes("link")["href"];
      const color: unknown = e.getAttributes("textStyle")["color"];
      const highlight: unknown = e.getAttributes("highlight")["color"];
      return {
        block: e.isActive("codeBlock") ? "codeBlock" : level === undefined ? "paragraph" : `h${level}`,
        marks: Object.fromEntries(MARKS.map((m) => [m, e.isActive(m)])),
        canTable: e.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        linkHref: typeof href === "string" ? href : "",
        color: typeof color === "string" ? color : "",
        highlight: typeof highlight === "string" ? highlight : "",
      };
    },
  }) ?? EMPTY_STATE;

  if (editor === null) return <div className="pge-toolbar" aria-busy="true" />;

  const chain = () => editor.chain().focus();
  const on = (name: string): boolean => state.marks[name] === true;
  const ctx: InsertContext = {
    editor,
    store,
    pagePath,
    ...(openBuilder === undefined ? {} : { openBuilder }),
    ...(notify === undefined ? {} : { notify }),
    pickFile: onPickFile,
  };

  const setBlock = (value: string): void => {
    if (value === "paragraph") chain().setParagraph().run();
    else if (value === "codeBlock") chain().toggleCodeBlock().run();
    else chain().setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };

  const insertLink = (): void => {
    const href = globalThis.prompt?.("Link URL", state.linkHref === "" ? "https://" : state.linkHref);
    if (href === null || href === undefined) return;
    if (href === "") chain().unsetLink().run();
    else chain().setLink({ href }).run();
  };

  return (
    <div className="pge-toolbar" role="toolbar" aria-label="Formatting">
      <Select label="Block type" value={state.block} onChange={setBlock}>
        <option value="paragraph">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="codeBlock">Code block</option>
      </Select>

      <span className="pge-toolbar__sep" />

      <ToolButton title={hint("Bold", `${MOD}B`)} active={on("bold")} onClick={() => chain().toggleBold().run()}>
        <Bold {...ICON} />
      </ToolButton>
      <ToolButton title={hint("Italic", `${MOD}I`)} active={on("italic")} onClick={() => chain().toggleItalic().run()}>
        <Italic {...ICON} />
      </ToolButton>
      <ToolButton title={hint("Strikethrough", `${MOD}⇧S`)} active={on("strike")} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough {...ICON} />
      </ToolButton>
      <ToolButton title={hint("Inline code", `${MOD}E`)} active={on("code")} onClick={() => chain().toggleCode().run()}>
        <Code {...ICON} />
      </ToolButton>
      <ToolButton title={hint("Link", `${MOD}K`)} active={on("link")} onClick={insertLink}>
        <Link2 {...ICON} />
      </ToolButton>
      <ColorButton
        title="Text colour"
        label="Text colour"
        active={state.color !== ""}
        value={state.color === "" ? undefined : state.color}
        onPick={(hex) => chain().setColor(hex).run()}
        onClear={() => chain().unsetColor().run()}
      >
        <Baseline {...ICON} />
      </ColorButton>
      <ColorButton
        title="Highlight"
        label="Highlight"
        active={on("highlight")}
        value={state.highlight === "" ? undefined : state.highlight}
        onPick={(hex) => chain().setHighlight({ color: hex }).run()}
        onClear={() => chain().unsetHighlight().run()}
      >
        <Highlighter {...ICON} />
      </ColorButton>

      <span className="pge-toolbar__sep" />

      <ToolButton title={hint("Bullet list", `${MOD}⇧8`)} active={on("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        <List {...ICON} />
      </ToolButton>
      <ToolButton title={hint("Numbered list", `${MOD}⇧7`)} active={on("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered {...ICON} />
      </ToolButton>
      <ToolButton title={hint("Quote", `${MOD}⇧B`)} active={on("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
        <Quote {...ICON} />
      </ToolButton>
      <ToolButton title="Divider" onClick={() => runInsert("hr", ctx)}>
        <Minus {...ICON} />
      </ToolButton>
      <ToolButton title="Table (3×3)" disabled={!state.canTable} onClick={() => runInsert("table", ctx)}>
        <Table {...ICON} />
      </ToolButton>

      <span className="pge-toolbar__sep" />

      <MenuButton
        title="Insert admonition"
        icon={<MessageSquareWarning {...ICON} />}
        items={ADMONITION_KINDS.map((k) => ({ id: k, label: `${k[0]!.toUpperCase()}${k.slice(1)}` }))}
        onPick={(kind) => runInsert(`admonition-${kind}`, ctx)}
      />
      <ToolButton title="Tabs" onClick={() => runInsert("tabs", ctx)}>
        <Shapes {...ICON} />
      </ToolButton>
      <ToolButton title="Snippet include" onClick={() => runInsert("snippet", ctx)}>
        <Scissors {...ICON} />
      </ToolButton>
      <ToolButton title="Kineglyph figure" onClick={() => runInsert("figure", ctx)}>
        <Sparkles {...ICON} />
      </ToolButton>
      <ToolButton title="3D model" onClick={() => runInsert("model", ctx)}>
        <Box {...ICON} />
      </ToolButton>
      <ToolButton title="Upload an image or file" onClick={() => runInsert("upload", ctx)}>
        <Image {...ICON} />
      </ToolButton>

      <span className="pge-toolbar__spacer" />

      <ToolButton title={hint("Undo", `${MOD}Z`)} disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 {...ICON} />
      </ToolButton>
      <ToolButton title={hint("Redo", `${MOD}⇧Z`)} disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 {...ICON} />
      </ToolButton>
    </div>
  );
}
