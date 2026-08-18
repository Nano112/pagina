# @pagina/vite

The build and dev pipeline behind [pagina](https://github.com/Nano112/pagina). It takes the
manifest [`@pagina/core`](../core) produces and turns it into either a directory of static files or
a hot-reloading dev server, with every [Kineglyph](https://github.com/Nano112/kineglyph) figure
pre-rendered to SVG on the way.

Most people want [`@pagina/cli`](../cli) instead. Reach for this package when you are embedding the
pipeline in a build of your own.

```bash
npm install @pagina/vite
```

```ts
import { buildStatic, createDevServer } from "@pagina/vite";
import { staticShell } from "@pagina/shell-static";

await buildStatic({ folder: "docs", outDir: "site", shell: staticShell, base: "/" });

const dev = await createDevServer({ folder: "docs", shell: staticShell, port: 4321 });
```

## Kineglyph is required, not optional

`src/prerender.ts` imports `@kineglyph/export` and `@kineglyph/core` at module scope, and
`buildStatic` imports that eagerly. There is no path through a build that avoids the figure
engine, so install `@kineglyph/core`, `@kineglyph/export`, and `@kineglyph/web` alongside this
package — they are declared here rather than vendored so that one install carries exactly one copy
of the runtime, whichever of pagina's packages asks for it.

## What is in here

- `buildStatic` — the whole static build: render, pre-render figures per theme, bundle the client,
  write `search.json`, emit the site.
- `createDevServer` — Vite in middleware mode over the article folder, with the bare `kineglyph`
  specifier aliased so a figure script written for the browser also runs under the pre-renderer.
- `packBundle` / `unpackBundle` / `verifyBundleFile` — the `.pgz` single-file article format:
  a build, not a zip of a folder, with every file checksummed and verified before a byte is
  written back out.
- `resolveKineglyphBundle` / `kineglyphRoot` — resolving the figure runtime through npm's `exports`
  map rather than by guessing at paths, so a linked checkout and an installed package behave alike.
- `NodeContentFs` — the filesystem port `@pagina/core` renders through.

## Licence

MIT — see [LICENSE](./LICENSE).
