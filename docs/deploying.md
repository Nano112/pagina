# Deploying: sub-paths, two homes, and which copy counts

[Install](install.md#publish-to-github-pages) has the short version: one `--site-url`, one
workflow, done. This page is what to do when that is not enough.

One article, more than one address. That is the situation it is about: the same folder
published at `https://schemat.io/…` by a CMS **and** at `https://user.github.io/Project/` by a
static build, from the same source. Everything below follows from those two facts: the site is not
at the root of its origin, and it is not the only copy.

## Where the site is going is an input to the build

`--site-url` takes the **full deployment URL, path and all**:

```sh
pagina build docs --site-url https://schem-at.github.io/Nucleation/
```

The path becomes `base`, so one flag produces both correct asset URLs and a correct
`link rel=canonical`. `--base` may still be given on its own, and giving both is fine as long as
they agree, and a disagreement is a usage error rather than a coin toss.

This is deliberately a *flag* rather than something read from `article.yaml`. A folder with two
homes cannot carry one deployment URL: whichever it named would be wrong in the other place, and
wrong silently.

### The trap this replaces

The SEO layer uses only the **origin** of a site URL, because the paths pagina generates already
carry `base`. So before this, writing the deployment URL into `article.yaml`:

```yaml
site_url: https://schem-at.github.io/Nucleation/
```

and building without `--base` produced `<link rel="canonical" href="https://schem-at.github.io/">`
, an origin root that belongs to a different site, on every page, with nothing in the output to
suggest anything was wrong. That configuration is now a build warning
(`seo-site-url-path-ignored`) naming the `--base` that would fix it. An origin-only `site_url` plus
`--base` remains correct and silent; it is only the *dropped path* that warns.

## `robots.txt` cannot be moved, and pagina no longer pretends otherwise

`robots.txt` is fetched from `/robots.txt` at the origin root and from nowhere else. A build under
`--base /Project/` would put it at `/Project/robots.txt`, which no crawler will ever request.

**Ruling: a sub-path build writes no `robots.txt`.** It prints one line saying why, and, when
there is a sitemap, the exact `Sitemap:` line to add to whatever *does* serve the origin root:

```
pagina: no robots.txt was written: this site is served at "/Nucleation/", and crawlers read
robots.txt only from the origin root, which a sub-path deployment does not own. Every page carries
its own robots meta tag regardless. Add this line to the root robots.txt:
Sitemap: https://schem-at.github.io/Nucleation/sitemap.xml
```

Programmatically that is `buildStatic`'s `robots` result (`outPath`, `rootSitemapLine`, `reason`).

Two things this is careful about:

- It is **not a diagnostic**. Nothing in the folder is wrong and no edit to it could help, so it
  must not fail a strict build, and a warning nobody can act on is how people learn to skim
  warnings. A CI job that fails on any diagnostic (the recommended setting) stays green.
- Nothing is lost. `noindex`, the thing a draft article actually depends on, is a `<meta>` tag in
  every page's `<head>`, read wherever the page is served. `robots.txt` was never carrying it.

`sitemap.xml` is the opposite case and **stays where it is**, at `<base>sitemap.xml`. A sitemap may
list any URL at or below its own directory, and that set is exactly what a sub-path deployment
owns. It is discoverable via the root `robots.txt` line above, or by submitting it directly.

## A mirror says which copy counts

Two public copies of one article compete in search results, and which one wins is then decided by
a crawler's heuristics rather than by the author. `--mirror-of` settles it:

```sh
pagina build docs \
  --site-url https://schem-at.github.io/Nucleation/ \
  --mirror-of https://schemat.io/docs/nucleation/
```

Every page's `link rel=canonical` and `og:url` then address the **primary's** URL for that same
page, and no `sitemap.xml` is written, because submitting the mirror's own URLs for indexing would argue
with every page's own `<head>`. The mirror keeps its own `og:image`, which is right: that image has
to be fetchable from where the page is served.

### Why a cross-origin canonical, and not `noindex`

Both are honest answers. The canonical is the better one, for three reasons:

1. **`noindex` and canonical are alternatives, not a pair.** A crawler told not to index a page has
   no reason to read it, so a `noindex` mirror can never point anywhere: its signal is discarded
   rather than transferred. A canonical consolidates the mirror's ranking signal onto the primary.
2. **The mirror stays useful to people.** A link to the Pages copy in an issue, a README or a chat
   still opens a real, readable page, and still resolves if the primary is down. `noindex` does not
   change that, but it does mean the mirror can never be *found*, including by someone
   deliberately looking for the repository's own copy.
3. **It is reversible and it is a build flag.** Which copy is primary is a deployment decision, and
   deciding it in the deploy command means flipping it costs one line, in the place that already
   knows where this build is going.

`noindex` remains available per page (`noindex: true` in front matter) and per article (a `draft`
status), for the cases where a copy genuinely should not be found at all.

**When *not* to set it:** if the primary does not serve the article yet, a canonical pointing at it
is a canonical pointing at a 404. Deploy the mirror without `--mirror-of` until the primary is
live, then turn it on.

## Every build writes a 404

`pagina build` emits `<base>404.html` alongside the pages, always and without configuration. GitHub
Pages serves it for any address that matches nothing; Netlify, Cloudflare Pages and S3 do the same
given the file, and an nginx or Caddy host is one `error_page 404` line away from it.

It is not an apology page. The build knows exactly which pages exist (a nav entry pointing at a
missing page is a build *error*, not a broken link on a published site), so the 404 prints that
list: the article's nav, in reading order, as a table of contents, with the address the reader
actually asked for typeset into it as the one entry that has no page. Which means the reader lands
somewhere true instead of at a dead end.

Two consequences worth knowing:

- **It is served from an address nobody chose,** so every URL on it is absolute and base-prefixed.
  It works at `/404.html`, at `/docs/anything/at/all/`, and under any `--base`.
- **It is not a page of the article.** It is in no nav, in no `sitemap.xml`, and it carries
  `<meta name="robots" content="noindex, follow">`. It needs no JavaScript: the address is the only
  part a script fills in, and the HTML ships a truthful sentence in its place.

## Assets are named after their contents

Every artefact a build emits into `_pagina/` carries a hash of its own bytes:

```
_pagina/pagina.4b77925f.js          the client bundle
_pagina/pagina.4b082692.css         the stylesheet
_pagina/pagina.tokens.4b082692.css  the tokens-only sheet, at the full sheet's hash
_pagina/kineglyph.8dfd7d3c.js       the figure runtime
```

Nothing in the HTML is written by hand; the shell is handed those URLs, so a page always names the
artefacts of the build that wrote it, and can never name a different build's.

**This is the fix for a specific failure, not a performance tweak.** Under an unversioned
`_pagina/pagina.js` with any cache lifetime at all, there is a window after each deploy in which a
returning reader runs the *new* HTML against the *old* JavaScript. That is not a stale page; it is
two versions of the site at once, and it is the kind of bug that gets investigated as a rendering
fault, reported as a broken feature, and answered wrongly, because the person answering is looking
at a browser that fetched everything fresh. Hashed names make the pairing an identity: a stale HTML
document names the assets it was written against, and those are still on the server.

So you can serve `_pagina/*.js` and `_pagina/*.css` immutably:

```
/_pagina/*.js   Cache-Control: public, max-age=31536000, immutable
/_pagina/*.css  Cache-Control: public, max-age=31536000, immutable
```

and keep the HTML short-lived or revalidated, which is the pairing those two settings are for.
`manifest.json`, `search.json`, `llms.json` and the pre-rendered figure SVGs are *not* hashed:
they are addressed by name on purpose, by hosts and by agents, so give those a normal lifetime.

!!! note "This is not a second cache-busting scheme"

    [Cache-bust by content](theming.md#cache-bust-by-content) tells a host to stamp its published copy of `dist/pagina.css`
    with `?v=<hash of that file>`. Both are content hashes and they never describe the same file. A
    **build** emits the HTML *and* the assets, controls both halves, and can therefore put the
    version in the name. A **host** copies `dist/*` out under names it chose and serves them from
    its own layout; a query stamp is the only handle it has, and that is what `Assets::url()` in the
    Laravel package is. An [article bundle](bundles.md) carries neither: `.rendered/` is page
    *fragments*, with no asset URLs in it at all, and the host links its own copy of the stylesheet.

    The tokens sheet takes the *full* sheet's hash rather than its own. `pagina.css` inlines
    `tokens.css`, so a tokens edit already changes it; sharing the digest keeps
    `pagina.<h>.css` ⇄ `pagina.tokens.<h>.css` derivable from each other by name, which is what a
    page linking one and a tool wanting the other rely on. The cost is that a chrome-only edit also
    renames the tokens sheet: one extra download, once.

`pagina dev` is unaffected: the dev server serves the client from source through Vite, which has its
own invalidation and no cache to go stale.

## Every page prints

There is no `pagina pdf`. A print stylesheet is the honest 80% of one and needs no new dependency,
so ⌘P, or **Save as PDF**, produces something deliberate:

- **No chrome.** The header, the sidebar, the TOC rail, the breadcrumbs, the pager, the theme
  toggle, the search trigger and the per-listing copy buttons are all ways of moving around a site,
  and none of them can be used on paper.
- **Nothing splits.** A code block, a table, an admonition, a figure and a heading-plus-its-opening
  never straddle a page break. A table longer than a sheet breaks between rows and repeats its
  header.
- **Nothing scrolls, so nothing is cropped.** Long code lines wrap instead of running off the sheet,
  and a diagram that would have scrolled its frame on screen shrinks to the page instead.
- **URLs where they help.** An absolute link prints its address after the words. A `#anchor` or a
  `/guide/` link does not: it resolves against a page the paper does not carry.
- **The light palette, always.** pagina's dark tokens live in `@media screen`, so a reader who chose
  dark and pressed ⌘P gets black ink on white, prose and code and diagrams together, rather than the
  near-white text Chrome would otherwise print onto a background it drops.

Margins are `@page { margin: 18mm 16mm }`, inside pagina's cascade layer like every other rule, so
an unlayered `@page` of your own wins without `!important`.

## `llms.txt`, for a reader that is a program

Every build writes two more files, from data the manifest already carries:

```
llms.txt              at the site root, by the emerging convention
_pagina/llms.json     the same walk, with the sections kept
```

`llms.txt` is a title, a one-line description, and a linked list of the pages, followed by pointers
to the machine-readable files. `llms.json` is `{ version, title, description, base, siteUrl,
manifest, search, pages[] }`, where each page carries its `href`, its URL, its title, its
description, its reading time, and a `sections[]` of every `h2`/`h3` with the **stable anchor** the
TOC and the search index already use, so an agent can enumerate the site, pick a section, and fetch
exactly it.

Both are correct under `--base`, and every URL in them is absolute when `site_url` is configured and
site-absolute otherwise, never relative, because a file whose purpose is to be fetched out of
context must not contain a link that resolves against whatever the fetcher was doing. Both honour
the rules the rest of the build already applies: a `noindex` page is not listed, and a draft article
lists nothing. Neither is in `sitemap.xml`: they address something that was handed the address, not
a crawler looking for pages to rank.

This is plumbing over data that already exists, and deliberately a stepping stone. If it proves
useful, the follow-up is an MCP server over a [`.pgz` bundle](bundles.md), not more flavours of the
same text at the site root.

## Publishing from CI

A deploy is the moment a mistake stops being reversible, so two things belong in the pipeline
before it.

**Check what you are about to publish.** Add `--strict-assets` to the build that deploys. The
normal build *warns* about a file nothing in the article references (see
[the unreferenced report](article-folder.md#the-unreferenced-report)) because a working build should not fail over a font
a stylesheet pulls in. A deploy is the other case: nothing reaches that file, nothing explains why
it is going out, and a red build is cheaper than an unpublishable-again file.

```sh
pagina build docs --out site --site-url "$PAGINA_SITE_URL" --strict-assets
```

`.gitignore` is honoured by default when the folder is in a git repository, which is usually
already the right answer. But a CI checkout is a *fresh clone*, so anything git ignores is not
there at all and the report is the part that still does work.

**Run the tests, all of them.** pagina's own `.github/workflows/test.yml` runs build, typecheck,
lint, the unit suite and the Playwright suite on every push and pull request, and `npm test`
runs the same five locally in the same order. That is deliberate: for a while `npm test` meant the
unit suite alone and the end-to-end lane was one someone had to remember, which is how a run was
reported green while eight browser tests were red. If a lane is optional, it is not a gate.

!!! tip "Pin what you build against"
    pagina's figure engine, Kineglyph, is a registry dependency, and `package-lock.json` is what
    pins it to an exact version. Both workflows install with `npm ci` rather than `npm install`
    for that reason: an unpinned figure engine means the site's pictures can change without a
    commit, and a lane that resolves its own versions can drift from the lane beside it.

## Summary

| | root deployment | sub-path deployment | mirror |
|---|---|---|---|
| `--site-url` | origin, or origin + `/` | full deployment URL (path becomes `base`) | its own deployment URL |
| `sitemap.xml` | written at `/` | written at `<base>` | **not written** |
| `robots.txt` | written | **not written**; line printed for the root's owner | not written under a sub-path |
| `404.html` | written at `/` | written at `<base>` | written |
| `canonical` / `og:url` | its own URL | its own URL, base included | the **primary's** URL |
| `og:image` | its own | its own | its own |
| social cards | drawn per page | drawn per page | drawn per page ([Social cards](social-cards.md)) |
