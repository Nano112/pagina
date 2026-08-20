---
title: Hosting
description: >-
  Five shapes a pagina site can take, what each one costs and needs, and a Worker over object
  storage that implements the editor's contract with nothing to run.
---

# Hosting: five shapes, and what each one costs

[Install](install.md) shows how to build a site and put it on GitHub Pages, and how to serve one
from a Node application. This page is the decision in front of that: who writes to the folder, and
what has to exist for them to do it.

## Publishing renders in the browser

The editor loads `@pagina/core`, renders every page and every figure in the reader's own browser,
and POSTs the result. A backend stores those bytes and hands them back. It never parses markdown,
never draws a figure, and never runs a build while somebody is waiting.

Everything below follows from that. An editing backend needs no Node, no renderer, and no build
step at request time, which is why an edge runtime over object storage is a real option rather than
a stretch: implement the HTTP contract, keep the folder in a bucket, serve what publish wrote. The
mirror-image idea, rendering pages at the edge on request, is one pagina has never needed and
should not start needing.

## Social cards are the exception

[Social cards](social-cards.md) are drawn with resvg, a native binary, so they come from
`pagina build` and never from a publish. A site published from a browser keeps whatever cards its
last build produced.

That is worth knowing in advance rather than discovering from a link preview. A post written and
published entirely in the browser shares as the card its predecessor got, or as a line of blue text
if the site has never been built. If cards matter, a build has to happen somewhere: a scheduled CI
job, or one triggered after a publish, writing into the same storage the site is served from.

## The five shapes

| | Who edits | What it needs | Suits |
|---|---|---|---|
| **Static, by commit** | you, in git | any static host | one author who is happy in a checkout |
| **Node host** | the editor, against your server | a Node process you run | an application you already operate |
| **Framework host** | the editor, inside the app | Laravel, Rails, Django… | docs living inside a product |
| **Edge functions** | the editor, against object storage | a Worker and a bucket | a blog with nobody to operate it |
| **Git-backed** | the editor, writing commits | a host API and a scoped token | nothing yet; [see below](#git-backed-editing-which-is-not-built) |

### Static, edited by commit

`pagina build` writes a directory. Anything that serves files serves it, and
[Deploying](deploying.md) is entirely about getting that directory right: the deployment URL, the
sub-path rules, the 404, the content-hashed assets.

Nothing is running. There is no write path, so there is nothing to authenticate, nothing to bill,
and nothing that can be attacked except the host itself. The cost is that publishing means a commit
and a build, which is fine for a person who was going to open an editor in a terminal anyway and is
the wrong shape for anybody else.

### A Node host

`pagina dev --edit` mounts the editor's contract over a folder on disk, and
`viteEditMiddleware` from `@pagina/vite` is the same middleware for a server you write yourself.
`examples/node-host/server.mjs` is a working one; [Install](install.md#embed-in-a-site-you-already-have)
walks through it and is honest about what it leaves out.

This is the right answer when the process already exists. It is a poor reason to start one: a
long-running server for a site that changes twice a month is a thing to patch, monitor and pay for
between edits.

### A framework host

The editor is a custom element and the contract is plain JSON over HTTP, so a framework that can
route and authenticate can host it. `pagina/laravel` is the implementation that exists, and it is
where the contract's harder edges were settled — `If-Match` semantics, and the rule that identity
comes from `auth()->user()` and never from the request body.

Reach for it when the article is part of a product: same login, same permissions, same deploy.

### Edge functions over object storage

`examples/worker-r2` in this repository is a Cloudflare Worker implementing the whole contract with
the folder in R2. It is the shape described at the top of this page taken literally, and it is the
subject of the rest of the page.

### Git-backed editing, which is not built

The idea is attractive and it is worth saying why, because someone will ask. The editor would write
commits through a host's API. There is no infrastructure at all, history is versioned by
construction rather than by a log somebody has to keep, and attribution falls out of commit
authorship, which fits pagina's rule that the host names the author and the client never does.

It was considered and rejected, for three reasons.

**It fights the editing model.** pagina's store is optimistic and debounced: it saves every few
seconds while somebody types. Turning each of those into a commit means either latency nobody would
tolerate, or a batching scheme that quietly gives up the per-file version the conflict banner is
built on. The live in-place feel is the product, and a backend that erodes it is the wrong backend.

**It forces one shape of auth.** A token with write access to a repository is a heavier and more
particular thing to ask for than "you know who is logged in", and in a browser-side editor it is a
credential sitting in a page.

**A byte store is the smaller ask.** Being backend-agnostic is the goal, and the widest set of
hosts can provide a place to put bytes. Between an object store and a git host, the object store is
the one more people already have.

None of that makes it a bad idea for someone whose site is already a repository and whose author
edits it once a week. It is a shape the contract permits and nobody has built.

## The Worker, in detail

```sh
cd examples/worker-r2
npm install
npm run dev     # wrangler dev on 127.0.0.1:8787, with local R2
```

`npm run dev` needs no account and no bucket: wrangler runs the Worker in workerd and gives it a
local R2 that persists under `.wrangler/`. Point the editor's `HttpBackend` at
`http://127.0.0.1:8787/api/articles/<slug>` and it behaves the way it does against any other host.

### What is in the bucket

```
{slug}/files/{path}        the article folder, byte for byte
{slug}/rendered/…          manifest.json, one HTML fragment per page, one SVG per figure and theme
{slug}/published.json      when, and by whom
{slug}/edits/{key}         the log: zero-byte objects carrying the row in custom metadata
```

The folder is the folder. Nothing is transformed on the way in, so `wrangler r2 object get` returns
the markdown somebody typed, and a bucket can be walked by anything that speaks S3.

Edit-log keys are inverted timestamps, because R2 lists ascending and offers no other order.
Subtracting the clock from a constant makes "the last fifty edits" the first page of a listing
instead of a full scan, and putting the row in custom metadata means one `list` call answers the
history endpoint without fetching an object per edit.

### A conflict is decided inside the write

`If-Match` is a compare-and-swap rather than a read followed by a write:

```ts
--8<-- "examples/worker-r2/src/worker.ts:cas"
```

R2 evaluates `onlyIf` as part of storing, so two editors who both hold version `v` cannot both
succeed. A read-then-write server passes every test in the contract suite and loses an edit in
production whenever two people save within a few milliseconds of each other, which is precisely
what two people editing one article do.

### Who wrote this

The author is derived from the request's credential and from nothing else:

```ts
--8<-- "examples/worker-r2/src/worker.ts:identity"
```

There is no code path in the Worker that reads an author out of a body, a query string or a header,
and a test asserts it by sending one in all three places and checking the write is still attributed
to the token's owner. This is [the rule the contract states](editing.md#identity-comes-from-the-host-never-from-the-client),
and it is the one part of attribution that is a security property rather than a convenience: a
caller who can name themselves can write as somebody else.

`EDITORS` is a JSON map from token to `{ id, name, email }`. Two tokens, two names, and a conflict
banner that says *Bob changed index.md* instead of *index.md changed on the server*. That is the
whole of what a two-author blog needs, and roughly the whole of what a shared secret can honestly
provide.

### How it is tested

Two ways, because either one alone would be a bad answer.

The unit suite runs the Worker against `describeBackendContract` — the same suite `MemoryBackend`,
`LocalStorageBackend` and `HttpBackend` pass — with the editor's real `HttpBackend` as the client
and a `Map` standing in for R2:

```sh
npx vitest run examples/worker-r2
```

Then `npm run smoke` starts `wrangler dev` and drives the same Worker over a real socket against
miniflare's real R2, with the real client: write, read back byte for byte, collide with a second
editor holding a second token, receive the change on an open event stream, upload all 256 byte
values and compare, rename, read the history, publish, and fetch the published page as a reader
with no token.

The second one earns its keep. The first run under wrangler hung on a rename, and the cause was a
Durable Object writing an event to a subscriber that had closed its connection: the frame went into
a stream nobody was draining, the queue filled, and the next write waited for room that would never
come. The author's save hung because somebody else closed a tab. Against an in-memory stand-in the
queue never filled and the bug was invisible.

### What it does not cover

- **Authentication is a shared secret per person.** No expiry, no rotation, no revoking one person
  without editing `EDITORS` and redeploying, and no sign-in page. Put [Cloudflare
  Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of it for
  anything real. Access also solves a problem the tokens do not: `EventSource` cannot carry an
  `Authorization` header, so `GET {base}/events` is authenticated by a cookie here, and Access sets
  a properly signed one.
- **No CORS.** No `Access-Control-*` headers and no `OPTIONS` handler, so the editor has to be
  served from the same origin as the Worker.
- **No rate limiting.** Nothing stops a valid token from filling a bucket.
- **Uploads are buffered in memory** and capped at 25 MB. A larger file wants a presigned PUT
  straight to the bucket, which is a different endpoint and is not here.
- **A rename is a copy and a delete**, because R2 has no move. A Worker that dies between the two
  leaves the file at both paths, which is the recoverable half of the two ways that can fail.
- **Filtering history by path is a scan**, bounded at 2,000 rows. An article with years of edits
  will not find the oldest mention of one file.
- **It does not assemble a page.** It stores and serves what publish wrote: a manifest, page
  fragments, and figure SVGs. Something still has to put a shell around them, and today that is
  `pagina build` or a host template.
- **It has not been deployed.** Everything above was exercised under `wrangler dev` against local
  storage. Nothing in this repository has run on Cloudflare's network.

### Deploying it

Three things a real deployment needs, none of which the local run exercises: a bucket for the
Worker to bind to, the editor map as a secret rather than the development one in
`wrangler.jsonc`, and the deploy itself.

```sh
npx wrangler r2 bucket create pagina-articles
npx wrangler secret put EDITORS
npx wrangler deploy
```

The committed `EDITORS` in `wrangler.jsonc` exists so that `npm run dev` is one command with
nothing to set up first. A secret of the same name overrides it, and the two development tokens in
that file are worth exactly as much as a token in a public repository is worth.

## Porting it somewhere else

The Worker's platform surface is deliberately small: seven methods on an object store and one
function that announces a change. Both are declared as interfaces in
`examples/worker-r2/src/bindings.ts`, so the file is a list of what another runtime would have to
supply.

The object store is the substantial half, and the only unusual thing asked of it is a conditional
write. S3 has it as `If-Match` on `PutObject`; a database has it as a `WHERE version = ?`. Without
one, a host can still implement the contract by taking a lock, and should say so rather than doing
the read-then-write that looks the same in every test.

The broadcast is the easy half, and it is optional. `GET {base}/events` is the one endpoint in
[the contract](editing.md#the-backend-contract) a host may leave out: drop it and the editor stops
noticing a second tab and works otherwise. On Cloudflare it needs a Durable Object, because a
`Set` of subscribers held in a Worker is per-isolate and would reach whichever fraction of the
readers shared an isolate with the writer. Elsewhere it is a Redis publish, a Postgres `NOTIFY`, or
nothing at all.
