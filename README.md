# pagina

Renders an "article folder" (markdown + assets + Kineglyph scene modules) into a static docs
site, or serves it live with hot-swapped figures.

Workspaces: `packages/core` (parsing/rendering, `@pagina/core`), `packages/shell-static` (page
template, theme, highlighted markdown, `@pagina/shell-static`), `packages/vite` (`buildStatic`,
`createDevServer`, `@pagina/vite`), `packages/cli` (the `pagina` binary, `@pagina/cli`).

## Dev loop

### Fresh clone

Kineglyph is not published; it is consumed from a linked checkout. Clone it as a sibling of this
repo, build it, and register each of its packages as a global link:

```sh
git clone <kineglyph remote> ~/Documents/code/kineglyph
cd ~/Documents/code/kineglyph && npm run bootstrap
for p in packages/*; do (cd "$p" && npm link); done   # core, svg, anime, plot, scenes, web, export
```

Then, in this repo:

```sh
npm install && npm run link:kineglyph
ls node_modules/@kineglyph        # 7 symlinks
```

### Everyday

`npm install` drops the symlinks, so relink after every install:

```sh
npm install
npm run link:kineglyph   # re-links @kineglyph/{core,svg,anime,plot,scenes,web,export}
npm run build             # builds core, vite, shell-static, cli (dependency order)
npm install                # re-creates node_modules/.bin/pagina now that packages/cli/dist exists
npm run link:kineglyph   # npm install drops the kineglyph symlinks again — re-link once more
```

Every plain `npm install` drops the kineglyph symlinks (and, the first time, hasn't created
`node_modules/.bin/pagina` yet because `packages/cli`'s `bin` target doesn't exist until after a
build) — re-run `npm run link:kineglyph` after any `npm install`.

This machine runs [gerry](https://nano112.github.io/gerrymander) for local hostnames/ports.
`gerrymander.yaml` wires the `frontend` service's `dev:` command to the CLI; `gerry dev` grants a
sticky port and routes `https://pagina.test` to it:

```sh
gerry dev                                   # serves packages/core/test/fixture by default
PAGINA_CONTENT=path/to/folder gerry dev     # or point it at another folder
gerry down                                  # release the hostname/port when done
```

Without gerry, run the CLI directly — either via the workspace bin link (`npx pagina`, once
`node_modules/.bin/pagina` exists per the install sequence above) or by path — port precedence:
`--port` flag > `PORT` env var > `4321`, ignoring blank/non-numeric values:

```sh
npx pagina dev <folder> [--port 4321] [--base /] [--host <addr>]
npx pagina build <folder> [--out dist] [--base /] [--no-strict]

# equivalently:
node packages/cli/dist/cli.js dev <folder> [--port 4321] [--base /] [--host <addr>]
node packages/cli/dist/cli.js build <folder> [--out dist] [--base /] [--no-strict]
```

`dev` binds loopback only (`127.0.0.1`) and allows only `.test`/`localhost`/`127.0.0.1` Host
headers by default; pass `--host` (or set `HOST`) to bind wider — `gerrymander.yaml`'s `dev:`
command does this (`--host 0.0.0.0`) so gerry's proxy can reach it. `build` exits `1` and prints
the `PaginaBuildError` diagnostics on a strict failure. `dev` hot-swaps figures over HMR and
full-reloads on everything else.

## Folder contract

An article folder has `article.yaml` (`slug`, `title`, `form`, `status`, `visibility`, `tags`,
optional `kineglyph: { theme, width }`, `snippets: { roots }`, and `nav` — the sole source of the
page list and site nav), the markdown pages `nav` references (admonitions `!!! note "..."`, tabs
`=== "Label"`, snippet includes `--8<-- "path[:region]"`), and everything else as a plain asset
copied 1:1 into the build.

## Kineglyph embeds

Three ways to embed a figure (raw HTML — markdown has no figure syntax):

```html
<figure class="kg" data-scene="../scenes/demo.mjs"></figure>                 <!-- module -->

<figure class="kg" id="my-figure"><script type="text/kineglyph">             <!-- inline -->
import { defineScene, stack, heading } from "kineglyph";
export default defineScene({ schemaVersion: 2, id: "my-figure", title: "…", root: stack("r", [heading("h", "…")]) });
</script></figure>

<figure class="kg" data-static="../media/static.svg"><img src="../media/static.svg" alt="…"></figure> <!-- static -->
```

Module and inline figures pre-render to light/dark SVGs at build time and then hydrate
client-side (`figure.kg[data-kineglyph-mounted="true"]`). A static figure is *not* pre-rendered —
the author supplies the image and it stays a plain `<img>`.

An author-supplied `id` must match `[A-Za-z0-9_.-]+` (it becomes a URL path segment and a
manifest key); anything else is replaced by the generated id with a `figure-id-invalid` warning.
Two pages claiming the same figure id is a `figure-id-collision` error.

## Trust model

Markdown pages and scene modules are **trusted content**. The markdown pipeline runs with
`html: true` (raw HTML passes through unsanitised), scene modules are executed both at build time
(to pre-render SVGs) and in the browser, and `snippets.roots` may point outside the article
folder. Pagina is a renderer for authors with commit access to the folder it is given — not a
sandbox for untrusted, user-submitted documents.

## Deviations from the design spec

- The figure provider is Kineglyph-only for now; the spec's pluggable-provider seam is not built.
- The manifest records a figure's pre-renders as `staticBase` (append `.<theme>.svg`) rather than
  the spec's `static: Record<theme, path>` map.
- Pagefind search and the Playwright smoke test are not yet added.
