/**
 * The rules every backend that keeps attribution follows, in one place.
 *
 * There is not much of it, and that is the point: each backend stores its edit log wherever it can
 * (an array, `localStorage`, a file beside the folder), but they must agree on what a `limit` means
 * and on what a local, single-user identity is allowed to claim about itself.
 */
import type { Author, Edit, HistoryOptions } from "./types.js";

/** What `history()` returns when nobody asked for a number. */
export const HISTORY_DEFAULT_LIMIT = 50;

/**
 * The most any backend will return in one call.
 *
 * A ceiling rather than a courtesy: `history()` is reachable from a browser, and an unbounded
 * `limit` on a host that keeps years of edits is a way to ask a server to serialise its whole log.
 */
export const HISTORY_MAX_LIMIT = 500;

export function historyLimit(opts?: HistoryOptions): number {
  const asked = opts?.limit;
  if (asked === undefined || !Number.isFinite(asked)) return HISTORY_DEFAULT_LIMIT;
  return Math.max(0, Math.min(HISTORY_MAX_LIMIT, Math.floor(asked)));
}

/**
 * The identity `MemoryBackend` uses when the host names nobody.
 *
 * It says what it is. A backend that exists for the length of one page load has exactly one caller,
 * and calling that caller "This session" is honest in a way that both inventing a person and
 * recording nothing at all are not.
 */
export const MEMORY_AUTHOR: Author = { id: "pagina:memory", name: "This session" };

/**
 * The identity `LocalStorageBackend` uses when the host names nobody.
 *
 * One browser, one person — and it should say so rather than imply an account it does not have.
 */
export const LOCAL_AUTHOR: Author = { id: "pagina:local", name: "This browser" };

/**
 * Filters an append-ordered log to what `history(path, opts)` should answer: newest first, one
 * path if one was asked for, capped.
 */
export function selectHistory(log: readonly Edit[], path?: string, opts?: HistoryOptions): Edit[] {
  const limit = historyLimit(opts);
  const matching = path === undefined ? log : log.filter((e) => e.path === path || e.from === path);
  // Sliced from the end and then reversed, rather than reversing the whole log: the log is the part
  // that grows without bound, and the answer is the part that does not.
  return matching.slice(Math.max(0, matching.length - limit)).reverse();
}
