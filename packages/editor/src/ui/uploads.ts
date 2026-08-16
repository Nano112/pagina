/**
 * What an uploaded file becomes in the document.
 *
 * One rule, in one place, because the three ways a file arrives — the toolbar button, a drop, a
 * paste — must not disagree about it. The decision is made on the *stored* path rather than on the
 * browser's reported MIME type: `File.type` is empty for a great many real files (anything dragged
 * out of a zip, most `.glb`s), while the extension the backend chose is always there.
 */
import type { Editor } from "@tiptap/core";
import type { ArticleStore } from "../store/index.js";
import { relativePath } from "./paths.js";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const MODEL = /\.(glb|gltf)$/i;

/** Uploads `file` and inserts the node its type calls for. Rejects with the backend's error. */
export async function uploadAndInsert(
  editor: Editor,
  store: ArticleStore,
  file: File,
  pagePath: string,
): Promise<void> {
  const result = await store.uploadFile(file);
  const href = relativePath(pagePath, result.path);
  const chain = editor.chain().focus();
  if (IMAGE.test(result.path)) chain.insertContent({ type: "image", attrs: { src: href, alt: file.name } }).run();
  else if (MODEL.test(result.path)) chain.insertContent({ type: "modelViewer", attrs: { src: href, alt: file.name } }).run();
  // Anything else is a download: a link is the only thing a markdown page can honestly do with it.
  else chain.insertContent(`[${file.name}](${href})`).run();
}
