# The editor

pagina ships a WYSIWYG editor for an article folder. It is a three-pane page: files on the left,
the document in the middle, the rendered page on the right. The thing worth understanding before
anything else is what it writes.

**It edits the markdown files themselves.** There is no editor-only document format, no database
row, no JSON block tree that markdown is exported from. Open `index.md` in the editor, type a word,
and `index.md` on disk gains that word and nothing else. Close the editor and the folder is exactly
the folder [described elsewhere on this site](article-folder.md), one you can `git diff`, hand to
someone with a text editor, and `pagina pack` without the editor ever having been involved.

That is a promise the design has to keep continuously, not a claim made once. The editor parses
with the *same* markdown-it instance the site renders with, so there is no second dialect that can
drift; the serializer writes the dialect back; and the round trip `markdown → document → markdown`
is asserted byte-for-byte over the fixture's pages, two pages of a real Nucleation reference, the
live demo's seed and a synthetic document for every node type (`packages/editor/test/roundtrip.test.ts`).
If a construct cannot survive that trip, the answer is to fix the serializer, not to store
something else.

!!! tip "There is a live one on this site"
    [Try the editor](demo.md) runs the real editor in your browser against browser storage. No
    server, no account, nothing to install.

## Turning it on locally

```sh
npx pagina dev docs --edit        # then open http://127.0.0.1:4321/__edit/
```

`--edit` mounts two things on the dev server: the HTTP contract below at `/__pagina/edit`, and a
host page at `/__edit/` whose entire content is `<pagina-editor>`. `/__edit/guide/tabs/` opens
`guide/tabs.md`. The path mapping is derived rather than looked up in `nav`, so a page you have
just created and not yet added to the nav is still reachable.

!!! danger "`--edit` makes the folder writable, with no authentication"
    Anyone who can reach the port can write any file in the article folder. It is off by default
    and inherits the dev server's loopback-only bind for that reason. Do not pass `--host` and
    `--edit` together on a network you do not control. A hosted backend must do its own
    authentication before a request reaches the contract.

## Mounting it somewhere else

Three forms, one implementation. Pick by what the host page already is.

=== "React"

    ```tsx
    import { PaginaEditor, ArticleStore, HttpBackend } from "@pagina/editor";
    import "@pagina/editor/editor.css";

    const store = new ArticleStore(new HttpBackend({ baseUrl: "/api/articles/my-slug" }));

    <PaginaEditor store={store} page="guide/tabs.md" theme="dark" />;
    ```

    Props: `store` (required), `page` (default `index.md`), `theme`, `modelViewerUrl`, and
    `onReady(open)`, which hands back a function for opening another page.

=== "`mountEditor`"

    ```js
    import { mountEditor } from "@pagina/editor";

    const editor = mountEditor(document.getElementById("editor"), {
      backendUrl: "/api/articles/my-slug",
      page: "index.md",
    });

    editor.open("guide/tabs.md");
    await editor.publish();
    editor.destroy();
    ```

    `EditorOptions`: `backend` (an already-built `ArticleBackend`, which wins over `backendUrl`),
    `backendUrl`, `headers` (sent on every request: CSRF, `Authorization`), `page`, `base`,
    `theme`, `modelViewerUrl`. The handle exposes `store`, `open`, `publish`, `destroy`.

=== "`<pagina-editor>`"

    ```html
    <script type="importmap">{"imports":{"kineglyph":"/assets/kineglyph.js"}}</script>
    <link rel="stylesheet" href="/assets/editor.css">
    <script type="module">
      import { defineElement } from "/assets/editor.js";
      defineElement();
    </script>

    <pagina-editor backend-url="/api/articles/my-slug" page="index.md" base="/"></pagina-editor>
    ```

    Attributes: `backend-url`, `page`, `base`, `theme`, `model-viewer-url`, `headers` (JSON). The
    element exposes `.store`, `.open(path)` and `.publish()`, so a Blade or Livewire template can
    drive it without importing anything. This is the form `pagina dev --edit` uses. For a plain
    `<script>` tag rather than a module, `dist/editor.iife.js` defines the global `Pagina`.

!!! warning "`kineglyph` is deliberately not bundled"
    Figures in the preview must hydrate on the *same* runtime instance the site's own pages use, so
    the host page's import map decides what the bare `kineglyph` specifier resolves to. A host with
    neither an import map nor a bundler alias will see figure nodes report *Failed to resolve module
    specifier*, a configuration requirement rather than a bug. React *is* bundled: a host page must not
    have to install it.

## What the document is made of

Everything below is a node in the editor's schema and a construct in the dialect. The right-hand
column is what the serializer writes; it is what you would have typed by hand.

| In the editor | Written to markdown |
| --- | --- |
| Headings, paragraphs, lists, quotes, tables, rules | CommonMark, with pagina's heading ids and per-cell table alignment preserved |
| Bold / italic / code / link / strikethrough | CommonMark |
| Text colour, highlight | `<span style="color:…">`, `<mark>` |
| Admonition | `!!! note "Title"`, or `???` when collapsible, indented body |
| Tabs | `=== "Label"`, indented body per tab |
| Snippet include | `--8<-- "path"` or `--8<-- "path:region"` |
| Kineglyph figure | `<figure class="kg" data-scene="scenes/x.mjs">…</figure>`, or an inline `<script type="text/kineglyph">` |
| Captioned image | `<figure markdown="span">` with an image and a `<figcaption>` |
| Image | `![alt](src)` |
| 3D model | `<model-viewer src="media/x.glb" …>` |
| Raw HTML block | itself, verbatim |

Two details are worth calling out because they are what makes the round trip byte-exact rather than
merely equivalent. A figure that came from a file is written back with **the author's own attribute
order, quoting and spacing**; only a figure the UI created falls back to a fixed order. And an
admonition whose title is just the capitalised kind, `!!! note "Note"`, is written back without
the title, because core supplies that default and writing it would be noise the author did not put
there.

A tab group's controls sit on the tabs themselves: double-click a tab to rename it, and each tab
carries its own delete, because a group control acting on "whichever tab is selected" is a control whose
effect you have to remember rather than see. Delete or Backspace on the strip does the same thing
without a pointer. **Deleting the last remaining tab removes the whole group**, because a tabs node
with no children cannot exist and refusing left the control on a one-tab group doing nothing; it is
one undo away.

A `/` at the start of an empty block opens the slash menu, which is the fastest route to all of the
above. Images and files can also be dropped or pasted in; the extension of the stored path decides
what the document gets: an image node, a `<model-viewer>`, or a link.

### The Figure Builder

Kineglyph scenes are JavaScript modules, which is right for the scenes that need it and a wall for
everyone else. The Figure Builder is a form over Kineglyph's `SimpleSceneSpec` (title, description,
a list of nodes — heading, caption, code, box, stack, row — and the edges between them) with the real
Kineglyph runtime rendering a live preview beside it.

Saving writes a sibling module `scenes/<id>.mjs` containing `export default sceneFromSpec({…})` and
a `// pagina:spec` marker. The marker is how the builder recognises a module as one it wrote and can
re-open. It is a real scene file: nothing in the built site knows the difference between a scene the
builder wrote and one typed by hand.

!!! note "The builder covers `SimpleSceneSpec`, and only that"
    No images, icons, badges, grids or machines. A scene using any of them stays hand-authored, and
    the builder **refuses to open it** rather than flattening what it cannot express; you get a
    source editor instead. This is deliberate: silently dropping the parts of a figure a form cannot
    represent would be worse than declining.

## The backend contract

The UI talks only to `ArticleStore`. The store talks only to an `ArticleBackend`. Nothing under
`src/ui` or `src/store` imports `node:*` or Vite, which is what lets the same editor run against a
dev server, a Laravel application, browser storage, or a test double.

```ts
--8<-- "packages/editor/src/store/types.ts:contract"
```

### The three implementations

| | Use it when | Persistence | Conflicts | Cross-tab |
| --- | --- | --- | --- | --- |
| `MemoryBackend` | tests, and a demo that should start clean every time | none, gone on reload | yes, versions are content hashes | `emit()`, driven by the test |
| `LocalStorageBackend` | offline, a static site, a browser-only demo | `localStorage`, survives reload | yes, versions are a monotonic counter | yes, over the DOM `storage` event |
| `HttpBackend` | anything with a server | whatever the server does | yes, `409` from `If-Match` | SSE, where the server offers `GET {base}/events` |

`HttpBackend` implements the JSON REST contract specified in
[the connectivity design note](https://github.com/Nano112/pagina/blob/main/docs/design/2026-08-17-editor-connectivity-laravel.md)
: `GET/PUT {base}/files/{path}` with `If-Match`, `POST {base}/upload|rename|publish`, SSE at
`{base}/events`. `pagina dev --edit` implements the server half at `/__pagina/edit`; the Laravel
package is meant to be the other implementation of the same endpoints. That document is the
specification; this page will not restate it and risk disagreeing with it.

All three are checked by **one parametrised suite** (`packages/editor/test/backend-contract.ts`) run
against all of them, `HttpBackend` included, over an in-process implementation of the HTTP contract
rather than response stubs. Three implementations of one interface with three separate test suites
is exactly the arrangement in which they quietly stop agreeing.

### `LocalStorageBackend`

```js
import { LocalStorageBackend, mountEditor } from "@pagina/editor";

const backend = new LocalStorageBackend({
  namespace: "my-article",              // keys are scoped to this; two articles cannot collide
  seed: { "article.yaml": "…", "index.md": "# Hello\n" },
});

mountEditor(document.getElementById("editor"), { backend });

await backend.reset();                  // back to the seed
backend.usage();                        // { files, bytes } — what this article costs the browser
```

Seeding writes only what is *missing*, which is the only behaviour that survives a reload: a host
page runs on every load, and overwriting there would delete the author's work each time they came
back. `reset()` re-applies the seed, overwriting.

Three things about it are decisions rather than accidents, and each has a cost worth knowing:

- **Versions are a monotonic counter, not a content hash.** Rewriting identical bytes still moves
  the version, so a second tab's stale save conflicts even when the text happens to match, and a
  version is never reused, so a stale one cannot accidentally match a file that was deleted and
  recreated under the same path. The counter deliberately survives `reset()`.
- **Uploads are base64 in the same store, capped at 512 KB by default.** `localStorage` holds only
  strings and only about 5 MB for the whole origin, and base64 costs a third on top. IndexedDB would
  hold far more and was rejected: it would split the article across two stores with two notions of
  "current", and, the deciding point, IndexedDB has no cross-tab event, so a second tab would see
  text changes and miss uploads. Above the cap you get a `413` with a message that says why, not a
  truncated file.
- **A full store is a `StorageQuotaError`, never an unhandled throw.** `setItem` takes the whole
  value or none of it, so the previous contents survive and the text is still in the editor; the
  message says so and says what to free.

`publish()` is accepted and the payload kept in memory, but only the timestamp is persisted, because a
rendered article is precisely the thing that would fill the 5 MB and take the author's source down
with it. There is no publish *target* in a browser store either way.

## The optimistic store, versions, and conflicts

An edit applies to the local mirror immediately. The file is marked dirty, a write is queued behind
a 500 ms debounce, and it is sent with `If-Match: <the version we last read>`. Nothing blocks on the
network, and nothing is ever silently overwritten.

A version is per file and comes from the backend: a content hash on the HTTP servers, a counter in
browser storage. The store never invents one.

A file can be in five states: `saved`, `dirty`, `saving`, `error` (retried with backoff), and
`conflict`. A conflict arrives in one of two shapes and stops the write queue for that file:

- **`changed`**: a `409`, or a subscription event saying the file moved under us. The banner offers
  *reload theirs* or *overwrite with mine*. A `409` carries `{ theirs, version }`, so "theirs" can be
  shown without a second round trip.
- **`deleted`**: the file is gone on the other side. *Theirs* accepts the deletion; *mine* writes
  the local text back as a new file.

Two browser tabs on the same `LocalStorageBackend` namespace reach both states for real, which is
why the demo is worth having: until it existed, those code paths had unit tests and nothing else.

## Publishing

`publish()` renders every page through `@pagina/core` *and* every figure to light and dark SVG on
the host page's Kineglyph runtime, then sends manifest, pages and figures as one payload. A host
that stores it can serve the article without running Node: the same output `pagina build` produces,
which is the point of it going through core rather than through a second renderer.

A host page with no import map for `kineglyph` publishes pages whose figures hydrate client-side
instead of carrying SVG. That is a degradation, not a failure, and it is silent. Worth checking
once on any new host.

`publish()` resolves to `{ publishedAt, article }`: the timestamp *and* the rendered article, pages
and inlined figures included, exactly as the backend received them. It is returned rather than
discarded because a caller nearly always wants to show it, and re-rendering to do so would be a
second answer to a question already answered.

The editor's own **Publish** button uses it that way: it saves, renders, ships, and then leaves the
editor for a reading view of what was just published, with the article's nav and one control back.
That is worth the space it takes because the alternative, a control that does real work and changes
nothing on screen, is indistinguishable from a control that does nothing, which is how it read
before. It is also the clearest statement of the architecture: the client rendered that page, so
there is a reading view even where there is no server. Try it on [the demo](demo.md), which has no
publish target at all.

## Known rough edges

Stated plainly, because finding these written down is more use than discovering them.

**In the editor**

- **No page rename** from the sidebar: create and delete only. No undo across files, and no
  search.
- **No presence and no locking.** A subscription tells you a file changed; it does not tell you who
  is editing it. Conflict detection is the whole of the multi-user story.
- **The self-write window is time-based.** A host with live reload must not reload the editor over
  the editor's own saves; `@pagina/editor` announces every successful mutation through
  `window.__paginaSelfWrite(path, ts)` and `pagina dev --edit` drops an HMR `full-reload` landing
  within 2 s of one. The consequence is that a *genuine* external change to the same file inside
  those 2 s is missed by the editing tab, and by no other tab.
- **Containment in the dev middleware is a check-then-use.** A symlink inside the folder is resolved
  and rejected at check time; one swapped between the check and the write is not defended against.
  Accepted rather than fixed: the folder is trusted content, and an attacker who could do it already
  has write access to the folder.
- **The Playwright lane is a smoke test, not coverage.** Two specs over a real `pagina dev --edit`.

**In pagina itself, met while writing these pages**

- **A page cannot `--8<--` its own `article.yaml`.** The build succeeds and `pagina pack` then fails
  with `[bundle-collision] two different files both want to be article.yaml in the bundle`, because `pack`
  rewrites the bundled config while the snippet machinery adds the original at the same bundle path.
  They are the same file, and the message says otherwise. The workaround on
  [the article folder page](article-folder.md) is to reach it through the repository root instead.
- **Inline markdown is not processed inside a `<figure>`.** Backticks in a `<figcaption>` are
  published as literal backticks, with no diagnostic; `markdown="span"` is neither honoured nor
  stripped there. Write `<code>` in a caption.
- **A code block is rewritten like the rest of the page.** `rewriteLinks` runs over the whole
  rendered HTML, so a relative `href=` or `src=` inside a fenced sample is base-prefixed *and*
  counted as an asset the article must carry. A quoted `<a href="./guide/">` therefore fails
  `pack` with `bundle-asset-missing`, and a template placeholder in one fails it naming the shiki
  markup that split it. Site-absolute values (`/assets/…`) are left alone, which is the workaround;
  `examples/node-host/server.mjs` builds its attributes through a helper for this reason.
- **A scene-spec error is reported against a generated id**, not the author's: `kg-theming-1` rather
  than the scene's own `id` or its file name. With several figures on a page you are counting
  `<figure>` elements to find the broken one. The message itself is good; only the subject is wrong.

**When the editor is narrow**

The layout follows the *editor's* width, not the window's: it is a component, and pagina's own docs
demo is a 656 px frame in a 1180 px page, where a media query reports a comfortable desktop and the
document pane gets one word per line. Below 900 px of its own width the three panes stack into one
column and the pages sidebar is replaced by a floating **Pages** button that opens the same list
(tree, New page, Upload, All files) in a modal, with Escape, a focus trap and focus returned to the
button. Before that the list was simply hidden and none of it was reachable.

The toolbar still wraps to several rows at 390 px, and an inline frame then has little height left
for the document. See [the demo page](demo.md), measured at 390 px rather than guessed, and prefer
the full-screen editor it links to on a small screen.
