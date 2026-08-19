# The Kineglyph runtime is a directory, not a file

*2026-08-19 — written while upgrading pagina from `@kineglyph/web` 0.2.0 to 0.3.0.*

## What happened

Kineglyph published 0.3.0 (`@kineglyph/export` 0.4.0). pagina declared `^0.2.0` / `^0.3.0`, and
**a caret on a `0.x` version does not cross a minor** — `^0.2.0` resolves 0.2.x and stops. So the
repository was pinned to the old release without saying so. Raising the three ranges installed
0.3.0, everything built, every unit test passed, every published-site end-to-end test passed, and
sixteen Playwright specs — every one of them an *editor* surface — timed out waiting for
`.ProseMirror` to appear. The editor was not mounting, and nothing said why.

The browser said why, in one line:

```
GET http://127.0.0.1:4600/vendor/pagina/rolldown-runtime-DtPi1Y-2.js  404 (Not Found)
```

## The breaking change

`@kineglyph/web`'s `./bundle` export — `dist/kineglyph-web.js`, the file the bare `kineglyph`
specifier points at — used to be self-contained. In 0.2.0 its only sibling reference was a lazy
`import("./lab-editor-*.js")` that never fired on a page with no lab.

In 0.3.0 the build splits a shared chunk out of it and imports that **statically, on line 1**:

```js
// @kineglyph/web@0.3.0 dist/kineglyph-web.js, first line
import { n as e } from "./rolldown-runtime-DtPi1Y-2.js";
```

`dist/` now also holds `gifenc-*.js` and `lab-editor-*.js` beside it. The names are content
hashes; they change from release to release.

## Why that killed the editor and nothing else

pagina loads the runtime two ways.

- **A published site** gets it from `@pagina/vite`'s build, which bundles `@kineglyph/web/bundle`
  into `_pagina/kineglyph.<hash>.js` and writes any chunks beside it. Self-healing; those specs
  never failed.
- **A host application** — the Laravel package, `e2e/static-server.mjs`, anything with an import
  map — copies the artefact out of `node_modules` and serves it flat under `/vendor/pagina/`. It
  copied *one file*.

So the host's `kineglyph` import resolved to a module whose first import 404ed. A module that
fails to load is not an exception anyone catches: `RenderedHtml`'s `import { mountAll } from
"kineglyph"` never resolves, the mount effect never runs, and `<pagina-editor>` sits in the DOM
un-upgraded. No thrown error, no failed assertion — just a `waitFor` that expires 30 seconds
later. Sixteen times, that is eight minutes of a suite that says nothing.

## The fix

Stop treating the runtime as a single artefact. A host publishes the whole of
`@kineglyph/web/dist` into `public/vendor/pagina/`; `e2e/static-server.mjs` serves that directory
flat under the same prefix. Neither needs to know which chunks a given Kineglyph release emits,
which is the only property worth having here — the hashes will move again.

The Laravel package's `sync-assets.sh` (in schemati, not this repository) has to copy the folder
rather than `kineglyph-web.js`, or its editor page breaks in exactly this way.

## What this did *not* turn out to be

`mountAllKineglyphLabs` is absent from `@kineglyph/web`'s `dist/index.js` in 0.3.0, which looks
like a removed export and sends you looking for a shim. It is not removed: the editor resolves the
bare `kineglyph` specifier to `@kineglyph/web/**bundle**`, a different entry, which re-exports
`./lab.js` and still exports both `mountAllKineglyphLabs` and `KineglyphLabController`. Probe the
entry the code actually imports.

## Upgrading Kineglyph, next time

1. Raise all three ranges — `@kineglyph/core`, `@kineglyph/web`, `@kineglyph/export` — in the root
   `package.json`, in `packages/{cli,shell-static,vite}/package.json`, and in the `RANGES` table in
   `scripts/adopt-kineglyph.mjs`. A caret will not do it for you.
2. `npm install`, `npm run build`, then **open the editor in a browser before running the suite**:
   serve the built site and watch `pageerror`, `console` and `requestfailed`. Kineglyph has no
   changelog, and a mount failure reaches the suite as a timeout with no message. One console line
   is worth eight minutes of red.
3. If something moved, `npm pack @kineglyph/web@<previous>` and diff the two `dist/` trees. That is
   how the static import above was found, in about a minute.
