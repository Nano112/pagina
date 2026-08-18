# Article bundles — a folder you can carry — design

Date: 2026-08-18. Status: approved by the user's brief ("build everything into a folder locally that I
can then import from a zip in prod, all assets self contained… should be standard with pagina").

## The idea

An article is a folder. A **bundle** is that folder made portable: one file, everything it needs
inside it, importable into any pagina host without the machine that built it.

## The bundle is built, not zipped

The tempting implementation is `zip -r article.zip ./article/`. It is wrong, and Nucleation shows why:

- `article.yaml` sets `snippets.roots: [".", ".."]` because `--8<--` include paths are repo-root
  relative (`examples/…`). Content the pages depend on lives **outside** the folder. A verbatim zip
  either breaks on import or silently drops the includes.
- `docs/` also holds `autostack-design.pdf`, `.tex` sources, `planning/`, `plans/`, `overrides/` and
  the MkDocs `javascripts/` — none of it part of the article, all of it dead weight in a bundle.
- Pages reference a fraction of `media/`. Shipping all 79 entries because they share a directory is
  not "self-contained", it is "unsorted".

So `pack` **resolves** rather than copies: it reads the nav, walks what the pages actually reference,
pulls in exactly that, and rewrites every path to be bundle-relative. What comes out has no way to
reach outside itself, which is the only definition of self-contained worth the name.

## What is in a bundle

```
article.yaml           normalised; snippet roots collapsed to "."
<pages>.md             every page the nav names
media/…                only assets a page or the manifest actually references
scenes/…               figure scene modules
snippets/…             includes resolved out of the repo and rewritten to point here
.rendered/             manifest.json, pages/*.html, figures/*.svg
bundle.json            format version, pagina version, created, per-file checksums
```

`.rendered/` travels with the source deliberately. A host importing into production should be able to
serve the article immediately without running Node, and the editor should still be able to open the
source and re-publish. Carrying both is a few hundred KB and removes a build step from the import
path — the same trade the Laravel package already makes by vendoring built editor assets.

## Pack refuses rather than guesses

A bundle that imports cleanly and renders wrong is worse than one that fails to build. `pack` is a
build with diagnostics, and these are errors, not warnings:

- a nav entry naming a page that does not exist (silently pruning it ships a broken menu)
- a referenced asset that is missing
- a snippet that resolves outside the declared roots
- a symlink pointing out of the folder
- a figure whose scene module cannot be resolved

External `http(s)` references are left alone — a bundle cannot inline the internet — but they are
**reported**, so an author knows exactly which parts of their article will not survive an air gap.

## Import is a trust boundary

A bundle arrives as a file from elsewhere, so unpacking is where this gets attacked:

- **Zip-slip**: every entry path is resolved and required to stay under the destination root. Entries
  that traverse, are absolute, or are symlinks are refused — the whole bundle, not just the entry.
- **Zip bombs**: declared and actual uncompressed size are capped, and the ratio is checked.
- **Slug collision**: importing over an existing article requires an explicit choice. Default is to
  refuse.
- Checksums in `bundle.json` are verified before anything is written.

Import writes nothing until every check passes.

## Surfaces

- `pagina pack [folder] -o article.pgz` and `pagina unpack article.pgz [dir]` — the standard, in core
  and the CLI, available to any host.
- schemati: `php artisan pagina:import <file>` plus an upload in the articles admin, both on the same
  core validation. The Laravel side decides policy (who may import, which disk); it does not
  re-implement the format.

## The loop the bundle exists to serve

The user's workflow, which is what the format has to satisfy:

> write it fully in local schemat.io → export a standard pagina zip → import in prod schemat.io →
> and mirror it on GitHub Pages, bundled in the Nucleation repo

So the bundle is not an export format with an import as an afterthought. It is the **interchange
format between four places**, and every arrow has to work:

```
local schemat.io  ──export──▶  article.pgz  ──import──▶  prod schemat.io
                                   │  ▲
                          unpack   │  │  pack
                                   ▼  │
                        Nucleation repo docs/  ──build──▶  GitHub Pages
```

Three consequences:

**Export is a first-class surface, not just the CLI.** Authoring happens in the editor, so schemati
must produce a bundle from a stored article — an artisan command and a download in the admin — using
the same core `pack`. A host that can import but not export makes its content a hostage.

**Round-trip must be lossless in both directions.** `pack` → `unpack` → `pack` is already required to
be byte-identical; the loop above additionally means a bundle unpacked into `docs/` must be editable
in place and packed back without drift. That makes P1's byte-equality property load-bearing rather
than merely reassuring: it is what lets the repo and the CMS both be real editing surfaces instead of
one being a stale copy.

**Canonical is wherever it was last edited.** There is no master. The bundle carries a created
timestamp and per-file checksums, so a human can tell two bundles apart and see what changed; the
format does not attempt to merge, and importing over an existing article requires an explicit choice.
Concurrent editing in two places is a conflict for a person to resolve, not something to paper over.

## The static mirror

GitHub Pages serves the article from the Nucleation repo, which means **the base-path case stops being
theoretical**. A known gap already recorded against the SEO work applies directly here: `robots.txt`
and `sitemap.xml` are emitted at the output root, which under `--base /Nucleation/` is not where a
crawler looks. Either the build learns to place them correctly for a sub-path deployment, or it says
plainly that a sub-path host must serve its own root `robots.txt` — silently emitting them where
nothing will read them is the one option that is not acceptable.

The mirror also has to survive having no origin: canonical and `og:*` need a site URL, which for Pages
is knowable at build time and must be configurable per deployment rather than baked into
`article.yaml` — the same article is served from two origins, and each needs its own canonical.

## Nucleation is the proof

`docs/` is already a pagina article folder with a 38-page nav. This design is validated by packing the
subset that is actually ported — `index.md` and `features/basics.md` — resolving their repo-root
snippets, carrying their figures, and importing the result into schemat.io. The remaining 36 pages are
the porting backlog, not a bundle problem.
