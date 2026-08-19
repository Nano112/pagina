---
description: >-
  pagina's editor, running in this page against your browser's own storage. No server, nothing
  uploaded, and the conflict banner two tabs get is real.
---

# Try the editor

Below is pagina's editor, running in this page. It is the same build a `pagina dev --edit` session
loads: the same document model, the same live preview, the same conflict handling. The only thing
swapped out is where the files live: instead of a folder on disk behind an HTTP contract, this one
writes to your browser's own storage through `LocalStorageBackend`.

Type something and reload the page; it will still be there. Edit it in two tabs at once and you will
get a conflict banner, because two tabs really are two writers.

!!! warning "What this demo is not"
    There is **no server**. Nothing you type leaves this browser, nothing is uploaded, and there is
    nothing to log into. *Publish* is real: it renders every page and every figure here, in this
    browser, and drops you into the reading view of what you wrote. What it renders is stored in
    this tab and shipped nowhere. Your work lives in this browser's storage for this site only:
    clearing site data, or opening the page in a different browser or a private window, starts over.
    Browser storage holds about 5 MB in total, so uploads are capped at 512 KB each.

<p id="pagina-demo-open"></p>

<div id="pagina-demo"></div>

<script type="module">
/*
 * The demo's bootstrap, and only its bootstrap.
 *
 * Everything it used to contain is now `packages/editor/src/demo.ts`, built to `<base>editor/demo.js`
 * — because an inline script is the one executable thing in this repository that eslint, `tsc` and
 * the test suites all skip, and this one had grown to a hundred lines of it.
 *
 * What has to stay here is URL resolution. `rewriteLinks` in @pagina/core rewrites every relative
 * href and src attribute in a page to point at the article's assets, which is right for a page and
 * wrong for a file the article does not contain. Importing through `new URL(…, import.meta.url)`
 * and assigning the link's `href` from JavaScript keeps those attributes out of the markup
 * entirely. `import.meta.url` in an inline module is the document's own URL, so this resolves
 * correctly whether the page is served as `/pagina/demo/` or `/pagina/demo/index.html`, and whether
 * the site sits at a domain root or under a sub-path.
 *
 * The full-screen link is built here rather than written as markup for the same reason, plus one
 * more: `<base>editor/` is not a page of this article, so the build's link checker is right to
 * reject an `href` pointing at it and there is nothing to check anyway — a link to an editor is
 * useless in a browser that did not run this script.
 */
const ROOT = new URL("../", import.meta.url);

const open = document.getElementById("pagina-demo-open");
const link = document.createElement("a");
link.className = "pgd__open";
link.href = new URL("editor/", ROOT).href;
link.textContent = "Open the full-screen editor →";
const note = document.createElement("span");
note.className = "pgd__open-note";
note.textContent =
  " The same article, the same browser storage, the whole viewport — which is how three panes are meant to be seen.";
open.append(link, note);

/*
 * `?as=Alice` names this tab. Open a second one as somebody else and the conflict banner names
 * them — which is the only way to see that on a page with no server to log into. A real host does
 * not read the author from a query string; it takes it from the session it authenticated.
 */
const as = new URL(location.href).searchParams.get("as");
const { startDemo } = await import(new URL("editor/demo.js", ROOT).href);
startDemo(document.getElementById("pagina-demo"), {
  ...(as === null || as.trim() === "" ? {} : { author: { id: `demo:${as}`, name: as } }),
});
</script>

## How this page works

The demo is `mountEditor` with one option changed:

```js
import { LocalStorageBackend, mountEditor } from "@pagina/editor";

const backend = new LocalStorageBackend({ namespace: "pagina-docs-demo", seed: SEED });
mountEditor(document.getElementById("editor"), { backend, page: "index.md" });
```

`namespace` scopes every key, so this demo cannot collide with another article, or another
application, stored by the same site. `seed` writes only files that are *missing*, which is what
makes a reload keep your work rather than overwrite it every time the page loads; `reset()` puts the
sample back.

The 1.3 MB bundle is loaded on demand (a click, or an `IntersectionObserver` firing when this
section comes into view), so a reader who never scrolls this far never downloads it. Everything else
on this site is static HTML the way it always was.

The preview pane works because `@pagina/core` is pure: the same renderer that builds this site runs
in the browser. Figures hydrate on the site's own Kineglyph runtime, resolved through the import map
this page already carries, and tab groups are made interactive by the same `wireTabs` the published
page uses — one implementation, three callers.

## Publish, with no server to publish to

Press *Publish* and the editor leaves. What you get back is the article, rendered by
`@pagina/core` with every Kineglyph figure drawn to SVG in light and dark, in this browser, as a
reader would see it, with a way back to the editor.

That is not a mock-up of publishing; it is publishing, minus the delivery. The rendered pages and
figures are handed to the backend exactly as they would be handed to a server, and
`LocalStorageBackend` keeps the payload in memory and persists only the timestamp, because a
rendered article is several times the size of its source and browser storage holds about 5 MB. A
host with a real backend sends the identical payload to `POST {base}/publish`.

## Two tabs, one article

Open this page in a second tab and edit the same file in both. The second tab's save carries a
version the first tab has already superseded, and you get a conflict banner offering *reload theirs*
or *overwrite with mine*.

That path is not decoration. `LocalStorageBackend` subscribes to the DOM `storage` event, which
fires in every tab *except* the one that wrote — precisely the signal the store's `changed` and
`deleted` handling was written for. Until this demo existed those two states had unit tests and no
other exercise at all.

## On a phone

Measured at a 390 px viewport rather than guessed.

The three panes stack into one column, the text is full width and legible, typing works, and the
page does not scroll sideways. The pages sidebar is not on screen below 900 px. Three panes on a
phone help nobody, so a floating **Pages** button takes its place: it opens the same list in a
modal, with the same New page, Upload and All files controls, and closes when you pick a page. Until
recently there was no such control and the list was simply unreachable, which meant you got the page
the demo opened and nothing else.

The full-screen editor is the better place to try any of this on a small screen: the inline frame
above shares its 656 px between a document and a preview, which is enough to write a paragraph into
and too cramped to work in.

## Wearing your own theme

The full-screen editor carries the same **Theme** panel the [theming page](theming.md#the-theme-lab)
does, in the corner. It is worth opening there rather than here, because the editor is the surface a
host worries about most: pick an accent and the toolbar, the pages sidebar, the document, the
callout you are editing and the preview beside it all move together. There is no second palette to
map — the editor's own `--pge-*` are pane widths and split positions, and every colour it draws is
the same `--pg-*` a published page reads.

It is not on this page's frame on purpose: a floating panel over a 660 px letterbox covers the thing
it is meant to be showing you.

## Where to read more

[The editor page](editing.md) covers the document model, the three ways to mount the editor, the
`ArticleBackend` contract and all three of its implementations, and the known rough edges.
