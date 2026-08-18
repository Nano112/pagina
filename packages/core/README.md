# @pagina/core

The article model behind [pagina](https://github.com/Nano112/pagina). It reads an *article folder*
— an `article.yaml`, some Markdown, whatever those pages reference — and returns a typed manifest
plus rendered HTML fragments. It writes nothing, serves nothing, and knows nothing about a shell.

```bash
npm install @pagina/core
```

```ts
import { renderArticle } from "@pagina/core";

// `fs` is a small `ContentFs` port — read, exists, list — so the same renderer runs over a
// directory, a zip, or a database without knowing which it is.
const article = await renderArticle({ fs, base: "/" });
// article.pages[n].html, article.nav, article.diagnostics
```

Diagnostics are the contract, not a log: a nav entry without a file, a dead link, a missing
snippet, a broken anchor, or a cover that does not exist all arrive as structured `Diagnostic`
records naming the page, and `strict` (the default) turns them into a thrown `PaginaBuildError`.

That separation is the point: `@pagina/core` produces the manifest,
[`@pagina/shell-static`](../shell-static) is *one* shell over it, and a Laravel Blade view or a
React app can consume the same manifest without pulling in a static-site generator.

## What is in here

- **Front matter and config** — `parseArticleConfig`, `parseFrontMatter`, the `article.yaml`
  schema, and the Kineglyph theme plumbing (`kineglyphColorVars`, `kineglyphThemeHref`).
- **Markdown** — `createMarkdown` / `renderMarkdown`, admonitions, snippet expansion
  (`--8<--`-style includes that reach outside the folder), and `{...}` attribute syntax.
- **Figures** — `extractFigures` pulls Kineglyph scene scripts out of a page so a build step can
  pre-render them, and `inlineFigureSvgs` puts the results back.
- **Links and references** — `rewriteLinks` turns folder-relative Markdown links into site URLs;
  the strict mode behind pagina's "a dead link fails the build" rule lives here.
- **Search** — `@pagina/core/search` builds the section-level index that a site writes to one
  `search.json`.
- **SEO and reading time** — `seo.ts`, `readingMinutes`.

## Subpath exports

| Specifier | What it is |
| --- | --- |
| `@pagina/core` | the article model |
| `@pagina/core/search` | the search index builder, importable on its own so a host that only wants search does not pay for Markdown |

## Licence

MIT — see [LICENSE](./LICENSE).
