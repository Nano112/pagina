/**
 * A draggable divider between two panes.
 *
 * Both of the shell's splits are this component. The one between the document and the preview was
 * a bare `<div role="separator">` with a pointer handler and nothing else, which meant the layout
 * could only be changed with a mouse; the one between the pages list and the document did not
 * exist at all, because the sidebar was a constant.
 *
 * A separator that can be moved is, per ARIA, a *focusable* separator: it takes `tabindex="0"`,
 * reports its position with `aria-valuenow` between `aria-valuemin` and `aria-valuemax`, and moves
 * on the arrow keys — with Home/End for the extremes and a coarser step on Page Up/Down. The value
 * is reported in whatever unit the split is measured in (pixels for the sidebar, percent for the
 * preview), because a screen reader announcing "248" next to a label that says pixels is useful and
 * a normalised 0–1 fraction is not.
 */
import { useCallback, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export interface SplitterProps {
  readonly label: string;
  /** Current position, in the same unit as `min`/`max`. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** One arrow key's worth. Page Up/Down move ten times this. */
  readonly step?: number;
  /** How many decimals `aria-valuenow` carries; percentages want one, pixels none. */
  readonly decimals?: number;
  readonly onChange: (value: number) => void;
  /**
   * Turns a pointer position into a value. It is the caller's because only the caller knows which
   * edge the pane is measured from — the sidebar grows rightwards from the left edge, the preview
   * leftwards from the right one.
   */
  readonly measure: (event: { readonly clientX: number }) => number;
  /** Extra class on the handle, for the two positions' different cursors and hit areas. */
  readonly className?: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function Splitter({
  label, value, min, max, step = 8, decimals = 0, onChange, measure, className = "pge-handle",
}: SplitterProps): ReactNode {
  // Read inside the listeners rather than captured, so a drag started before a resize still uses
  // the current bounds.
  const bounds = useRef({ min, max, measure });
  bounds.current = { min, max, measure };

  const startDrag = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent): void => {
      const { min: lo, max: hi, measure: to } = bounds.current;
      onChange(clamp(to(moved), lo, hi));
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }, [onChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const deltas: Record<string, number | undefined> = {
      ArrowLeft: -step, ArrowRight: step, PageUp: -step * 10, PageDown: step * 10,
    };
    const delta = deltas[event.key];
    const next =
      delta !== undefined ? value + delta : event.key === "Home" ? min : event.key === "End" ? max : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next, min, max));
  };

  return (
    <div
      className={className}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Number(value.toFixed(decimals))}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
    />
  );
}
