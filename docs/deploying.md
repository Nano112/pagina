# Deploying — sub-paths, two homes, and which copy counts

One article, more than one address. That is the situation this page is about: the same folder
published at `https://schemat.io/…` by a CMS **and** at `https://user.github.io/Project/` by a
static build, from the same source. Everything below follows from those two facts — the site is not
at the root of its origin, and it is not the only copy.

## Where the site is going is an input to the build

`--site-url` takes the **full deployment URL, path and all**:

```sh
pagina build docs --site-url https://schem-at.github.io/Nucleation/
```

The path becomes `base`, so one flag produces both correct asset URLs and a correct
`link rel=canonical`. `--base` may still be given on its own, and giving both is fine as long as
they agree — a disagreement is a usage error rather than a coin toss.

This is deliberately a *flag* rather than something read from `article.yaml`. A folder with two
homes cannot carry one deployment URL: whichever it named would be wrong in the other place, and
wrong silently.

### The trap this replaces

The SEO layer uses only the **origin** of a site URL, because the paths pagina generates already
carry `base`. So before this, writing the deployment URL into `article.yaml`:

```yaml
site_url: https://schem-at.github.io/Nucleation/
```

and building without `--base` produced `<link rel="canonical" href="https://schem-at.github.io/">`
— an origin root that belongs to a different site, on every page, with nothing in the output to
suggest anything was wrong. That configuration is now a build warning
(`seo-site-url-path-ignored`) naming the `--base` that would fix it. An origin-only `site_url` plus
`--base` remains correct and silent; it is only the *dropped path* that warns.

## `robots.txt` cannot be moved, and pagina no longer pretends otherwise

`robots.txt` is fetched from `/robots.txt` at the origin root and from nowhere else. A build under
`--base /Project/` would put it at `/Project/robots.txt`, which no crawler will ever request.

**Ruling: a sub-path build writes no `robots.txt`.** It prints one line saying why, and — when
there is a sitemap — the exact `Sitemap:` line to add to whatever *does* serve the origin root:

```
pagina: no robots.txt was written: this site is served at "/Nucleation/", and crawlers read
robots.txt only from the origin root, which a sub-path deployment does not own. Every page carries
its own robots meta tag regardless. Add this line to the root robots.txt:
Sitemap: https://schem-at.github.io/Nucleation/sitemap.xml
```

Programmatically that is `buildStatic`'s `robots` result (`outPath`, `rootSitemapLine`, `reason`).

Two things this is careful about:

- It is **not a diagnostic**. Nothing in the folder is wrong and no edit to it could help, so it
  must not fail a strict build — and a warning nobody can act on is how people learn to skim
  warnings. A CI job that fails on any diagnostic (the recommended setting) stays green.
- Nothing is lost. `noindex` — the thing a draft article actually depends on — is a `<meta>` tag in
  every page's `<head>`, read wherever the page is served. `robots.txt` was never carrying it.

`sitemap.xml` is the opposite case and **stays where it is**, at `<base>sitemap.xml`. A sitemap may
list any URL at or below its own directory, and that set is exactly what a sub-path deployment
owns. It is discoverable via the root `robots.txt` line above, or by submitting it directly.

## A mirror says which copy counts

Two public copies of one article compete in search results, and which one wins is then decided by
a crawler's heuristics rather than by the author. `--mirror-of` settles it:

```sh
pagina build docs \
  --site-url https://schem-at.github.io/Nucleation/ \
  --mirror-of https://schemat.io/docs/nucleation/
```

Every page's `link rel=canonical` and `og:url` then address the **primary's** URL for that same
page, and no `sitemap.xml` is written — submitting the mirror's own URLs for indexing would argue
with every page's own `<head>`. The mirror keeps its own `og:image`, which is right: that image has
to be fetchable from where the page is served.

### Why a cross-origin canonical, and not `noindex`

Both are honest answers. The canonical is the better one, for three reasons:

1. **`noindex` and canonical are alternatives, not a pair.** A crawler told not to index a page has
   no reason to read it, so a `noindex` mirror can never point anywhere — its signal is discarded
   rather than transferred. A canonical consolidates the mirror's ranking signal onto the primary.
2. **The mirror stays useful to people.** A link to the Pages copy in an issue, a README or a chat
   still opens a real, readable page, and still resolves if the primary is down. `noindex` does not
   change that, but it does mean the mirror can never be *found* — including by someone
   deliberately looking for the repository's own copy.
3. **It is reversible and it is a build flag.** Which copy is primary is a deployment decision, and
   deciding it in the deploy command means flipping it costs one line, in the place that already
   knows where this build is going.

`noindex` remains available per page (`noindex: true` in front matter) and per article (a `draft`
status), for the cases where a copy genuinely should not be found at all.

**When *not* to set it:** if the primary does not serve the article yet, a canonical pointing at it
is a canonical pointing at a 404. Deploy the mirror without `--mirror-of` until the primary is
live, then turn it on.

## Every build writes a 404

`pagina build` emits `<base>404.html` alongside the pages, always and without configuration. GitHub
Pages serves it for any address that matches nothing; Netlify, Cloudflare Pages and S3 do the same
given the file, and an nginx or Caddy host is one `error_page 404` line away from it.

It is not an apology page. The build knows exactly which pages exist — a nav entry pointing at a
missing page is a build *error*, not a broken link on a published site — so the 404 prints that
list: the article's nav, in reading order, as a table of contents, with the address the reader
actually asked for typeset into it as the one entry that has no page. Which means the reader lands
somewhere true instead of at a dead end.

Two consequences worth knowing:

- **It is served from an address nobody chose,** so every URL on it is absolute and base-prefixed.
  It works at `/404.html`, at `/docs/anything/at/all/`, and under any `--base`.
- **It is not a page of the article.** It is in no nav, in no `sitemap.xml`, and it carries
  `<meta name="robots" content="noindex, follow">`. It needs no JavaScript: the address is the only
  part a script fills in, and the HTML ships a truthful sentence in its place.

## Publishing from CI

A deploy is the moment a mistake stops being reversible, so two things belong in the pipeline
before it.

**Check what you are about to publish.** Add `--strict-assets` to the build that deploys. The
normal build *warns* about a file nothing in the article references — see
[the unreferenced report](article-folder.md) — because a working build should not fail over a font
a stylesheet pulls in. A deploy is the other case: nothing reaches that file, nothing explains why
it is going out, and a red build is cheaper than an unpublishable-again file.

```sh
pagina build docs --out site --site-url "$PAGINA_SITE_URL" --strict-assets
```

`.gitignore` is honoured by default when the folder is in a git repository, which is usually
already the right answer — but a CI checkout is a *fresh clone*, so anything git ignores is not
there at all and the report is the part that still does work.

**Run the tests, all of them.** pagina's own `.github/workflows/test.yml` runs build, typecheck,
lint, the unit suite **and the Playwright suite** on every push and pull request, and `npm test`
runs the same five locally in the same order. That is deliberate: for a while `npm test` meant the
unit suite alone and the end-to-end lane was one someone had to remember, which is how a run was
reported green while eight browser tests were red. If a lane is optional, it is not a gate.

!!! tip "Pin what you build against"
    pagina's figure engine, Kineglyph, is a git dependency built from source. Both workflows read
    its commit SHA from one file, `.github/kineglyph-ref`, rather than each carrying a copy —
    an unpinned figure engine means the site's pictures can change without a commit, and two
    pinned copies means the lane that tests and the lane that deploys can drift apart.

## Summary

| | root deployment | sub-path deployment | mirror |
|---|---|---|---|
| `--site-url` | origin, or origin + `/` | full deployment URL (path becomes `base`) | its own deployment URL |
| `sitemap.xml` | written at `/` | written at `<base>` | **not written** |
| `robots.txt` | written | **not written**; line printed for the root's owner | not written under a sub-path |
| `404.html` | written at `/` | written at `<base>` | written |
| `canonical` / `og:url` | its own URL | its own URL, base included | the **primary's** URL |
| `og:image` | its own | its own | its own |
