/**
 * A colour picker whose palette is the site's, not a designer's guess.
 *
 * The swatches are read from the `--pg-*` custom properties in force on the document at the moment
 * the picker opens, so an author highlighting a word gets the same accent the theme uses and the
 * choice keeps working when the theme is swapped. Anything outside the palette is still reachable —
 * a hex field, and the browser's own colour input — because a palette is a shortcut, not a fence.
 *
 * The value handed to `onPick` is always a `#rrggbb` string: `getComputedStyle` resolves tokens to
 * `rgb(…)`, and a mark carrying `rgb(…)` serialises to markdown differently from the same colour as
 * hex, which would make the round trip lossy for no reason.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * The tokens offered as swatches, in the order a palette usually reads.
 *
 * Three tiers, each a fallback for the one before: `--pg-*` is the site's token, `--pge-*` is the
 * editor's own (always defined on `.pge-app`), and the literal is what the editor's stylesheet
 * would have resolved to. The last tier exists because a picker with no swatches is not a picker,
 * and a host that mounts the editor before its stylesheet — or a test — must still get a palette.
 */
const TOKENS: readonly { readonly token: string; readonly fallback: string; readonly hex: string; readonly label: string }[] = [
  { token: "--pg-fg", fallback: "--pge-fg", hex: "#1a1d23", label: "Text" },
  { token: "--pg-muted", fallback: "--pge-muted", hex: "#6b7280", label: "Muted" },
  { token: "--pg-accent", fallback: "--pge-accent", hex: "#3b5bdb", label: "Accent" },
  { token: "--pg-tip", fallback: "--pge-ok", hex: "#0f9d58", label: "Tip" },
  { token: "--pg-warning", fallback: "--pge-warning", hex: "#b7791f", label: "Warning" },
  { token: "--pg-danger", fallback: "--pge-danger", hex: "#d64545", label: "Danger" },
  { token: "--pg-line", fallback: "--pge-line", hex: "#e3e6eb", label: "Line" },
  { token: "--pg-bg-raised", fallback: "--pge-raised", hex: "#f6f7f9", label: "Raised" },
  { token: "--pg-bg", fallback: "--pge-bg", hex: "#ffffff", label: "Background" },
];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` → `#aabbcc`; anything already six digits is returned lowercased. */
export function expandHex(value: string): string {
  const hex = value.trim().toLowerCase();
  if (!HEX.test(hex)) return hex;
  if (hex.length === 7) return hex;
  return `#${hex[1]!}${hex[1]!}${hex[2]!}${hex[2]!}${hex[3]!}${hex[3]!}`;
}

/**
 * `rgb(17, 34, 51)` / `rgba(…)` / `#abc` → `#112233`. Returns `undefined` for anything else —
 * a named colour, `color-mix(…)`, an unset token — which simply drops that swatch.
 */
export function toHex(value: string): string | undefined {
  const text = value.trim();
  if (text === "") return undefined;
  if (HEX.test(text)) return expandHex(text);
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb === null) return undefined;
  const channel = (raw: string): string =>
    Math.max(0, Math.min(255, Math.round(Number(raw)))).toString(16).padStart(2, "0");
  return `#${channel(rgb[1]!)}${channel(rgb[2]!)}${channel(rgb[3]!)}`;
}

/** The palette in force on `element`'s document, as hex. */
export function paletteFrom(element: Element | null): readonly { readonly label: string; readonly hex: string }[] {
  const styles = element === null || typeof getComputedStyle !== "function" ? undefined : getComputedStyle(element);
  const out: { label: string; hex: string }[] = [];
  for (const entry of TOKENS) {
    const hex =
      (styles === undefined ? undefined : toHex(styles.getPropertyValue(entry.token)) ?? toHex(styles.getPropertyValue(entry.fallback))) ??
      entry.hex;
    // A site whose accent *is* its text colour should get one swatch, not two identical ones.
    if (!out.some((existing) => existing.hex === hex)) out.push({ label: entry.label, hex });
  }
  return out;
}

export interface ColorPickerProps {
  /** The current colour, if there is one; shown as the selected swatch. */
  readonly value?: string | undefined;
  readonly onPick: (hex: string) => void;
  /** Offered as a "none" swatch when given — unset the mark, clear the background, … */
  readonly onClear?: (() => void) | undefined;
  readonly label?: string;
}

/**
 * The picker body. It has no popover of its own: {@link ColorButton} wraps it in one, and the
 * figure builder drops it straight into a form row.
 */
export function ColorPicker({ value, onPick, onClear, label = "Colour" }: ColorPickerProps): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<readonly { readonly label: string; readonly hex: string }[]>([]);
  const [text, setText] = useState(value ?? "");

  // Read on mount, not at module load: the tokens depend on the theme that is applied to the
  // document, and in a host that boots the editor before its stylesheet there would be nothing yet.
  useEffect(() => setPalette(paletteFrom(root.current ?? document.documentElement)), []);
  useEffect(() => setText(value ?? ""), [value]);

  const current = useMemo(() => (value === undefined ? undefined : toHex(value)), [value]);

  const commit = (raw: string): void => {
    const hex = expandHex(raw);
    if (HEX.test(hex)) onPick(hex);
  };

  return (
    <div className="pge-color" ref={root} role="group" aria-label={label}>
      <div className="pge-color__swatches">
        {onClear === undefined ? null : (
          <button type="button" className="pge-color__swatch pge-color__swatch--none" onClick={onClear} title="No colour" aria-label="No colour" />
        )}
        {palette.map((entry) => (
          <button
            key={entry.hex}
            type="button"
            className="pge-color__swatch"
            style={{ background: entry.hex }}
            aria-label={entry.label}
            aria-pressed={current === entry.hex}
            title={`${entry.label} (${entry.hex})`}
            onClick={() => onPick(entry.hex)}
          />
        ))}
      </div>
      <div className="pge-color__custom">
        <input
          className="pge-input pge-input--hex"
          value={text}
          spellCheck={false}
          placeholder="#3b82f6"
          aria-label={`${label}, hex`}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit(e.currentTarget.value);
          }}
        />
        <input
          type="color"
          className="pge-color__native"
          value={current ?? "#000000"}
          aria-label={`${label}, colour picker`}
          onChange={(e) => onPick(e.target.value)}
        />
      </div>
    </div>
  );
}

export interface ColorButtonProps extends ColorPickerProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly active?: boolean;
}

/** A toolbar button that drops a {@link ColorPicker} below itself. */
export function ColorButton({ title, children, active = false, ...picker }: ColorButtonProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrap.current?.contains(e.target as Node) !== true) setOpen(false);
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
    <div className="pge-popwrap" ref={wrap}>
      <button
        type="button"
        className="pge-tool"
        title={title}
        aria-label={title}
        aria-pressed={active}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open ? (
        <div className="pge-pop">
          <ColorPicker
            {...picker}
            onPick={(hex) => {
              picker.onPick(hex);
              setOpen(false);
            }}
            {...(picker.onClear === undefined
              ? {}
              : {
                  onClear: () => {
                    picker.onClear?.();
                    setOpen(false);
                  },
                })}
          />
        </div>
      ) : null}
    </div>
  );
}
