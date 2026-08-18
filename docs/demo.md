# Try the editor

Below is pagina's editor, running in this page. It is the same build a `pagina dev --edit` session
loads — the same document model, the same live preview, the same conflict handling. The only thing
swapped out is where the files live: instead of a folder on disk behind an HTTP contract, this one
writes to your browser's own storage through `LocalStorageBackend`.

Type something and reload the page; it will still be there. Edit it in two tabs at once and you will
get a conflict banner, because two tabs really are two writers.

!!! warning "What this demo is not"
    There is **no server**. Nothing you type leaves this browser, nothing is uploaded, and there is
    nothing to log into. There is **no publish target** — the *Publish* button renders the article
    and then has nowhere to send it. Your work lives in this browser's storage for this site only:
    clearing site data, or opening the page in a different browser or a private window, starts over.
    Browser storage holds about 5 MB in total, so uploads are capped at 512 KB each.

<div id="pagina-demo" style="width: max(100%, min(960px, calc(100vw - 3rem))); max-width: calc(100vw - 3rem); height: 660px; border: 1px solid var(--pg-line); border-radius: var(--pg-radius, 8px); overflow: hidden; background: var(--pg-bg-raised); margin: 1.5rem 0;"><div id="pagina-demo-placeholder" style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 2rem; text-align: center;"><strong style="font-family: var(--pg-font-display);">The editor is about 1.3 MB</strong><span style="color: var(--pg-muted); max-width: 46ch;">It is not loaded with the rest of this page, so nobody downloads a WYSIWYG editor to read the documentation. It starts on its own when you scroll it into view, or now:</span><button type="button" id="pagina-demo-start" style="font: inherit; padding: 0.5rem 1rem; border-radius: var(--pg-radius, 8px); border: 1px solid var(--pg-line-strong, var(--pg-line)); background: var(--pg-bg); color: var(--pg-fg); cursor: pointer;">Load the editor</button><span id="pagina-demo-status" style="color: var(--pg-muted); font-size: 0.85rem; min-height: 1.2em;"></span></div><div id="pagina-demo-mount" style="height: 100%; display: none;"></div></div>

<div id="pagina-demo-controls" style="display: none; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin: -0.5rem 0 1.5rem; font-size: 0.85rem; color: var(--pg-muted);"><button type="button" id="pagina-demo-reset" style="font: inherit; padding: 0.35rem 0.8rem; border-radius: var(--pg-radius, 8px); border: 1px solid var(--pg-line-strong, var(--pg-line)); background: var(--pg-bg); color: var(--pg-fg); cursor: pointer;">Reset the demo article</button><span id="pagina-demo-usage"></span></div>

<script type="module">
/*
 * The demo's whole implementation, inline on purpose.
 *
 * `rewriteLinks` in @pagina/core rewrites every relative href and src attribute in a page to
 * point at the article's assets, which is right for a page and wrong for a script that has to
 * reach a file the article does not contain. Assigning the properties from JavaScript, and
 * importing through `new URL(…, import.meta.url)`, keeps those attributes out of the markup
 * entirely. `import.meta.url` in an inline module is the document's own URL, so this resolves
 * correctly whether the page is served as `/pagina/demo/` or `/pagina/demo/index.html`, and
 * whether the site sits at a domain root or under a sub-path.
 */
const ROOT = new URL("../", import.meta.url);

const SEED = {
  "article.yaml": [
    "slug: demo",
    "title: A sample article",
    "form: docs",
    "status: published",
    "description: Three pages that live in your browser and nowhere else.",
    "",
    "nav:",
    "  - { title: Start here, page: index.md }",
    "  - { title: Things to try, page: guide/try.md }",
    "",
  ].join("\n"),
  "index.md": [
    "# A sample article",
    "",
    "This file is markdown, and the editor above is editing **the markdown itself** — there is no",
    "intermediate format. Whatever you build here is what a text editor would show you.",
    "",
    "!!! note \"This is an admonition\"",
    "    Click into it and type. It goes back to disk as three lines beginning !!! note.",
    "",
    "The pane on the right is the real renderer, not an approximation of it.",
    "",
  ].join("\n"),
  "guide/try.md": [
    "# Things to try",
    "",
    "1. Type a heading, then press / on an empty line to open the insert menu.",
    "2. Insert an admonition, a tabbed block, or a table.",
    "3. Reload the page. Everything is still here.",
    "4. Open this page in a second tab, edit the same file in both, and watch the conflict banner.",
    "5. Press Reset the demo article to throw it all away.",
    "",
    "## A tabbed block",
    "",
    "=== \"One\"",
    "",
    "    The first tab.",
    "",
    "=== \"Two\"",
    "",
    "    The second.",
    "",
  ].join("\n"),
};

const byId = (id) => document.getElementById(id);
const say = (text) => { const node = byId("pagina-demo-status"); if (node) node.textContent = text; };

let started = false;

async function start() {
  if (started) return;
  started = true;
  say("Loading the editor…");
  try {
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = new URL("editor/editor.css", ROOT).href;
    document.head.appendChild(sheet);

    const editor = await import(new URL("editor/editor.js", ROOT).href);

    if (!editor.hasLocalStorage()) {
      say("This browser will not let this page store anything — private browsing, or site data is blocked for this site. The editor has nowhere to save, so the demo stops here rather than losing what you type.");
      return;
    }

    const backend = new editor.LocalStorageBackend({ namespace: "pagina-docs-demo", seed: SEED });
    byId("pagina-demo-placeholder").style.display = "none";
    const mount = byId("pagina-demo-mount");
    mount.style.display = "block";
    editor.mountEditor(mount, { backend, page: "index.md", base: ROOT.pathname });

    const controls = byId("pagina-demo-controls");
    controls.style.display = "flex";
    const showUsage = () => {
      const used = backend.usage();
      byId("pagina-demo-usage").textContent =
        used.files + " files, " + (used.bytes / 1024).toFixed(1) + " KB in this browser";
    };
    showUsage();
    setInterval(showUsage, 2000);

    byId("pagina-demo-reset").addEventListener("click", async () => {
      if (!window.confirm("Throw away every change and put the sample article back?")) return;
      await backend.reset();
      window.location.reload();
    });
  } catch (error) {
    started = false;
    say("The editor did not load: " + (error && error.message ? error.message : String(error)));
  }
}

byId("pagina-demo-start").addEventListener("click", start);

if ("IntersectionObserver" in window) {
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      watcher.disconnect();
      start();
    }
  }, { rootMargin: "150px" });
  watcher.observe(byId("pagina-demo"));
}
</script>

## How this page works

The demo is not a special build. It is `mountEditor` with one option changed:

```js
import { LocalStorageBackend, mountEditor } from "@pagina/editor";

const backend = new LocalStorageBackend({ namespace: "pagina-docs-demo", seed: SEED });
mountEditor(document.getElementById("editor"), { backend, page: "index.md" });
```

`namespace` scopes every key, so this demo cannot collide with another article — or another
application — stored by the same site. `seed` writes only files that are *missing*, which is what
makes a reload keep your work rather than overwrite it every time the page loads; `reset()` puts the
sample back.

The 1.3 MB bundle is loaded on demand — a click, or an `IntersectionObserver` firing when this
section comes into view — so a reader who never scrolls this far never downloads it. Everything else
on this site is static HTML the way it always was.

The preview pane works because `@pagina/core` is pure: the same renderer that builds this site runs
in the browser. Figures hydrate on the site's own Kineglyph runtime, resolved through the import map
this page already carries.

## Two tabs, one article

Open this page in a second tab and edit the same file in both. The second tab's save carries a
version the first tab has already superseded, and you get a conflict banner offering *reload theirs*
or *overwrite with mine*.

That path is not decoration. `LocalStorageBackend` subscribes to the DOM `storage` event, which
fires in every tab *except* the one that wrote — precisely the signal the store's `changed` and
`deleted` handling was written for. Until this demo existed those two states had unit tests and no
other exercise at all.

## On a phone

Measured at a 390 px viewport rather than guessed, and the answer is *partly*.

**What works.** The three panes stack into one column, the text is full width and legible, typing
works, and the page does not scroll sideways. Nothing is broken and nothing is cut off.

**What does not.** The file list is hidden below 960 px, and there is no other way to reach it — so
you cannot switch pages, create one, or upload anything from a phone; you get the page the demo
opened and that is all. The toolbar wraps to three rows, and the demo's fixed 660 px frame is then
shared between the document and the preview, leaving each about 200 px tall. It is enough to write a
paragraph into and too cramped to work in.

The honest summary: **fine for a look, not for writing.** Fixing it properly means a responsive
single-pane layout with a pane switcher rather than a hidden sidebar, which is real work and has not
been done. It is written here rather than left for you to discover.

## Where to read more

[The editor page](editing.md) covers the document model, the three ways to mount the editor, the
`ArticleBackend` contract and all three of its implementations, and the known rough edges.
