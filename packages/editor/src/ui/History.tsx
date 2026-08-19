/**
 * The history panel: who touched this article, in order.
 *
 * It exists **only when the backend can answer**. `ArticleBackend.history` is optional precisely so
 * that a host which keeps no log can say so by omission, and the alternative — a panel that renders
 * an empty list forever — reads as "nobody has edited this", which is a different and false claim.
 * So the caller renders nothing at all when `store.hasHistory` is false, and this component is
 * never mounted.
 *
 * It is not a revision list. pagina stores no old contents, so there is nothing here to restore and
 * no control that offers to: each row says that an edit happened, by whom, and when.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { History as HistoryIcon } from "lucide-react";
import type { ArticleStore, Edit } from "../store/index.js";

/** How many rows the panel asks for. Enough to scroll, short of a page a browser struggles with. */
const LIMIT = 50;

const VERB: Record<Edit["action"], string> = {
  write: "edited",
  upload: "uploaded",
  delete: "deleted",
  rename: "renamed",
  publish: "published",
};

/** "just now" / "12s ago" / "4m ago" / "3 Aug" — recent edits relative, older ones dated. */
function when(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export interface HistoryPanelProps {
  readonly store: ArticleStore;
  /** Narrows the log to one file. Omitted → the whole article. */
  readonly path?: string | undefined;
  readonly onOpen?: (path: string) => void;
}

export function HistoryPanel({ store, path, onOpen }: HistoryPanelProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState<readonly Edit[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const now = Date.now();

  const load = useCallback(async (): Promise<void> => {
    if (!store.hasHistory) return;
    try {
      setEdits(await store.history(path, { limit: LIMIT }));
      setError(undefined);
    } catch (e) {
      // A backend that advertised history and then failed is worth saying out loud: the panel is
      // opt-in, so a silent empty list here would look like an article nobody has touched.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [store, path]);

  // Re-read whenever the folder changes, but only while the panel is open: history is the least
  // urgent thing on screen and it is not worth a request per keystroke.
  useEffect(() => {
    if (!open) return undefined;
    void load();
    return store.on("files", () => { void load(); });
  }, [open, load, store]);

  if (!store.hasHistory) return null;

  return (
    <>
      <button
        type="button"
        className="pge-sidebar__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="pge-sidebar__chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <HistoryIcon size={13} aria-hidden="true" /> History
      </button>

      {open ? (
        error !== undefined ? (
          <p className="pge-sidebar__error">{error}</p>
        ) : edits === undefined ? (
          <p className="pge-sidebar__hint">Loading…</p>
        ) : edits.length === 0 ? (
          <p className="pge-sidebar__hint">No edits recorded yet.</p>
        ) : (
          <ol className="pge-history">
            {edits.map((edit, i) => (
              <li key={`${edit.at}:${edit.path}:${String(i)}`} className="pge-history__row">
                <span className="pge-history__who">{edit.by.name}</span>{" "}
                <span className="pge-history__what">{VERB[edit.action]}</span>{" "}
                {onOpen === undefined || edit.action === "delete" || edit.action === "publish" ? (
                  <span className="pge-history__path">{edit.path}</span>
                ) : (
                  <button
                    type="button"
                    className="pge-history__path pge-history__link"
                    onClick={() => onOpen(edit.path)}
                  >
                    {edit.path}
                  </button>
                )}
                {edit.from === undefined ? null : <span className="pge-history__from"> from {edit.from}</span>}
                <time className="pge-history__when" dateTime={edit.at} title={new Date(edit.at).toLocaleString()}>
                  {when(edit.at, now)}
                </time>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </>
  );
}
