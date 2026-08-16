/**
 * `<model-viewer>`: the real element, in the editor.
 *
 * Google's viewer is a custom element, so the honest preview is to load the module and let the
 * element render itself — which also means the editor and the published page fail the same way when
 * a `.glb` is missing, instead of the editor showing a happy placeholder over a broken page. The
 * module is fetched once per document (a module script is idempotent, but the `<script>` tag is
 * not) from a URL the host may override; nothing about it is bundled.
 *
 * The attribute panel covers the five that matter for documentation — `src`, `alt`, camera
 * controls, auto-rotate, poster, AR — and everything else the author wrote survives untouched in
 * the node's `attrs` JSON, which is where the parser put it.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Trash2, Upload } from "lucide-react";
import { useEditorConfig, usePagePath } from "../context.js";
import { useArticleStore } from "../useStore.js";
import { relativePath } from "../paths.js";

const swallowKeys = (event: KeyboardEvent): void => event.stopPropagation();

/** Attributes with their own control; everything else stays in the node's `attrs` JSON verbatim. */
const FLAGS = [
  { name: "camera-controls", label: "Camera controls" },
  { name: "auto-rotate", label: "Auto-rotate" },
  { name: "ar", label: "AR" },
] as const;

const loaded = new WeakMap<Document, string>();

/**
 * Adds the `<model-viewer>` module to the document once.
 *
 * Idempotent per document *and* per URL: a host that changes the URL between mounts gets the new
 * one, and a page with ten model nodes gets one script.
 */
export function loadModelViewer(url: string, doc: Document = document): void {
  if (loaded.get(doc) === url) return;
  const already = [...doc.querySelectorAll("script[data-pge-model-viewer]")].some(
    (script) => script.getAttribute("src") === url,
  );
  if (already) {
    loaded.set(doc, url);
    return;
  }
  const script = doc.createElement("script");
  script.type = "module";
  script.src = url;
  script.dataset["pgeModelViewer"] = "";
  doc.head.append(script);
  loaded.set(doc, url);
}

/** The node's `attrs` JSON as a map, tolerant of the string being absent or malformed. */
function extraAttrs(value: unknown): Record<string, string> {
  if (typeof value !== "string" || value === "") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** `{}` serialises back to "no extra attributes at all", i.e. the attribute is dropped. */
const packAttrs = (extra: Record<string, string>): string | null =>
  Object.keys(extra).length === 0 ? null : JSON.stringify(extra);

export function ModelViewerView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps): ReactNode {
  const store = useArticleStore();
  const pagePath = usePagePath();
  const { modelViewerUrl } = useEditorConfig();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const src = typeof node.attrs["src"] === "string" ? node.attrs["src"] : "";
  const alt = typeof node.attrs["alt"] === "string" ? node.attrs["alt"] : "";
  const extra = extraAttrs(node.attrs["attrs"]);

  useEffect(() => loadModelViewer(modelViewerUrl), [modelViewerUrl]);

  const setExtra = (name: string, value: string | undefined): void => {
    const next = { ...extra };
    if (value === undefined) delete next[name];
    else next[name] = value;
    updateAttributes({ attrs: packAttrs(next) });
  };

  const upload = (file: File): void => {
    setBusy(`Uploading ${file.name}…`);
    void store
      .uploadFile(file)
      .then((result) => {
        updateAttributes({ src: relativePath(pagePath, result.path), alt: alt === "" ? file.name : alt });
        setBusy(undefined);
      })
      .catch((e: unknown) => setBusy(`Upload failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  const remove = (): void => {
    const pos = getPos();
    if (pos === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  };

  return (
    <NodeViewWrapper className="pge-card pge-model" contentEditable={false} onKeyDown={swallowKeys}>
      <div className="pge-card__head">
        <span className="pge-card__badge">3D model</span>
        <span className="pge-card__title">{src === "" ? "(no source)" : src}</span>
        <span className="pge-card__spacer" />
        <button type="button" className="pge-btn pge-btn--sm" onClick={() => fileInput.current?.click()}>
          <Upload size={14} aria-hidden="true" /> Upload GLB
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file !== undefined) upload(file);
          }}
        />
        <button type="button" className="pge-icon" title="Remove model" aria-label="Remove model" onClick={remove}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      {src === "" ? (
        <p className="pge-card__note">Upload a .glb or point <code>src</code> at one.</p>
      ) : (
        // Not JSX-typed: `<model-viewer>` is a custom element, and teaching TypeScript's JSX about
        // it would mean depending on a package this bundle deliberately does not ship.
        <div
          className="pge-model__stage"
          dangerouslySetInnerHTML={{
            __html: `<model-viewer src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${Object.entries(extra)
              .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
              .join("")} style="width:100%;height:260px"></model-viewer>`,
          }}
        />
      )}

      <div className="pge-card__fields">
        <label className="pge-field">
          <span>src</span>
          <input className="pge-input" value={src} onChange={(e) => updateAttributes({ src: e.target.value })} />
        </label>
        <label className="pge-field">
          <span>alt</span>
          <input className="pge-input" value={alt} onChange={(e) => updateAttributes({ alt: e.target.value })} />
        </label>
        <label className="pge-field">
          <span>poster</span>
          <input
            className="pge-input"
            value={extra["poster"] ?? ""}
            placeholder="media/poster.webp"
            onChange={(e) => setExtra("poster", e.target.value === "" ? undefined : e.target.value)}
          />
        </label>
        {FLAGS.map((flag) => (
          <label className="pge-check" key={flag.name}>
            <input
              type="checkbox"
              checked={extra[flag.name] !== undefined}
              onChange={(e) => setExtra(flag.name, e.target.checked ? "" : undefined)}
            />
            {flag.label}
          </label>
        ))}
      </div>

      {busy === undefined ? null : <p className="pge-card__note">{busy}</p>}
    </NodeViewWrapper>
  );
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** The value of an HTML attribute written into a `"`-quoted slot. */
function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ESCAPES[c]!);
}
