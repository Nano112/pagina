---
title: Search
description: >-
  An index built where the article is rendered and queried in the browser, section by section, with
  no server and nothing to run at read time.
---

# Search — an index, not a service

Press <kbd>/</kbd> on any page of this site. The box that opens is the subject of this page, and
everything in it is answered by one file — `_pagina/search.json` — that this build wrote and your
browser fetched the moment you pressed the key, and not one moment before.

That is the whole design, and the two halves of it are the two constraints pagina works under.
There is **no server**: both real deployments of pagina are static files, one on GitHub Pages and
one inside a Laravel host serving stored HTML off a disk, and neither can run a query. And there is
**no free weight**: an editor bundle is already 1.3 MB and every figure ships four variants, so a
feature most readers of most pages never touch has to cost them almost nothing.

## What a search result is

A result is a **section**, not a page.

This matters more than any amount of ranking cleverness. A docs page is a list of topics; a result
that says only *Theming* has told a reader nothing the sidebar had not already told them. So
everything under one `##` or `###` — up to the next one — is indexed as its own document, with its
own anchor, and a result lands on the passage rather than at the top of a page for the reader to
scroll.

Each result shows three things, which is what it takes to choose between ten of them:

| | |
|---|---|
| the kicker | which page, and which section of it |
| the title | the heading, with the matched words marked |
| the snippet | ~140 characters of the section around the match, marked the same way |

Two of pagina's own facts feed that, and neither is available to a search tool bolted onto built
HTML afterwards. The **resolved description** the manifest already carries becomes the text under a
page's lead result. And a figure's `<title>` and `<desc>` — what the author wrote *about a diagram*
— are indexed, and a result that came from one is labelled `diagram`. A picture is often the
clearest thing on a page and the one part of it that plain text indexing cannot see at all.

## Keys, and what happens without them

| | |
|---|---|
| <kbd>/</kbd> | open — unless you are already typing in a field, where a slash is a slash |
| <kbd>⌘</kbd><kbd>K</kbd> / <kbd>Ctrl</kbd><kbd>K</kbd> | open, from anywhere |
| <kbd>↑</kbd> <kbd>↓</kbd> | move through results |
| <kbd>↵</kbd> | open the result; with <kbd>⌘</kbd> or <kbd>Ctrl</kbd>, in a new tab |
| <kbd>esc</kbd> | close, and put focus back where it was |

The dialog is `role="dialog" aria-modal="true"`, labelled, and traps Tab. Results are a
`role="listbox"` the input owns through `aria-activedescendant`, so a screen reader announces the
active result without focus ever leaving the box you are typing in. The result count is a polite
live region.

!!! note "The button is rendered disabled on purpose"

    The trigger in the header ships as `<button disabled title="Search needs JavaScript">`, and the
    client bundle enables it. With scripting off — or with the bundle blocked, or still in flight —
    you get a control that is visibly inert and says why, rather than a box that swallows a
    question. If the index itself fails to fetch, the dialog opens onto the reason and a **Try
    again**, not an empty list that reads like "no results".

## What it weighs

Numbers from this site's own build, and from a 29-page Nucleation reference — about 1 MB of
markdown, the largest article pagina has been pointed at.

**On every page, whether or not anyone searches:**

| | raw | gzip |
|---|---|---|
| the wiring in `pagina.js` (one listener, one dynamic import) | 805 B | 308 B |
| the dialog's styles in `pagina.css` | 4.1 kB | 762 B |

**On the first search of a session, and never again:**

| | raw | gzip |
|---|---|---|
| the dialog itself, a separate chunk | 11.9 kB | 4.2 kB |
| `search.json`, this site — 9 pages, 87 sections | ~116 kB | ~38 kB |
| `search.json`, Nucleation — 29 pages, 687 sections | 602 kB | 188 kB |

Parsing the 29-page index takes **1.9 ms**; a query against it runs in **0.1–2.2 ms** (the slow end
is a two-letter prefix, which matches nearly everything). The index is a plain static file with
whatever cache headers the host sets, so a returning reader pays nothing.

Two decisions did most of that. The index stores **at most 700 characters** of each section for
snippets while indexing every word of it for matching — recall is complete, and a match past the
700th character is simply shown with the section's opening lines instead of the matching sentence.
And **code blocks are indexed but never quoted back**: an API name in a `pre` is exactly what people
search for, but three lines of somebody's `let mut schematic = …` is not how anyone chooses between
results, and on a code-heavy reference the code was 46% of the index by weight.

If an article ever outgrows this, the honest answer is [Pagefind](https://pagefind.app), not a
bigger version of this — see below.

## Using it from a host

The index is not tied to pagina's shell. Two facts are the whole contract:

- a build writes **`_pagina/search.json`**, and `pagina pack` puts the same bytes at
  **`.rendered/search.json`** inside the bundle, beside `.rendered/manifest.json`;
- a page turns search on by carrying two attributes on `<html>`:

```html
<html data-pg-search="/docs/search.json" data-pg-base="/docs/">
```

`data-pg-search` is where the index is; `data-pg-base` is the prefix to put in front of the hrefs
inside it, which are stored without one so a single index works at any mount point. Load
`pagina.js` (or wire your own control) and anything carrying `data-pg-search-open` becomes a
trigger — its `disabled` attribute is removed for you.

For **`pagina/laravel`**, that is: serve `.rendered/search.json` from the article's disk on a route
of your own, and add the two attributes in the layout beside the ones the Blade view already
writes. Nothing is rebuilt and no PHP indexer exists to drift from this one — the file in the
bundle was produced by the same renderer that produced the pages next to it.

A host that indexes its own whole site instead should turn pagina's off rather than show two boxes:

```sh
pagina build docs --out dist --no-search
```

No `search.json` is written and no page mentions search. The dialog's chunk is still emitted into
`_pagina/` — it is a code-split point in the client bundle, not a conditional one — but nothing
ever asks for it, so it costs a file on disk and not a byte on the wire.

## Why this and not something else

pagina has written its own code before when the alternative was a dependency that did not fit —
its ZIP codec, for one. This is the same judgement, and it went like this.

**[Pagefind](https://pagefind.app) is the right tool for a big static site, and pagina is not one
yet.** It chunks its index so a thousand-page manual answers a query with one small fetch, which is
genuinely better than what is here — above a few hundred pages, decisively so. But it is a platform
binary that post-processes *a directory of built HTML*, and pagina's output is not always a
directory: the Laravel package serves fragments out of a bundle, and a post-processor pointed at a
folder cannot see them. Adopting it would also mean a second build tool with its own idea of what a
page is, its own place for exclusions to be applied, and its own runtime — ~40 kB of WASM before
any index — for a corpus where the whole index here is 38 kB. **The escape hatch is real, though:
if an article grows past the point where one file is sensible, run Pagefind over `dist/` and point
`data-pg-search` somewhere else. Nothing about the shell assumes this implementation.**

**MiniSearch or Lunr would have saved less than it looks.** The hard part of docs search is not the
inverted index; it is deciding what a document *is*, extracting text from rendered HTML without
dragging in `svg` path data, cutting a readable snippet, and marking whole words rather than the
prefix someone typed. All of that is written here either way. What a library would have added is a
serialised index larger than this one and its runtime in the reading bundle; what it would have
removed is about 150 lines, of which the interesting ones are the tokeniser and the scoring — the
two things most worth being able to read.

**So: a hand-rolled index, no new build dependency.** It is roughly 500 lines in
`@pagina/core/search`, split so that a browser importing it gets only the query half — the builder,
the HTML extraction and the tokeniser's indexing path are tree-shaken away, which is why the chunk
is 4 kB gzipped and not 190.

## How it ranks

Not cleverly, and on purpose. Every token must match — two words narrow a search, they do not widen
it — and the last token is matched as a prefix, because you are probably still typing it. A match is
then worth more in a section heading than in a page title, more in a page title than in the body,
and a whole-word match beats a prefix. The whole query appearing as a phrase adds a bonus, an `h2`
outranks an `h3`, and nav order breaks ties towards the front of the article.

That is the entire model. It fits on this screen, which is the point: when a result is wrong, the
reason is readable.
