/**
 * The host page for `pagina dev --edit`: a document whose only content is `<pagina-editor>`.
 *
 * It deliberately mirrors the shell's `<head>` — same import map for `kineglyph`, same
 * `pagina.css` — so a figure previewed inside the editor is laid out exactly as it will be on
 * the page, and the editor's own stylesheet only has to dress the chrome around it.
 */
export interface EditPageContext {
  /** Where the HTTP contract is mounted; becomes `<pagina-editor backend-url>`. */
  readonly backendUrl: string;
  /** Folder-relative markdown path of the page being edited, e.g. `guide/tabs.md`. */
  readonly page: string;
  /** The site's base path, so the editor can resolve links and asset URLs like the shell does. */
  readonly base: string;
  /** Module URL the bare `kineglyph` specifier maps to — the same one the site's pages use. */
  readonly kineglyphRuntimeUrl: string;
  /** Module URL of `@pagina/editor`'s entry (a `/@fs` source path in dev, `dist/editor.js` built). */
  readonly editorEntryUrl: string;
  /** The site's stylesheet, for preview parity with the rendered page. */
  readonly siteCssUrl: string;
  /** The editor's own stylesheet, when the build has one. */
  readonly editorCssUrl?: string | undefined;
  /** Document title; defaults to the page path. */
  readonly title?: string | undefined;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);
/** Inside a raw-text `<script>`, HTML escapes are not decoded: JSON-escape and neutralise `</script`. */
const escInScript = (s: string): string => JSON.stringify(s).slice(1, -1).replace(/<\/script/gi, "<\\/script");

/** Renders the `/__edit/…` host document. */
export function renderEditPage(ctx: EditPageContext): string {
  const editorCss = ctx.editorCssUrl === undefined ? "" : `\n<link rel="stylesheet" href="${esc(ctx.editorCssUrl)}">`;
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(ctx.title ?? `Editing ${ctx.page}`)}</title>
<script>(function(){try{var t=localStorage.getItem("pagina-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<script type="importmap">{"imports":{"kineglyph":"${escInScript(ctx.kineglyphRuntimeUrl)}"}}</script>
<link rel="stylesheet" href="${esc(ctx.siteCssUrl)}">${editorCss}
</head>
<body class="pge-body">
<pagina-editor backend-url="${esc(ctx.backendUrl)}" page="${esc(ctx.page)}" base="${esc(ctx.base)}"></pagina-editor>
<script type="module" src="${esc(ctx.editorEntryUrl)}"></script>
<script type="module">import { defineElement } from "${escInScript(ctx.editorEntryUrl)}"; defineElement();</script>
</body></html>`;
}

/**
 * `/` → `index.md`, `/guide/tabs/` → `guide/tabs.md`.
 *
 * The mapping is derived rather than looked up in the manifest on purpose: `/__edit/` has to work
 * for a page that is not in `nav` yet — which is exactly the page you just created and want to
 * edit.
 */
export function pagePathForHref(href: string): string {
  const trimmed = href.replace(/^\/+|\/+$/g, "");
  if (trimmed === "" || trimmed === "index.html") return "index.md";
  const withoutIndex = trimmed.replace(/\/index\.html$/, "");
  return withoutIndex.endsWith(".md") ? withoutIndex : `${withoutIndex}.md`;
}
