/**
 * The left pane: the article's pages, then every file in the folder.
 *
 * The two lists answer different questions. The pages tree mirrors `article.yaml`'s `nav` — the
 * reader's table of contents, in the author's order. The file list is the folder as it actually is,
 * including snippets, media and pages that are not in the nav yet.
 *
 * Creating a page writes *both*: the file, and the nav entry that makes it reachable. That is the
 * whole point — a page nobody links to is not published, and asking an author to hand-edit YAML to
 * finish a "New page" would be a WYSIWYG editor with a gap in the middle. Deleting one takes the
 * nav entry with it, for the same reason.
 */
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import type { NavEntry } from "@pagina/core";
import { ChevronDown, FilePlus2, FolderPlus, Settings, Trash2, Upload } from "lucide-react";
import { ARTICLE_YAML, type ArticleStore } from "../store/index.js";
import { useStoreRevision } from "./useStore.js";
import { addNavEntry, navSections, removeNavEntry } from "./article-yaml.js";
import { ArticleSettings } from "./ArticleSettings.js";
import { HistoryPanel } from "./History.js";
import { slugify } from "./paths.js";

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

/** The "New page" form: a title, where the file goes, and which nav section it joins. */
function NewPageForm({
  sections,
  onCancel,
  onCreate,
}: {
  readonly sections: readonly string[];
  readonly onCancel: () => void;
  readonly onCreate: (input: { title: string; path: string; section: string }) => void;
}): ReactNode {
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [section, setSection] = useState("");
  // The path follows the title until the author touches it — the same bargain the figure builder
  // strikes with the scene id, and for the same reason.
  const [autoPath, setAutoPath] = useState(true);
  const effectivePath = (autoPath ? `${slugify(title)}.md` : path).trim();
  const ready = title.trim() !== "" && effectivePath !== ".md" && effectivePath !== "";

  return (
    <form
      className="pge-newpage"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onCreate({ title: title.trim(), path: effectivePath, section });
      }}
    >
      <label className="pge-field">
        <span>Title</span>
        <input className="pge-input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="pge-field">
        <span>File</span>
        <input
          className="pge-input"
          value={effectivePath}
          spellCheck={false}
          onChange={(e) => {
            setAutoPath(false);
            setPath(e.target.value);
          }}
        />
      </label>
      <label className="pge-field">
        <span>Section</span>
        <span className="pge-select-wrap" data-small="">
          <select className="pge-select pge-select--sm" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">Top level</option>
            {sections.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown className="pge-select-wrap__caret" size={12} aria-hidden="true" />
        </span>
      </label>
      <div className="pge-newpage__actions">
        <button type="button" className="pge-btn pge-btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="pge-btn pge-btn--sm pge-btn--primary" disabled={!ready}>
          Create
        </button>
      </div>
    </form>
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
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const files = store.list();
  const articleText = store.files.get(ARTICLE_YAML)?.text ?? "";
  const navPaths = new Set(store.navPages().map((entry) => entry.page));

  const guard = async (what: string, run: () => Promise<unknown>): Promise<void> => {
    setBusy(undefined);
    try {
      await run();
    } catch (e) {
      setBusy(`${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const createPage = ({ title, path, section }: { title: string; path: string; section: string }): void => {
    setCreating(false);
    void guard("Create", async () => {
      const name = path.endsWith(".md") ? path : `${path}.md`;
      await store.createFile(name, `# ${title}\n\n`);
      // After the file, so a nav entry never points at something that is not there yet.
      store.setText(ARTICLE_YAML, addNavEntry(articleText, { title, page: name, section: section === "" ? undefined : section }));
      onOpen(name);
    });
  };

  const deleteFile = (path: string): void => {
    const inNav = navPaths.has(path);
    const question = inNav ? `Delete ${path} and remove it from the nav?` : `Delete ${path}?`;
    if (globalThis.confirm?.(question) !== true) return;
    void guard("Delete", async () => {
      if (inNav) store.setText(ARTICLE_YAML, removeNavEntry(articleText, path));
      await store.deleteFile(path);
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
        <button
          type="button"
          className="pge-icon"
          title="Article settings"
          aria-label="Article settings"
          onClick={() => setSettings(true)}
        >
          <Settings size={14} aria-hidden="true" />
        </button>
      </div>

      {settings ? <ArticleSettings store={store} onClose={() => setSettings(false)} /> : null}

      <PagesTree entries={store.nav} current={current} onOpen={onOpen} />

      <div className="pge-sidebar__actions">
        <button type="button" className="pge-btn" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          <FilePlus2 size={14} aria-hidden="true" /> New page
        </button>
        <button type="button" className="pge-btn" onClick={() => fileInput.current?.click()}>
          <Upload size={14} aria-hidden="true" /> Upload
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

      {creating ? (
        <NewPageForm sections={navSections(articleText)} onCancel={() => setCreating(false)} onCreate={createPage} />
      ) : null}

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
                  onClick={() => deleteFile(file.path)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="pge-sidebar__actions">
            <button type="button" className="pge-btn" onClick={newFile}>
              <FolderPlus size={14} aria-hidden="true" /> New file
            </button>
          </div>
        </>
      ) : null}

      {/* Renders nothing at all when the backend keeps no log — an empty panel would say "nobody
          has edited this", which is a claim, not an absence. */}
      <HistoryPanel store={store} onOpen={onOpen} />

      <p className="pge-sidebar__hint">Drop files here to upload.</p>
      {busy === undefined ? null : <p className="pge-sidebar__error">{busy}</p>}
    </aside>
  );
}
