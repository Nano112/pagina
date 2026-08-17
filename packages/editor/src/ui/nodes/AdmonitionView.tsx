/**
 * `!!! kind "Title"` / `??? kind "Title"`, as the author edits it.
 *
 * The old chrome was a naked `<select>`, a bare `<input>` and an unstyled checkbox in a row: a
 * debug form dropped into the page, styled by whatever browser and host it landed in, and with no
 * way at all to delete the block it decorated. What it is now is a *tool strip* over a block that
 * looks like the block the page will publish — same tint, same accent edge, same glyph — because
 * the whole promise of the pane is that what you edit is what you get.
 *
 * The kind picker keeps a real `<select>` underneath the icon-and-label it draws: transparent,
 * stretched over the trigger. The visible layer is entirely pagina's, so nothing here inherits a
 * host's control styling — and the semantics, the keyboard behaviour and the accessible name are
 * still the platform's, which no hand-rolled listbox gets right for free.
 */
import { type KeyboardEvent, type ReactNode } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import {
  ChevronDown, Flame, FlaskConical, Info, Pencil, Quote, TriangleAlert, Zap,
  type LucideIcon,
} from "lucide-react";
import { RemoveBlock, useBlockChrome } from "./chrome.js";

/** The seven kinds core renders a glyph and a hue for, with the matching lucide icon. */
export const ADMONITION_ICONS: Record<string, LucideIcon> = {
  note: Pencil,
  tip: Flame,
  info: Info,
  warning: TriangleAlert,
  danger: Zap,
  example: FlaskConical,
  quote: Quote,
};

export const ADMONITION_KIND_NAMES = Object.keys(ADMONITION_ICONS);

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Keystrokes inside the strip belong to the strip, not to the editor's shortcut map. */
const swallowKeys = (event: KeyboardEvent): void => {
  event.stopPropagation();
};

export function AdmonitionView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps): ReactNode {
  const kind = typeof node.attrs["kind"] === "string" && node.attrs["kind"] !== "" ? node.attrs["kind"] : "note";
  const title = typeof node.attrs["title"] === "string" ? node.attrs["title"] : "";
  const collapsible = node.attrs["collapsible"] === true;
  const { remove, chromeProps } = useBlockChrome(editor, getPos, node);

  const Glyph = ADMONITION_ICONS[kind] ?? ADMONITION_ICONS["note"]!;
  // A kind core does not know still renders — as a `note` — so the picker has to be able to show
  // it rather than silently snapping the author's `!!! spoiler` to something else.
  const kinds = ADMONITION_KIND_NAMES.includes(kind) ? ADMONITION_KIND_NAMES : [...ADMONITION_KIND_NAMES, kind];

  return (
    <NodeViewWrapper className="pge-adm" data-kind={kind} data-collapsible={collapsible ? "" : undefined}>
      <div className="pge-adm__head" contentEditable={false} onKeyDown={swallowKeys} {...chromeProps}>
        <span className="pge-adm__kind">
          <Glyph size={15} className="pge-adm__glyph" aria-hidden="true" />
          <span className="pge-adm__kindname">{capitalise(kind)}</span>
          <ChevronDown size={12} className="pge-adm__caret" aria-hidden="true" />
          <select
            className="pge-adm__picker"
            value={kind}
            onChange={(e) => updateAttributes({ kind: e.target.value })}
            aria-label="Admonition kind"
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {capitalise(k)}
              </option>
            ))}
          </select>
        </span>

        <input
          className="pge-adm__title"
          value={title}
          placeholder="Title (optional)"
          onChange={(e) => updateAttributes({ title: e.target.value })}
          aria-label="Admonition title"
        />

        <button
          type="button"
          role="switch"
          aria-checked={collapsible}
          className="pge-adm__toggle"
          title="Collapsible (??? instead of !!!)"
          onClick={() => updateAttributes({ collapsible: !collapsible })}
        >
          <span className="pge-adm__track" aria-hidden="true">
            <span className="pge-adm__thumb" />
          </span>
          Collapsible
        </button>

        <RemoveBlock thing="admonition" onRemove={remove} />
      </div>
      <NodeViewContent className="pge-adm__body" />
    </NodeViewWrapper>
  );
}
