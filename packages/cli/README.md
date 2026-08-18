# @pagina/cli

The command line for [pagina](https://github.com/Nano112/pagina): point it at a folder of Markdown
and get a static documentation site, or a live one with hot reload while you write.

```bash
npm install -g @pagina/cli
# or, without installing:
npx @pagina/cli build docs --out site
```

```
usage: pagina dev|build <folder> [--out dist] [--base /] [--port 4321] [--host <addr>] [--edit]
                                 [--no-strict] [--theme full|tokens|none] [--no-chrome]
                                 [--strict-assets] [--no-search]
                                 [--site-url https://example.com/path/]
                                 [--mirror-of https://primary.example/path/]
       pagina pack [folder] [-o article.pgz] [--base /] [--created <iso8601>]
       pagina unpack <article.pgz> [dir] [--force]
```

## The four commands

- **`dev`** — Vite over the folder, hot reload on every file it renders. `--edit` also serves the
  WYSIWYG editor at `/__edit/`, which makes the folder writable over HTTP, so it is opt-in per run.
- **`build`** — the static site. Strict by default: a nav entry without a file, a dead link, a
  missing snippet, a broken anchor, or a figure that fails to pre-render fails the build with a
  diagnostic naming the page. `--no-strict` downgrades those to warnings.
- **`pack`** — one portable `.pgz`. It *builds* a bundle rather than zipping a folder: resolves the
  snippets that live outside it, copies only the media a page actually references, carries the
  pre-rendered figures, and checksums every file.
- **`unpack`** — verifies the whole bundle before writing a byte.

## What gets installed with it

`@pagina/core`, `@pagina/vite`, and `@pagina/shell-static` come along as dependencies. The
[Kineglyph](https://github.com/Nano112/kineglyph) figure engine — `@kineglyph/core`,
`@kineglyph/export`, `@kineglyph/web` — is declared as a peer so that a project which already pins
a Kineglyph version keeps that one copy rather than getting a second nested underneath the CLI.
npm installs peers for you; if you have disabled that, install the three alongside.

## Licence

MIT — see [LICENSE](./LICENSE).
