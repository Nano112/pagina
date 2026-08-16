/**
 * "That change on disk was me."
 *
 * A dev host page — `pagina dev --edit` — watches the article folder and reloads its clients when
 * a file changes. The editor is one of those clients, so its *own* saves would reload it and throw
 * away whatever has been typed since. The host cannot tell which socket belongs to the editor, so
 * the editor says so instead: every successful backend mutation is announced through a global the
 * host page installs, and the host ignores a reload that lands inside that window.
 *
 * A global, and not an option on the store, because the two halves are written in different
 * packages and are wired together by neither: `@pagina/vite` renders the page, `@pagina/editor` is
 * mounted into it, and a host that installs no hook simply never hears about it. It is one
 * optional-call deep, which is exactly the weight this coupling deserves.
 */

/** What a host page may install on `window`. `at` defaults to now. */
export type SelfWriteHook = (path: string, at?: number) => void;

interface HostWithHook {
  __paginaSelfWrite?: SelfWriteHook;
}

/**
 * Announces that `path` was just written, renamed, uploaded or deleted through the backend.
 *
 * Called after the backend has answered, not before: the host's window has to cover the gap
 * between the file landing on disk and its watcher noticing, and a response can only arrive after
 * the write it describes.
 */
export function noteSelfWrite(path: string): void {
  if (typeof globalThis === "undefined") return;
  const host = globalThis as unknown as HostWithHook;
  try {
    host.__paginaSelfWrite?.(path, Date.now());
  } catch {
    // A broken host hook is the host's problem; it must never fail a save.
  }
}
