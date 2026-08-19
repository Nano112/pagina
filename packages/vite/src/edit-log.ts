/**
 * The dev server's edit log: who wrote what, appended beside the article folder.
 *
 * **This is not an audit trail, and the docs say so.** `pagina dev --edit` has no authentication —
 * anyone who can reach the port can write any file — so the identity here is whoever configured it
 * or whoever is logged into the machine, and the log is a plain file the same person can edit. What
 * it is good for is the thing it was built for: two tabs, or a dev server and an editor, producing
 * a conflict banner that names somebody. A host that needs a real record has a database and an
 * authenticated session, and implements the same HTTP contract over those.
 *
 * The format is JSON Lines — one object per line, appended, never rewritten. That is what makes it
 * append-only in fact and not just in intention: no read-modify-write, so a crash mid-log costs the
 * last line rather than the file, and a concurrent append cannot interleave a partial record.
 */
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { parseAuthor, parseInstant, type Author } from "@pagina/core";

/** Folder-relative path of the log. Inside `.pagina/`, so it is never listed, read or written as content. */
export const EDIT_LOG_PATH = ".pagina/edits.jsonl";

export type EditAction = "write" | "upload" | "delete" | "rename" | "publish";

const ACTIONS = new Set<string>(["write", "upload", "delete", "rename", "publish"]);

export interface LoggedEdit {
  readonly path: string;
  readonly action: EditAction;
  readonly at: string;
  readonly by: Author;
  /** The version the edit produced — the sha1 of the bytes. Empty for a delete or a publish. */
  readonly version: string;
  readonly from?: string;
}

/**
 * Who the dev server records writes as, when nothing was configured.
 *
 * The OS user, because on a single-user dev server that is who is typing, and recording "harrison"
 * is honest in a way that recording nothing at all is not. `id` is prefixed so it cannot be
 * mistaken for a host's own user id if this log ever travels.
 */
export function osIdentity(): Author {
  try {
    const name = userInfo().username;
    if (name !== "") return { id: `os:${name}`, name };
  } catch { /* no passwd entry (a container, a locked-down CI box) */ }
  return { id: "pagina:dev", name: "The dev server" };
}

/** One line of the log, or `undefined` when it is not a record we can use. */
function parseLine(line: string): LoggedEdit | undefined {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return undefined; }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const by = parseAuthor(o["by"]);
  const at = parseInstant(o["at"]);
  if (by === undefined || at === undefined || typeof o["path"] !== "string") return undefined;
  return {
    path: o["path"], at, by,
    action: typeof o["action"] === "string" && ACTIONS.has(o["action"]) ? o["action"] as EditAction : "write",
    version: typeof o["version"] === "string" ? o["version"] : "",
    ...(typeof o["from"] === "string" ? { from: o["from"] } : {}),
  };
}

/**
 * Parsed logs, keyed by file, and validated by **size**.
 *
 * Size is a sound key here and would not be anywhere else: this log is only ever appended to, never
 * rewritten in place, so a file that is the same length is the same file. That is what lets the
 * middleware re-ask on every request — which it must, because it is not necessarily the only writer
 * — without re-parsing a log that has not moved. A log that shrinks (deleted, truncated, replaced)
 * fails the check and is read again.
 */
const parsed = new Map<string, { size: number; entries: LoggedEdit[] }>();

/** Reads the whole log, oldest first. A missing log is an empty one; a bad line is skipped. */
export async function readEditLog(root: string): Promise<LoggedEdit[]> {
  const file = join(root, ...EDIT_LOG_PATH.split("/"));
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    parsed.delete(file);
    return [];
  }
  const cached = parsed.get(file);
  if (cached !== undefined && cached.size === size) return cached.entries;

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const entries: LoggedEdit[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const entry = parseLine(line);
    if (entry !== undefined) entries.push(entry);
  }
  parsed.set(file, { size, entries });
  return entries;
}

/** Appends one record. Creates `.pagina/` if it is not there yet. */
export async function appendEditLog(root: string, entry: LoggedEdit): Promise<void> {
  const file = join(root, ...EDIT_LOG_PATH.split("/"));
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * The last edit recorded against each path — the attribution a listing reports.
 *
 * A `rename` re-keys the entry: the log records it against the new path, and the old path stops
 * having a last edit because it stops being a file.
 */
export function latestByPath(log: readonly LoggedEdit[]): Map<string, LoggedEdit> {
  const out = new Map<string, LoggedEdit>();
  for (const entry of log) {
    if (entry.action === "publish") continue;   // not about a file in the folder
    if (entry.action === "delete") { out.delete(entry.path); continue; }
    if (entry.from !== undefined) out.delete(entry.from);
    out.set(entry.path, entry);
  }
  return out;
}

/**
 * The attribution to report for a file, or nothing.
 *
 * Gated on the version, and that gate is the whole reason this is honest. The middleware is not the
 * only writer to an article folder — the author's own text editor is right there — so a log entry
 * only describes the file that is *currently* on disk if the bytes still hash to what was recorded.
 * Edit `index.md` in vim and its attribution disappears rather than crediting whoever last used the
 * editor, which is the correct answer to "who wrote this": nobody we know of.
 */
export function attributionFor(
  latest: ReadonlyMap<string, LoggedEdit>, path: string, version: string,
): { lastEditedBy: Author; lastEditedAt: string } | undefined {
  const entry = latest.get(path);
  if (entry === undefined || entry.version !== version) return undefined;
  return { lastEditedBy: entry.by, lastEditedAt: entry.at };
}
