/**
 * The one piece of editor layout that outlives a page load: how wide the pages sidebar is.
 *
 * It is a preference about the *tool*, not about the article, so it is stored under one key for
 * the whole origin rather than per namespace — an author who widened the sidebar wants it wide in
 * every article they open, and a per-article width would silently reset every time they switched.
 *
 * `localStorage` is optional here in a way it is not for `LocalStorageBackend`: a browser that
 * refuses it costs the author a remembered width, not their work, so every access is guarded and
 * failure is simply the default.
 */

/** Narrow enough to be worth having, wide enough that a nested nav entry is still readable. */
export const SIDEBAR_MIN = 160;
export const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 248;

const KEY = "pagina:editor:sidebar-width";

const clamp = (value: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));

export function loadSidebarWidth(): number {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw === null || raw === undefined) return SIDEBAR_DEFAULT;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

export function saveSidebarWidth(width: number): void {
  try {
    globalThis.localStorage?.setItem(KEY, String(Math.round(clamp(width))));
  } catch {
    /* private mode, or storage disabled: the width is simply not remembered */
  }
}
