# @pagina/shell-static

The static HTML shell for a [pagina](https://github.com/Nano112/pagina) site: the page chrome, the
CSS tokens, the syntax highlighting, and the small client runtime that hydrates figures and
search.

It is *one* shell over the manifest [`@pagina/core`](../core) produces, not the only possible one —
that is the whole reason the two are separate packages. A Laravel Blade view or a React app can
consume the same manifest and never install this.

```bash
npm install @pagina/shell-static
```

```ts
import { staticShell, createHighlightedMarkdown } from "@pagina/shell-static";
import { buildStatic } from "@pagina/vite";

await buildStatic({ folder: "docs", outDir: "site", shell: staticShell, md: await createHighlightedMarkdown() });
```

## Subpath exports

| Specifier | What it is |
| --- | --- |
| `@pagina/shell-static` | `staticShell`, `renderPageHtml`, `renderNotFoundHtml`, `createHighlightedMarkdown` |
| `@pagina/shell-static/interactive` | the client-side behaviour: search overlay, figure hydration, theme switching |
| `@pagina/shell-static/theming` | the token vocabulary and the theme identities the docs site ships |
| `@pagina/shell-static/pagina.css` | the full stylesheet |
| `@pagina/shell-static/pagina.tokens.css` | just the `--pg-*` custom properties, for a host that brings its own layout |
| `@pagina/shell-static/pagina.reading.css` | the prose styles on their own |
| `@pagina/shell-static/client/*` | the un-bundled client sources, for a host that wants to bundle them itself |

The three-way CSS split is what `--theme full|tokens|none` on the CLI selects between. A host page
that already has a design system takes `tokens` and keeps its own layout; a standalone site takes
`full`.

## Licence

MIT — see [LICENSE](./LICENSE).
