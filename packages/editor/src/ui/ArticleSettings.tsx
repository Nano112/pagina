/**
 * Article settings: the metadata that belongs to the article rather than to any one page.
 *
 * Cover, description, author and tags are what a reader's *first* contact with an article is made
 * of — the index card, the link preview, the search result — and until now the only way to set any
 * of them was to hand-edit `article.yaml`, which is exactly the gap a WYSIWYG editor is not allowed
 * to have.
 *
 * Two things are load-bearing here:
 *
 *  - **It writes through `article-yaml.ts`**, the same comment-preserving document path "New page"
 *    uses. There is one YAML writer in this package and this is not a second one: a settings panel
 *    that re-serialised the file would delete its author's comments the first time anyone typed a
 *    description.
 *  - **The cover is a real upload.** It goes through `store.uploadFile`, lands in the folder like
 *    any other asset, and is recorded as a folder-relative path — which is what the renderer
 *    resolves and copies. Nothing here invents a URL.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageOff, Upload, X } from "lucide-react";
import { ARTICLE_YAML, type ArticleStore } from "../store/index.js";
import { readArticleFields, setArticleFields } from "./article-yaml.js";

export interface ArticleSettingsProps {
  readonly store: ArticleStore;
  readonly onClose: () => void;
}

/** `a, b , c` → `["a","b","c"]`, dropping blanks so a trailing comma is not a tag. */
const parseTags = (text: string): string[] => text.split(",").map((t) => t.trim()).filter((t) => t !== "");

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif",
};

/** The MIME type a blob built from `path`'s content needs in order to render in an `<img>`. */
const imageType = (path: string): string =>
  IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

export function ArticleSettings({ store, onClose }: ArticleSettingsProps): ReactNode {
  const yamlText = store.files.get(ARTICLE_YAML)?.text ?? "";
  const initial = readArticleFields(yamlText);
  const [cover, setCover] = useState(initial.cover);
  const [description, setDescription] = useState(initial.description);
  const [author, setAuthor] = useState(initial.author);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * The cover's preview URL.
   *
   * The store's mirror holds the file's *content*, not a URL, and a freshly uploaded cover may not
   * be reachable over HTTP from this page at all — so the preview is a blob URL built from the
   * mirror, and it is revoked when it is replaced. An absolute or site-absolute URL the author
   * typed is used as-is.
   *
   * The blob needs an explicit MIME type: an SVG (which the store mirrors as *text*, not bytes)
   * renders as a broken image in an `<img>` unless the blob says `image/svg+xml`, and the
   * extension the file was stored under is the only thing here that knows.
   */
  const [preview, setPreview] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (cover === "") {
      setPreview(undefined);
      return;
    }
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(cover)) {
      setPreview(cover);
      return;
    }
    let url: string | undefined;
    let cancelled = false;
    void store
      .open(cover)
      .then((state) => {
        if (cancelled) return;
        const body = (state.bytes ?? state.text) as BlobPart | undefined;
        if (body === undefined) {
          setPreview(undefined);
          return;
        }
        url = URL.createObjectURL(new Blob([body], { type: imageType(cover) }));
        setPreview(url);
      })
      .catch(() => { if (!cancelled) setPreview(undefined); });
    return () => {
      cancelled = true;
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [cover, store]);

  const pick = (list: FileList | null): void => {
    const file = list?.[0];
    if (file === undefined) return;
    setBusy(true);
    setError(undefined);
    void store
      .uploadFile(file)
      .then((result) => setCover(result.path))
      .catch((e: unknown) => setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setBusy(false));
  };

  const save = (): void => {
    // `null` removes the key; `""` from an emptied field means the same thing, and `setArticleFields`
    // treats the two alike so "clear the description" is not silently a no-op.
    store.setText(
      ARTICLE_YAML,
      setArticleFields(store.files.get(ARTICLE_YAML)?.text ?? yamlText, {
        cover: cover === "" ? null : cover,
        description: description === "" ? null : description,
        author: author === "" ? null : author,
        tags: parseTags(tags),
      }),
    );
    onClose();
  };

  return (
    <div className="pge-modal" role="dialog" aria-modal="true" aria-label="Article settings">
      <div className="pge-modal__panel pge-modal__panel--narrow">
        <header className="pge-modal__head">
          <h2 className="pge-modal__title">Article settings</h2>
          <span className="pge-modal__path">{ARTICLE_YAML}</span>
          <button type="button" className="pge-icon" title="Close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="pge-modal__body pge-settings">
          <div className="pge-field">
            <span className="pge-field__label">Cover image</span>
            <div className="pge-cover-pick">
              {preview === undefined ? (
                <div className="pge-cover-pick__empty">
                  <ImageOff size={18} aria-hidden="true" />
                  <span>No cover</span>
                </div>
              ) : (
                <img className="pge-cover-pick__img" src={preview} alt="" />
              )}
              <div className="pge-cover-pick__actions">
                <button type="button" className="pge-btn pge-btn--sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                  <Upload size={14} aria-hidden="true" /> {cover === "" ? "Upload" : "Replace"}
                </button>
                <button
                  type="button"
                  className="pge-btn pge-btn--sm"
                  disabled={cover === "" || busy}
                  onClick={() => setCover("")}
                >
                  Remove
                </button>
              </div>
            </div>
            <input
              className="pge-input"
              aria-label="Cover path"
              placeholder="media/cover.png"
              spellCheck={false}
              value={cover}
              onChange={(e) => setCover(e.target.value)}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <label className="pge-field">
            <span className="pge-field__label">Description</span>
            <textarea
              className="pge-textarea"
              rows={3}
              value={description}
              placeholder="One sentence, for search results and link previews."
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label className="pge-field">
            <span className="pge-field__label">Author</span>
            <input className="pge-input" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>

          <label className="pge-field">
            <span className="pge-field__label">Tags</span>
            <input
              className="pge-input"
              value={tags}
              placeholder="comma, separated"
              spellCheck={false}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>

          {error === undefined ? null : <p className="pge-settings__error">{error}</p>}
        </div>

        <footer className="pge-modal__foot">
          <button type="button" className="pge-btn pge-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pge-btn pge-btn--sm pge-btn--primary" disabled={busy} onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
