#!/usr/bin/env bash
#
# Builds pagina's own documentation with pagina, and refuses to publish anything it complained
# about.
#
# The refusal is the point. `pagina build` already exits non-zero on an *error*, but a warning —
# a cover that did not resolve, a snippet reference that fell back, a deployment URL that
# disagrees with `--base` — exits zero and publishes a page that is quietly wrong. A docs site
# that publishes its own warnings is a docs site nobody reads the log of, so this treats both
# severities the same and only tolerates codes it is told to by name.
#
# Assumes the workspace is already installed and built (`npm ci && npm run build`, with the
# `@kineglyph/*` links in place). CI does that; see `.github/workflows/docs.yml`.
#
# Usage:  tools/build-docs-site.sh [outdir]
# Env:    PAGINA_SITE_URL   full deployment URL, path included (default: the GitHub Pages site)
#         PAGINA_MIRROR_OF  the primary's URL, if this build is a mirror
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO_ROOT/site}"
SITE_URL="${PAGINA_SITE_URL:-https://nano112.github.io/pagina/}"
MIRROR_OF="${PAGINA_MIRROR_OF:-}"
CLI="$REPO_ROOT/packages/cli/dist/cli.js"
ARTICLE="$REPO_ROOT/docs"

# The article folder is the source of truth for `--base`: the path of the deployment URL. Deriving
# it here rather than passing it separately keeps the two from disagreeing — `pagina` treats a
# disagreement as a usage error, which is right, but the way to never see it is to have one input.
BASE="/$(printf '%s' "${SITE_URL#*://}" | cut -s -d/ -f2-)"
[ "$BASE" = "/" ] || BASE="/${BASE#/}"
case "$BASE" in */) ;; *) BASE="$BASE/" ;; esac

if [ ! -f "$CLI" ]; then
  echo "error: $CLI does not exist — run 'npm ci && npm run link:kineglyph && npm run build' first" >&2
  exit 1
fi

LOG="$(mktemp -t pagina-docs-log.XXXXXX)"
trap 'rm -f "$LOG"' EXIT

# Runs the CLI, then refuses on any diagnostic that is not in `$1` (a space-separated list of
# tolerated warning codes, usually empty).
run_pagina() {
  local tolerate="$1"; shift
  echo "+ pagina $*"
  set +e
  node "$CLI" "$@" 2>&1 | tee "$LOG"
  local status=${PIPESTATUS[0]}
  set -e
  if [ "$status" -ne 0 ]; then
    echo "error: pagina exited $status" >&2
    exit 1
  fi
  local bad
  bad="$(grep -E '^\[(error|warning)\] ' "$LOG" || true)"
  for code in $tolerate; do
    bad="$(printf '%s\n' "$bad" | grep -v "^\[warning\] $code " || true)"
  done
  if [ -n "$(printf '%s' "$bad" | tr -d '[:space:]')" ]; then
    echo "" >&2
    echo "error: pagina reported diagnostics; refusing to publish:" >&2
    printf '%s\n' "$bad" >&2
    exit 1
  fi
}

echo "==> site  $SITE_URL"
echo "==> base  $BASE"
echo "==> out   $OUT"

# ---- 1. the round trip -------------------------------------------------------------------------
# Packing and unpacking before building is not ceremony: it is the only check that the article is
# *self-contained*. A build reads straight from the repository and will happily resolve a snippet
# or a scene import that a bundle could never carry, so a folder can build here and be broken for
# everyone else. Building the site from the unpacked copy means the published site is the portable
# one, and a reference that does not survive the trip fails the job instead of shipping.
#
# `bundle-external-ref` is tolerated because these pages link to GitHub on purpose. It says an
# absolute URL will not survive an air gap, which is true and is not a defect.
WORK="$(mktemp -d -t pagina-docs.XXXXXX)"
trap 'rm -f "$LOG"; rm -rf "$WORK"' EXIT

run_pagina "bundle-external-ref" pack "$ARTICLE" -o "$WORK/pagina.pgz" --base "$BASE"
run_pagina "" unpack "$WORK/pagina.pgz" "$WORK/unpacked"

# ---- 2. the site -------------------------------------------------------------------------------
rm -rf "$OUT"
run_pagina "" build "$WORK/unpacked" \
  --out "$OUT" \
  --site-url "$SITE_URL" \
  ${MIRROR_OF:+--mirror-of "$MIRROR_OF"}

# ---- 3. the editor, for the live demo -----------------------------------------------------------
# `docs/demo.md` runs the real editor against browser storage, so the built bundle has to be on the
# site. It is copied here rather than committed into the article for two reasons: it is a 1.3 MB
# build artefact that would be stale the moment a package changed, and — the deciding one — an
# `editor.js` inside `docs/` would be packed into every `.pgz` of this article, which is the
# opposite of what a portable bundle is for. The demo page reaches it at `<base>editor/`, derived
# from its own URL, so this path is the contract between the two.
#
# `demo.js` joins them: the demo's implementation, which both the docs page and the full-screen
# editor import. It is emitted by plain `tsc` (it has no static imports — it fetches `editor.js`
# through a URL at runtime, which is what keeps the 1.3 MB bundle a separate, deferred request),
# so it is a sibling of the bundle it loads and finds it relative to its own `import.meta.url`.
#
# Missing is fatal. A demo page whose editor 404s looks exactly like a broken site.
EDITOR_DIST="$REPO_ROOT/packages/editor/dist"
for f in editor.js editor.css demo.js; do
  if [ ! -f "$EDITOR_DIST/$f" ]; then
    echo "error: $EDITOR_DIST/$f does not exist — 'npm run build' has not produced the editor bundle" >&2
    exit 1
  fi
done
mkdir -p "$OUT/editor"
cp "$EDITOR_DIST/editor.js" "$EDITOR_DIST/editor.css" "$OUT/editor/"
# `tsc` writes a `sourceMappingURL` pointing at a `.map` that is not published; stripped rather
# than shipped, so opening devtools on the site does not produce a 404 nobody can act on.
sed '/^\/\/# sourceMappingURL=/d' "$EDITOR_DIST/demo.js" > "$OUT/editor/demo.js"

# ---- 4. the full-screen editor -------------------------------------------------------------------
# `<base>editor/index.html`: the same demo, the same browser storage, the whole viewport, and none
# of the docs chrome. `%BASE%` is substituted here because the page's import map must name an
# absolute URL — the one thing a hand-written static file cannot derive, since a sub-path
# deployment makes a relative one wrong as soon as the page is fetched without its trailing slash.
sed "s|%BASE%|$BASE|g" "$REPO_ROOT/tools/editor-page.html" > "$OUT/editor/index.html"

# The bundle is worth keeping: it is what a host would import, and having the exact artefact the
# site was built from makes a bad deploy diagnosable.
cp "$WORK/pagina.pgz" "$OUT.pgz"

echo ""
echo "==> wrote $OUT ($(find "$OUT" -type f | wc -l | tr -d ' ') files) and $OUT.pgz"
