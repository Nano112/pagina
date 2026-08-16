/**
 * The left pane: the article's pages, then every file in the folder.
 *
 * The two lists answer different questions. The pages tree mirrors `article.yaml`'s `nav` — the
 * reader's table of contents, in the author's order. The file list is the folder as it actually is,
 * including snippets, media and pages that are not in the nav yet; a page created here appears
 * there immediately but has to be added to `article.yaml` by hand before it joins the tree.
 */
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import type { NavEntry } from "@pagina/core";
import type { ArticleStore } from "../store/index.js";
import { useStoreRevision } from "./useStore.js";

const isMarkdown = (path: string): boolean => path.endsWith(".md");

function PagesTree({
  entries,
  current,
  onOpen,
  depth = 0,
}: {
  readonly entries: readonly NavEntry[];
  readonly current: string;
  readonly onOpen: (path: string) => void;
  readonly depth?: number;
}): ReactNode {
  return (
    <ul className="pge-tree" data-depth={depth}>
      {entries.map((entry, i) =>
        "section" in entry ? (
          <li key={`s${i}`} className="pge-tree__section">
            <span className="pge-tree__label">{entry.section}</span>
            <PagesTree entries={entry.children} current={current} onOpen={onOpen} depth={depth + 1} />
          </li>
        ) : (
          <li key={entry.page}>
            <button
              type="button"
              className="pge-tree__link"
              aria-current={entry.page === current ? "page" : undefined}
              onClick={() => onOpen(entry.page)}
            >
              {entry.title}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

export interface SidebarProps {
  readonly store: ArticleStore;
  readonly current: string;
  readonly onOpen: (path: string) => void;
}

export function Sidebar({ store, current, onOpen }: SidebarProps): ReactNode {
  useStoreRevision(store);
  const [showFiles, setShowFiles] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const files = store.list();

  const guard = async (what: string, run: () => Promise<unknown>): Promise<void> => {
    setBusy(undefined);
    try {
      await run();
    } catch (e) {
      setBusy(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const newPage = (): void => {
    const path = globalThis.prompt?.("New page path", "new-page.md");
    if (path === null || path === undefined || path === "") return;
    void guard("Create", async () => {
      const name = path.endsWith(".md") ? path : `${path}.md`;
      await store.createFile(name, `# ${name.replace(/\.md$/, "").split("/").pop() ?? "Untitled"}\n\n`);
      onOpen(name);
    });
  };

  const newFile = (): void => {
    const path = globalThis.prompt?.("New file path", "snippets/example.py");
    if (path === null || path === undefined || path === "") return;
    void guard("Create", () => store.createFile(path, ""));
  };

  const uploadAll = (list: FileList | null): void => {
    if (list === null) return;
    void guard("Upload", async () => {
      for (const file of list) await store.uploadFile(file);
    });
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDropping(false);
    uploadAll(e.dataTransfer.files);
  };

  return (
    <aside
      className="pge-pane pge-sidebar"
      data-dropping={dropping ? "" : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="pge-sidebar__head">
        <span className="pge-sidebar__title">{store.article?.title ?? "Loading…"}</span>
      </div>

      <PagesTree entries={store.nav} current={current} onOpen={onOpen} />

      <div className="pge-sidebar__actions">
        <button type="button" className="pge-btn" onClick={newPage}>
          New page
        </button>
        <button type="button" className="pge-btn" onClick={() => fileInput.current?.click()}>
          Upload
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            uploadAll(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <button
        type="button"
        className="pge-sidebar__toggle"
        aria-expanded={showFiles}
        onClick={() => setShowFiles((v) => !v)}
      >
        <span className="pge-sidebar__chev" aria-hidden="true">
          {showFiles ? "▾" : "▸"}
        </span>
        All files <span className="pge-count">{files.length}</span>
      </button>

      {showFiles ? (
        <>
          <ul className="pge-files">
            {files.map((file) => (
              <li key={file.path} className="pge-files__row">
                <button
                  type="button"
                  className="pge-files__link"
                  aria-current={file.path === current ? "page" : undefined}
                  disabled={!isMarkdown(file.path)}
                  title={isMarkdown(file.path) ? `Open ${file.path}` : `${file.path} (not a page)`}
                  onClick={() => onOpen(file.path)}
                >
                  {file.path}
                </button>
                <button
                  type="button"
                  className="pge-icon"
                  title={`Delete ${file.path}`}
                  aria-label={`Delete ${file.path}`}
                  onClick={() => {
                    if (globalThis.confirm?.(`Delete ${file.path}?`) === true)
                      void guard("Delete", () => store.deleteFile(file.path));
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="pge-sidebar__actions">
            <button type="button" className="pge-btn" onClick={newFile}>
              New file
            </button>
          </div>
        </>
      ) : null}

      <p className="pge-sidebar__hint">Drop files here to upload.</p>
      {busy === undefined ? null : <p className="pge-sidebar__error">{busy}</p>}
    </aside>
  );
}
