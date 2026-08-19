---
title: Install
description: >-
  From an empty directory to a published site: the CLI, a first article, the dev loop on a real
  hostname, GitHub Pages, and a Node application serving the same article inside its own layout.
---

# Install

One page, five destinations. Each section runs on its own; take the ones you need.

## The CLI

`@pagina/*` is published, so there is nothing to clone.

```sh
mkdir handbook && cd handbook
npm init -y
npm install --save-dev @pagina/cli
npx pagina --help
```

`@pagina/cli` declares `@kineglyph/core`, `@kineglyph/web` and `@kineglyph/export` as peer
dependencies, and npm installs them for you. The figure engine is not optional: a scene module
imports the bare specifier `kineglyph`, and pagina resolves it from that install.

```
usage: pagina dev|build <folder> [--out dist] [--base /] [--port 4321] [--host <addr>] [--edit]
       [--no-strict] [--theme full|tokens|none] [--no-chrome] [--strict-assets] [--no-search]
       [--site-url https://example.com/path/] [--mirror-of https://primary.example/path/]
       pagina pack [folder] [-o article.pgz] [--base /] [--created <iso8601>]
       pagina unpack <article.pgz> [dir] [--force]
```

The flags worth knowing on the first day:

| Flag | What it does |
| --- | --- |
| `--out dist` | where `build` writes the site |
| `--site-url https://example.com/docs/` | the **deployment URL, path included**. The path becomes `base`, so one flag gives both correct asset URLs and a correct canonical. See [Deploying](deploying.md) |
| `--base /repo/` | site-absolute URLs under a sub-path, when you do not want to name a full URL |
| `--no-strict` | downgrade content errors to warnings, so a half-ported folder still renders |
| `--strict-assets` | refuse to write the site while any file in it is unreferenced. For deploys |
| `--theme full\|tokens\|none` | how much of pagina's CSS a page links. See [Theming](theming.md) |
| `--no-chrome` | drop pagina's own header row, for a host that renders one |
| `--edit` | serve the editor at `/__edit/`, and expose the folder for **writing** over HTTP |
| `--no-search` | write no `search.json` and render no search control |

!!! note "The registry is a release behind this site"
    These pages are built from `main`, and `main` is ahead of the published packages: `@pagina/*`
    is `0.1.0` on npm and `0.2.0` in the repository. The CLI's commands and flags are the same in
    both. What arrived in `0.2.0` is the theme cascade [Theming](theming.md) describes, including
    per-figure `data-theme`, so an article that declares a Kineglyph theme is painted differently
    by the two.

## A first article

An article is a directory with an `article.yaml` in it. The `nav` in that file is what decides
which markdown files are pages.

```sh
mkdir -p docs
```

`docs/article.yaml`:

```yaml
slug: handbook
title: Handbook
form: docs
status: published
description: A very small article.
nav:
  - { title: Home, page: index.md }
  - { title: Install, page: install.md }
```

`docs/index.md`:

```markdown
# Handbook

Hello. See [Install](install.md).
```

`docs/install.md`:

```markdown
# Install

!!! note "It works"
    Admonitions and tabs come with the dialect.
```

Then:

```sh
npx pagina build docs --out site
```

```
[warning] sitemap-skipped : no site_url is configured, so no sitemap.xml was written;
set `site_url` in article.yaml or pass --site-url
pagina: wrote 14 files
```

Both pages, a `404.html`, a `robots.txt`, an `llms.txt`, a search index and the hashed client
assets are in `site/`. The warning is the build telling you the one thing it could not do without
knowing where the site is going, which the [GitHub Pages](#publish-to-github-pages) section
supplies.

Take a wrong turn on purpose to see the other half of the contract. Point the link in `index.md` at
a page the nav does not name, and the build refuses:

```
pagina: 1 error(s)
- [link-unresolved] index.md: link to "missing.md" resolves to missing.md, which is not in nav
```

[The article folder](article-folder.md) is the whole file format: every `article.yaml` key, the
markdown dialect, figures, and the three ways a folder decides what is *not* content.

## The day-to-day loop

```sh
npx pagina dev docs          # http://127.0.0.1:4321
```

Save a markdown file and the page reloads. The whole folder is watched, `article.yaml` included, so
adding a nav entry is all it takes to make a page exist. Saving a scene module is the one change
that does not reload the page: the figure is redrawn and hot-swapped in place, which is what makes
a diagram something you can iterate on.

The server binds `127.0.0.1` and accepts `Host` headers of `.test`, `localhost` and `127.0.0.1`
only. `--host` binds wider, and `PORT` in the environment is read when `--port` is not given, which
is what makes the gerrymander section below work without a flag.

Adding `--edit` mounts two more things: the editor's HTTP contract at `/__pagina/edit`, and a page
at `/__edit/` whose entire body is `<pagina-editor>`. `/__edit/guide/tabs/` opens `guide/tabs.md`,
derived from the path rather than looked up in the nav, so a page you have just created is
reachable before you have added it.

!!! danger "`--edit` is an unauthenticated write endpoint"
    Anyone who can reach the port can rewrite any file in the folder. It is off by default and
    inherits the loopback-only bind for that reason. Do not pair `--edit` with `--host 0.0.0.0` on
    a machine you share.

[The editor](editing.md) covers what it writes and how; [Try the editor](demo.md) runs it here
against browser storage.

## A real hostname, with gerrymander

`127.0.0.1:4321` is fine until something needs an origin: a service worker, a cookie with a domain,
an OAuth redirect, a screenshot with a plausible URL in it.
[gerrymander](https://github.com/Nano112/gerrymander) hands out `.test` hostnames with working TLS
and a sticky port per service, from a manifest in the repository. `brew install nano112/tap/gerry`
installs it, and `gerry bootstrap` sets the machine up once.

A `gerrymander.yaml` beside your `package.json`:

```yaml
project: handbook
zone: handbook.test
services:
  docs:
    hostnames: [handbook.test]
    port_pool: dev
    dev: 'npx pagina dev docs --port {PORT} --host 0.0.0.0'
```

```sh
gerry dev            # claims the name and the port, then runs `dev:`
```

Two details in that command are the ones people lose an afternoon to, and pagina's own manifest
carries both with the reasons written next to them:

```yaml
--8<-- "gerrymander.yaml"
```

`--host 0.0.0.0` is there because gerry's proxy reaches the dev server over a bridge network, which
the CLI's loopback-only default cannot see. `{PORT}` is substituted by gerry with the port it
granted; `pagina dev` would also have read it from the `PORT` environment variable that `gerry dev`
sets, so a manifest that omits the flag works too.

The rest of pagina's manifest is about `--edit` being a write endpoint. It serves a *copy* of a
fixture rather than the fixture itself, because a browser typing into a tracked folder would dirty
the repository and change what a dozen tests read.

## Publish to GitHub Pages

A Pages site lives under a sub-path (`https://user.github.io/repo/`), and that path is an input to
the build rather than a property of the folder. `--site-url` takes the full deployment URL:

```sh
npx pagina build docs --out site --site-url https://user.github.io/repo/ --strict-assets
```

The path becomes `base`, so one flag produces both correct asset URLs and a correct
`link rel=canonical`. `--strict-assets` is the deploy setting: an ordinary build *warns* about a
file nothing in the article references, and a deploy is the case where a red build is cheaper than
a file you cannot unpublish.

A `.github/workflows/docs.yml` that does that and nothing else:

```yaml
name: Docs
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read }
jobs:
  build:
    runs-on: ubuntu-latest
    permissions: { contents: read, pages: write, id-token: write }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx pagina build docs --out site --site-url "https://$OWNER.github.io/$REPO/" --strict-assets
        env:
          OWNER: ${{ github.repository_owner }}
          REPO: ${{ github.event.repository.name }}
      - uses: actions/configure-pages@v6
        with: { enablement: true }
      - uses: actions/upload-pages-artifact@v5
        with: { path: site }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions: { pages: write, id-token: write }
    environment: { name: github-pages }
    steps:
      - uses: actions/deploy-pages@v5
```

Three things that follow from the sub-path, and which pagina handles rather than leaves to you:

- **No `robots.txt` is written.** Crawlers read it from the origin root, which a sub-path
  deployment does not own. The build prints the `Sitemap:` line to add to whatever does own it.
- **`sitemap.xml` stays** at `<base>sitemap.xml`, because a sitemap may list any URL at or below
  its own directory and that is exactly what the deployment owns.
- **`404.html` is written at `<base>`**, and GitHub Pages serves it for anything that matches
  nothing. It prints the article's nav, with the address the reader asked for typeset in as the one
  entry that has no page.

pagina's own workflow does more than the one above: it packs the article and builds the site from
the *unpacked* copy, so a page that could not survive the trip fails the job instead of shipping.
It is in
[`.github/workflows/docs.yml`](https://github.com/Nano112/pagina/blob/main/.github/workflows/docs.yml),
and [Deploying](deploying.md) covers mirrors, canonicals, asset hashing and `llms.txt`.

## Embed in a site you already have

This is the case the [index](index.md) is about: the documentation is a section of an application,
under that application's header and in its palette. Nothing renders markdown per request, and no
pagina code runs in the hot path.

`examples/node-host/server.mjs` in this repository is a working one, in about 300 lines of
`node:http` with no framework. Run it:

```sh
node examples/node-host/server.mjs
#   example host   http://127.0.0.1:5173/
#     docs         http://127.0.0.1:5173/docs/
#     editor       http://127.0.0.1:5173/admin/
```

With no argument it packs `docs/` and unpacks it beside itself, which is what a host receives in
production: a `.pgz` bundle, verified on the way in, holding the article source *and* a
`.rendered/` tree of HTML fragments with the figures already inlined.

### What it imports

```js
--8<-- "examples/node-host/server.mjs:imports"
```

### The article is data

`.rendered/manifest.json` carries the nav, and `manifest.pages` is keyed by href, so the manifest
is the router. A page's fragment is `.rendered/pages/<slug>.html`, where the slug comes from
`pageSlug` in `@pagina/core` rather than from a rule you have to keep in step.

```js
--8<-- "examples/node-host/server.mjs:layout"
```

`class="pg-content"` on the wrapper is the whole of what pagina's reading layer needs. Everything
else on the page belongs to the host.

!!! warning "The base is baked in at pack time"
    The hrefs inside `.rendered/` are absolute and carry the base the article was packed at, so
    `pagina pack docs -o article.pgz --base /docs/` and mounting at `/docs/` are one decision
    written twice. The example reads `bundle.json`'s `base` and refuses to start if the two
    disagree.

### The host's palette, and nothing else

The example's `HOST_THEME` is a `:root` block of `--pg-*` and some layout CSS for its own header. It
names no pagina selector, and pagina is never told the file exists. The prose, the code blocks, the
callouts **and the pre-rendered figures** follow it, because a published figure is inline SVG whose
paints are `var(--kg-color-…)` references into the same tokens.

### The editor, in the same application

```js
--8<-- "examples/node-host/server.mjs:editor-page"
```

`viteEditMiddleware` from `@pagina/vite` is the server half. Despite the package it lives in, it is
a plain connect-style middleware over `node:fs`, and it runs under `node:http` unchanged:

```js
--8<-- "examples/node-host/server.mjs:server"
```

It implements the contract `HttpBackend` speaks:

```
GET    {base}/files                        → { files: [{ path, size, version, mtime }] }
GET    {base}/files/{path}                 → text or binary; ETag = version
PUT    {base}/files/{path} (If-Match: v)   → { version }        409 → { theirs, version }
DELETE {base}/files/{path}                 → 204
POST   {base}/upload  (multipart file,path?) → { path, url, version }
POST   {base}/rename  { from, to }         → { version }
POST   {base}/publish { manifest, pages, figures } → { publishedAt }
GET    {base}/events  (SSE)                → { type, path, version } frames
```

The import map is not optional. The editor's preview hydrates figures on the *host page's*
Kineglyph runtime, so the bare specifier `kineglyph` has to resolve to one copy; without it, figure
nodes report *Failed to resolve module specifier*.

### What the example does not cover

Stated because finding it written down is more use than discovering it.

- **No search and no live figures.** Both are jobs of pagina's client bundle, which `pagina build`
  emits into `_pagina/` and which no package exports as a file. The figures are the pre-rendered
  SVG: visible, themed, readable with scripting off, and still. A host that wants both runs
  `pagina build --base /docs/` as well and serves `_pagina/` from the same mount;
  [Search](search.md) documents the two `<html>` attributes that switch search on.
- **No authentication.** `viteEditMiddleware` authenticates nothing. A real host checks a session
  before the request reaches it, and `<pagina-editor headers="…">` is where a CSRF token or an
  `Authorization` header goes.
- **Nothing is cached.** Every request reads from disk. `.rendered/` is immutable for the life of a
  bundle, so read it once at boot or put a normal cache in front.
- **Editing does not re-render the served pages.** The editor writes markdown into the folder; the
  pages come from `.rendered/`, which changes when the editor's `POST /publish` runs. That payload
  is what a host stores. The example accepts it and drops it.

The other implementation of the same contract is a Laravel package, which is why the contract is
HTTP and JSON rather than a Node interface.

## Working on pagina itself

```sh
git clone https://github.com/Nano112/pagina.git
cd pagina
npm ci
npm run build
```

That is the whole of it. Kineglyph is a registry dependency, so there is no sibling checkout to
clone and nothing to `npm link`. (`package-lock.json` pins it to an exact version and both GitHub
workflows install with `npm ci`, so the pictures on this site cannot change without a commit
here.)

```sh
npm test              # build, typecheck, lint, vitest, playwright — in that order
```

All five lanes are the gate, and Playwright needs `npx playwright install chromium` once. Running
the unit suite alone is how a run once got reported green with eight browser tests red.

!!! tip "Tests may not write to the working directory"
    Both runners fail the run if a test leaves anything behind in the directory it started from.
    Scratch space comes from `tempDir()` in `test/tmp.ts`, which allocates under an absolute temp
    root and is cleaned up. `os.tmpdir()` on its own is not enough: it is only as absolute as
    `$TMPDIR` is.

To render this site the way CI does, including the pack-and-unpack round trip:

```sh
tools/build-docs-site.sh /tmp/pagina-site
```
