# The editor contract as a Worker over R2

A Cloudflare Worker implementing pagina's editor HTTP contract, with the article folder in R2.

It exists because **publishing renders in the browser**: the editor loads `@pagina/core`, renders
every page and figure client-side, and POSTs the result. Nothing here parses markdown or runs a
build, so a runtime with no Node in it can host a pagina site.

```sh
npm install
npm run dev     # wrangler dev on 127.0.0.1:8787, with local R2
npm run smoke   # starts wrangler dev and drives the whole contract through @pagina/editor
```

`npm run smoke` needs the workspace built once (`npm run build` at the repository root), because it
imports the editor's real `HttpBackend` rather than a copy of it.

The unit suite (`npx vitest run examples/worker-r2` from the root) runs this Worker against
`describeBackendContract` — the same suite the memory, localStorage and HTTP backends pass.

What it is not: an identity provider, a rate limiter, or a large-upload path. See
[Hosting](../../docs/hosting.md) for what that means and what to put in front of it.
