---
description: >-
  Packing an article folder into one portable .pgz file: what goes inside it, what pack refuses to
  guess at, and why unpack treats a bundle as hostile.
---

# Article bundles

An article is a folder. A **bundle** is that folder made portable: one file, everything it needs
inside it, importable into any pagina host without the machine that built it.

```sh
pagina pack   docs -o nucleation.pgz     # build a bundle
pagina unpack nucleation.pgz ./article   # verify it, then write it
```

A bundle is a ZIP with a `.pgz` extension. It is **built, not zipped** — see
[the design note](https://github.com/Nano112/pagina/blob/main/docs/design/2026-08-18-article-bundles.md)
for why that distinction is the whole point.

## What is in a bundle

```
article.yaml                        normalised: `snippets.roots` collapsed to ["."]
<pages>.md                          every page the nav names, snippet paths rewritten
media/…                             only assets a page or the manifest actually references
scenes/…                            figure scene modules, and whatever they import
snippets/…                          `--8<--` targets, resolved out of the repo into here
.rendered/manifest.json             the article manifest, as `pagina build` produces it
.rendered/search.json               the section index, the same bytes a build writes
.rendered/pages/<slug>.html         one HTML fragment per page, figures already inlined
.rendered/figures/<id>.<theme>.svg  every drawn figure, one file per theme
bundle.json                         format version, pagina version, created, per-file checksums
```

Assets keep the paths their pages already use, so nothing in a page needs rewriting to reach
them. The two things that *are* rewritten are the two that cannot survive the move as written:

- **`snippets.roots`** becomes `["."]`, because the roots exist to let an article reach into the
  repo around it and there is no repo around a bundle.
- **`--8<--` paths** that resolved outside the folder are repointed at the copy under `snippets/`,
  named relative to the declared root that contained them (`roots: ["..", "."]` +
  `--8<-- "examples/basics.py"` → `snippets/examples/basics.py`). A snippet that already resolved
  *inside* the folder keeps its path exactly, and `article.yaml` is then carried byte for byte.

`.rendered/` travels with the source deliberately. A host importing into production serves the
article immediately without running Node, and the editor can still open the source and re-publish.
It is the same layout the editor's `publish` endpoint writes to `.pagina/rendered/`, so a consumer
that reads one reads the other.

`.rendered/manifest.json` is the article manifest with one field re-derived: `assets` lists what
the *bundle* holds, not what the source folder held. That is both more correct for a host and what
makes packing idempotent.

!!! warning "The manifest addresses pages without the base; the fragments address them with it"
    `manifest.pages` is keyed `/`, `/theming/` whatever `--base` the bundle was packed at, and
    `manifest.nav` matches. The `href`s *inside* `.rendered/pages/*.html` carry the base, because
    they are the links a reader clicks. A host converting between the two converts in one direction
    only; [the worked example](install.md#embed-in-a-site-you-already-have) is two one-line
    helpers.

## `bundle.json`

```jsonc
{
  "format": 1,                        // integer; a host refuses a version it does not know
  "pagina": "0.1.0",                  // the pagina that packed it
  "created": "2026-08-18T09:00:00.000Z",
  "slug": "nucleation",               // article.yaml's slug — what a host imports it as
  "title": "Nucleation",
  "base": "/",                        // the site base `.rendered/` was rendered at
  "totalSize": 182734,                // the sum of every record's `size`
  "files": [                          // every file except bundle.json, sorted by path
    { "path": "article.yaml", "size": 412, "sha256": "9f2c…" },
    { "path": "index.md",     "size": 2048, "sha256": "1a0b…" }
  ],
  "external": [                       // http(s) references the pages make, sorted
    "https://img.shields.io/badge/crates.io-0.6.0-orange"
  ]
}
```

Every field is required. `path` is always a relative posix path with no `.` or `..` segment;
`sha256` is lowercase hex. `bundle.json` never lists itself — it is the thing the checksums are
*in*.

`created` is deliberately outside the checksummed set, and injectable (`--created`,
`packBundle({ created })`), because it is the one field that changes when nothing else did. With
it pinned, packing the same folder twice produces **identical bytes**: entries are sorted by path,
every ZIP timestamp is a fixed 1980-01-01, no extra fields are written, and deflate is
deterministic. A bundle can therefore be diffed, cached and content-addressed.

`external` is a report, not a failure. A bundle cannot inline the internet, so an `http(s)`
reference is left alone — but it is listed here and emitted as a `bundle-external-ref` warning, so
an author knows exactly which parts of their article will not survive an air gap.

## Pack refuses rather than guesses

A bundle that imports cleanly and renders wrong is worse than one that fails to build. These are
errors, not warnings:

| What | Code |
| --- | --- |
| a nav entry naming a page that does not exist | `nav-missing-file` |
| a referenced asset that is missing | `bundle-asset-missing` |
| a snippet that cannot be found | `bundle-snippet-missing` |
| a snippet that resolves outside the declared roots | `bundle-snippet-outside-roots` |
| a symlink in the folder pointing out of it | `bundle-symlink` |
| a figure whose scene module will not draw | `figure-prerender` |
| two different files claiming one bundle path | `bundle-collision` |

The snippet-roots rule deserves a note: `--8<-- "../secrets/x"` under `roots: ["."]` *resolves* on
disk, because `..` is just path arithmetic. The declared roots are the fence, and pack is where the
fence is load-bearing.

## Import is a trust boundary

A bundle arrives as a file from elsewhere, so `unpack` assumes it is hostile. Everything below is
checked **before `mkdir` is called once**, and the write itself goes to a staging directory that is
renamed into place, so a failure at any point leaves the destination exactly as it was.

**At decode time**, from the archive alone:

- The central directory is the only index. Local headers are read solely to confirm they name the
  same file — an extractor that trusts the local name and a validator that trusts the central one
  are looking at two different archives.
- Every entry name must be a relative posix path: no `..`, no leading `/`, no drive letter, no
  backslash (a separator on the machine unpacking, a legal filename character on the one that
  packed), no control characters, no empty or `.` segments, no trailing dot or space, nothing
  Windows reserves (`con`, `nul`, `com1`…). One bad name refuses the **whole bundle**.
- An entry whose unix mode says it is not a regular file — a symlink above all — refuses the whole
  bundle. A symlink extracted as a link stays inside the destination while everything later
  written through it does not.
- No ZIP64, no data descriptors, no encryption, no multi-disk, no method but store and deflate.
- The declared uncompressed total is checked against the archive's size **before anything is
  inflated**, and each member is inflated with `maxOutputLength` set to what it declared. A bomb is
  refused while it is still a few hundred bytes of headers.
- CRC-32 per member, as the format requires.

**Then against `bundle.json`**:

- The format version must be one this pagina reads.
- Archive and descriptor are reconciled **in both directions**: a member the descriptor never
  accounted for is as much of a problem as a record with no member, because the unaccounted one is
  the one nobody checksummed.
- Every record's `size` must match the bytes, the records must sum to `totalSize`, and the
  SHA-256s must match.
- Limits: 5 000 entries, 64 MiB per file, 256 MiB total, 200:1 ratio (`DEFAULT_BUNDLE_LIMITS`,
  overridable).

**And at the destination**: a directory that already holds something is refused unless `--force`.
Importing over an existing article is a decision, and a default that overwrites is a default that
loses someone's work the first time two articles share a slug.

## For a host

The format and its verification live in `@pagina/core`, which imports nothing from Node, so a host
that decodes the archive itself can reach the same verdict without shelling out:

```ts
import { parseBundleManifest, verifyBundleEntries, sha256Hex, isSafeBundlePath } from "@pagina/core";

const manifest = parseBundleManifest(descriptorText);
await verifyBundleEntries({ manifest, entries, archiveSize });   // throws BundleError
```

Every refusal is a `BundleError` carrying a `code` (`bundle-path`, `bundle-symlink`,
`bundle-size`, `bundle-ratio`, `bundle-checksum`, `bundle-extra-entry`, `bundle-missing-entry`,
`bundle-format`, `bundle-manifest`, `bundle-entry-count`, `bundle-destination`), so a host can
tell "not a bundle" from "a bundle that lied" without parsing a message.

The archive codec and the filesystem live in `@pagina/vite` — `packBundle`, `unpackBundle`,
`verifyBundleFile`, and `readZip`/`writeZip` under them. A host reimplementing the reader in
another language should implement the same dialect: it is deliberately narrow so that it can be.

## The property that makes the format trustworthy

`pack → unpack → pack` produces **byte-identical output**. That is asserted directly in
`packages/vite/test/bundle.test.ts`, on a destination far from the source repo, with the sibling
folder the fixture's snippet root points at nowhere in reach. If the bundle had lost a snippet,
renamed an asset, reordered the nav or failed to carry a figure, the second pack could not
reproduce the first.
