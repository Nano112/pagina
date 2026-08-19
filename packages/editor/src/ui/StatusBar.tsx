/**
 * The bottom bar: whether the author's work is safe, and what to do when it is not.
 *
 * A conflict is the one thing here that demands an answer — the store has already stopped writing
 * the file, so until someone chooses a side nothing more is saved — so it is shown as a banner
 * above the bar rather than as a word inside it.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { ArticleStore, FileState, FileStatus } from "../store/index.js";
import { useStoreRevision } from "./useStore.js";

const LABEL: Record<FileStatus, string> = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Save failed",
  conflict: "Conflict",
};

/** "just now" / "12s ago" / "4m ago" — enough to tell "it saved" from "it stopped saving". */
function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 3) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * What the banner says, in the two cases it has.
 *
 * With a name it is a sentence about a person: *Alice changed index.md 2m ago, while you were
 * editing it.* Without one it is the sentence this banner has always shown. The difference is not
 * cosmetic — the first tells you whether to keep your version, and the second only tells you that
 * you have a decision to make.
 *
 * The name is what the *backend* reported, never anything the browser supplied.
 */
function conflictSentence(file: FileState, now: number): ReactNode {
  const deleted = file.conflict?.kind === "deleted";
  const by = file.conflict?.by;
  const at = file.conflict?.at;
  const verb = deleted ? "deleted" : "changed";
  if (by === undefined) {
    return (
      <>
        <strong>{file.path}</strong>{" "}
        {deleted
          ? "was deleted on the server while you were editing it."
          : "changed on the server while you were editing it."}
      </>
    );
  }
  return (
    <>
      <strong>{by.name}</strong>
      {` ${verb} `}
      <strong>{file.path}</strong>
      {at === undefined ? "" : ` ${ago(at, now)}`}
      , while you were editing it.
    </>
  );
}

function ConflictBanner(
  { store, file, now }: { readonly store: ArticleStore; readonly file: FileState; readonly now: number },
): ReactNode {
  const deleted = file.conflict?.kind === "deleted";
  return (
    <div className="pge-conflict" role="alert">
      {conflictSentence(file, now)}
      <span className="pge-conflict__actions">
        <button type="button" className="pge-btn" onClick={() => void store.resolveConflict(file.path, "theirs")}>
          {deleted ? "Accept deletion" : "Reload theirs"}
        </button>
        <button type="button" className="pge-btn pge-btn--primary" onClick={() => void store.resolveConflict(file.path, "mine")}>
          Keep mine
        </button>
      </span>
    </div>
  );
}

/** A message from the shell rather than from the store: an upload in flight, a failed serialize. */
export interface StatusNotice {
  readonly kind: "info" | "error";
  readonly text: string;
}

export interface StatusBarProps {
  readonly store: ArticleStore;
  readonly path: string;
  readonly onSave: () => void;
  readonly notice?: StatusNotice | undefined;
}

export function StatusBar({ store, path, onSave, notice }: StatusBarProps): ReactNode {
  useStoreRevision(store);
  const [now, setNow] = useState(() => Date.now());
  const status = store.status;

  // The "saved 12s ago" text ages on its own; the store has no event for the passage of time.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const conflicts = [...store.files.values()].filter((f) => f.status === "conflict");
  const failed = [...store.files.values()].find((f) => f.status === "error");

  return (
    <>
      {conflicts.map((file) => (
        <ConflictBanner key={file.path} store={store} file={file} now={now} />
      ))}
      <footer className="pge-status" data-state={status.state}>
        <span className="pge-status__dot" aria-hidden="true" />
        <span className="pge-status__state">{LABEL[status.state]}</span>
        {status.lastSavedAt === undefined ? null : (
          <span className="pge-status__time">· {ago(status.lastSavedAt, now)}</span>
        )}
        {failed === undefined ? null : (
          <>
            <span className="pge-status__error">{failed.error}</span>
            <button type="button" className="pge-btn pge-btn--sm" onClick={() => void store.retry(failed.path)}>
              Retry
            </button>
          </>
        )}
        {notice === undefined ? null : (
          <span
            className={notice.kind === "error" ? "pge-status__error" : "pge-status__notice"}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </span>
        )}
        <span className="pge-status__spacer" />
        <span className="pge-status__path">{path}</span>
        <button type="button" className="pge-btn pge-btn--sm" onClick={onSave} title="Save now (⌘S)">
          Save
        </button>
      </footer>
    </>
  );
}
