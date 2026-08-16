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

/** How long after one of its own writes the editor page ignores a `full-reload`. */
export const SELF_WRITE_WINDOW_MS = 2000;

/**
 * The self-write guard: why `/__edit/` does not reload itself.
 *
 * The dev server broadcasts `full-reload` over the HMR socket whenever a file in the article
 * folder changes, which is right for every reader's tab and wrong for exactly one client — the
 * editor, whose own save is what changed the file, and which would lose everything typed since.
 * The server cannot tell the sockets apart, so the decision belongs on the client, where the
 * identity actually is: the editor announces its writes through `window.__paginaSelfWrite`
 * (`@pagina/editor`'s `noteSelfWrite`) and this script drops a `full-reload` frame that lands
 * inside the window. Every other client still reloads, because the broadcast still goes to all.
 *
 * It filters the *socket*, not Vite's client object, for two reasons. Vite exposes
 * `vite:beforeFullReload` but no supported way to cancel from it (the only lever is mutating the
 * payload's `path`, an internal detail). And the client is a module: by the time any module script
 * on this page could run, it has already connected. A classic inline script in `<head>` runs
 * during parsing, before every deferred module, and the only thing it has to know is the wire
 * shape `{"type":"full-reload"}` — which is the frame this repo's own dev server writes by hand.
 *
 * Degrading is safe in the direction that matters: if the frame or the socket ever stops matching,
 * suppression simply stops happening and the editor reloads, which is where it started.
 */
const selfWriteGuard = (windowMs: number): string => `(function(){
var W=${String(windowMs)},last=0,paths=Object.create(null);
window.__paginaSelfWrite=function(p,at){last=typeof at==="number"?at:Date.now();paths[p]=last;};
window.__paginaWroteRecently=function(){return last!==0&&Date.now()-last<=W;};
var S=window.WebSocket;
if(typeof S!=="function"||!S.prototype||typeof S.prototype.addEventListener!=="function")return;
function isReload(d){
if(typeof d!=="string"||d.indexOf("full-reload")===-1)return false;
try{return JSON.parse(d).type==="full-reload";}catch(e){return false;}
}
var wrapped=new WeakMap();
function wrap(fn){
var w=wrapped.get(fn);
if(w===undefined){
w=function(ev){if(isReload(ev&&ev.data)&&window.__paginaWroteRecently())return undefined;return fn.apply(this,arguments);};
wrapped.set(fn,w);
}
return w;
}
var add=S.prototype.addEventListener,remove=S.prototype.removeEventListener;
S.prototype.addEventListener=function(type,listener,options){
return add.call(this,type,type==="message"&&typeof listener==="function"?wrap(listener):listener,options);
};
if(typeof remove==="function")S.prototype.removeEventListener=function(type,listener,options){
return remove.call(this,type,type==="message"&&typeof listener==="function"?wrap(listener):listener,options);
};
})();`;

/** The guard exactly as the page carries it — the unit test runs this string. */
export const SELF_WRITE_GUARD = selfWriteGuard(SELF_WRITE_WINDOW_MS);

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
<script>${SELF_WRITE_GUARD}</script>
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
