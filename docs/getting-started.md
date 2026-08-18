# Get started

pagina is not published to npm yet. It is a workspace monorepo that consumes
[Kineglyph](https://github.com/Nano112/kineglyph) — the figure engine — from a sibling checkout,
so getting a working copy means cloning two repositories rather than running one `npm install`.
That is stated plainly here because it is the step people lose an afternoon to.

## Build a working copy

=== "First time"

    ```sh
    # 1. Kineglyph, beside pagina, linked into the global npm prefix
    git clone https://github.com/Nano112/kineglyph.git ../kineglyph
    (cd ../kineglyph && npm run bootstrap && for p in packages/*; do (cd "$p" && npm link); done)

    # 2. pagina itself
    npm install && npm run link:kineglyph
    npm run build
    npm install && npm run link:kineglyph   # creates node_modules/.bin/pagina, then re-links
    ```

=== "Afterwards"

    ```sh
    npm install && npm run link:kineglyph
    npm run build
    ```

!!! warning "`npm install` removes the Kineglyph links every time"
    Every `npm install` prunes the `@kineglyph/*` symlinks, and `npm run link:kineglyph` puts them
    back. If a build fails with *cannot resolve `kineglyph`*, or figures render as empty frames,
    that is what has happened. Re-run the link script.

## Render something

The repository carries a fixture article that exercises most of the dialect, and this
documentation is itself an article. Either will do:

```sh
npx pagina dev   docs                # http://127.0.0.1:4321
npx pagina build docs --out dist     # a static site in ./dist
```

`dev` binds `127.0.0.1` and accepts only `.test`, `localhost` and `127.0.0.1` `Host` headers; pass
`--host` to bind wider. `build` writes the site and exits `1` with the full diagnostic list if
anything failed to resolve.

## The commands

```
pagina dev    <folder> [--port N] [--base /] [--host addr] [--edit] [--theme LEVEL] [--no-chrome] [--site-url URL] [--mirror-of URL]
pagina build  <folder> [--out dist] [--base /] [--no-strict] [--theme LEVEL] [--no-chrome] [--site-url URL] [--mirror-of URL]
pagina pack   [folder] [-o article.pgz] [--base /] [--created ISO8601]
pagina unpack <article.pgz> [dir] [--force]
```

The flags worth knowing on the first day:

| Flag | What it does |
| --- | --- |
| `--out dist` | where `build` writes the site |
| `--site-url https://example.com/docs/` | the **deployment URL, path included**. The path becomes `base`, so one flag gives both correct asset URLs and a correct canonical — see [Deploying](deploying.md) |
| `--base /repo/` | site-absolute URLs under a sub-path, when you do not want to name a full URL |
| `--no-strict` | downgrade content errors to warnings, so a half-ported folder still renders |
| `--theme full\|tokens\|none` | how much of pagina's CSS a page links — see [Theming](theming.md) |
| `--edit` | serve the in-browser editor at `/__edit/`, and expose the folder for **writing** over HTTP |

!!! warning "`--edit` is a write endpoint"
    With `--edit`, anyone who can reach the port can rewrite the folder. It is off by default and
    inherits the loopback-only bind for that reason. Do not pair it with `--host 0.0.0.0` on a
    machine you share.

## Verify a change

The suite is the contract. All four lanes are expected green before anything is pushed:

```sh
npx vitest run        # unit + integration
npm run typecheck
npx eslint .
npx playwright test   # needs `npm run build` and `npx playwright install chromium`
```

!!! tip "Tests may not write to the working directory"
    Both runners fail the run if a test leaves anything behind in the directory it was started
    from. Scratch space comes from `tempDir()` in `test/tmp.ts`, which allocates under an absolute
    temp root and is deleted for you — `os.tmpdir()` on its own is not enough, because it is only
    as absolute as `$TMPDIR` is.

## Where the pieces live

| Package | What it is |
| --- | --- |
| `@pagina/core` | the render: markdown dialect, links, figures, SEO, bundle contents. No filesystem, no Node |
| `@pagina/vite` | the Node side: dev server, static build, pack/unpack, figure pre-render |
| `@pagina/shell-static` | the default page shell and the stylesheets that carry the token contract |
| `@pagina/editor` | the in-browser WYSIWYG editor, backend-agnostic |
| `@pagina/cli` | the `pagina` command |

The dated design notes behind these decisions are in
[`docs/design/`](https://github.com/Nano112/pagina/tree/main/docs/design). They are working
documents rather than reference material, which is why they are not in the nav.
