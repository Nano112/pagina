# Releasing pagina to npm

pagina publishes five packages under one scope. Nothing is on the registry yet, so this is a first
release of `@pagina/*`.

**Kineglyph must be published first.** pagina's figure engine is
[`@kineglyph/*`](https://github.com/Nano112/kineglyph), and until those packages exist a stranger
who runs `npm install @pagina/cli` gets a CLI that cannot build a page with a figure in it. See
[Kineglyph's RELEASING.md](https://github.com/Nano112/kineglyph/blob/main/RELEASING.md), then come
back here.

## Why `npm run adopt:kineglyph` exists

Today every `@kineglyph/*` reference in this repository is an *optional* peer dependency with a
real semver range. The range is already correct; `optional` is what stops npm from going and
fetching it. That is not fussiness — a real dependency on an unpublished package makes `npm ci`
ask the registry for something that does not exist, and both CI lanes go red on the next push.

So the switch is a separate, mechanical step:

```bash
npm run adopt:kineglyph          # apply it
npm run adopt:kineglyph -- --check   # report whether it still needs applying; non-zero if so
```

It moves `@kineglyph/{core,export,web}` into `@pagina/vite`'s `dependencies` — that package
imports them at module scope in `src/prerender.ts`, so there is no build that avoids them — makes
them *required* peers of `@pagina/cli` and `@pagina/shell-static`, adds them at the workspace root
so a fresh clone can `npm ci && npm test` with no sibling checkout, and reinstalls.

## Versions in this release

| Package | Version |
| --- | --- |
| `@pagina/core` | 0.1.0 |
| `@pagina/shell-static` | 0.1.0 |
| `@pagina/vite` | 0.1.0 |
| `@pagina/editor` | 0.1.0 |
| `@pagina/cli` | 0.1.0 |

Intra-repo dependencies are caret ranges rather than `"*"`, which resolve from the workspace today
and from the registry after this release.

## The checklist

1. **Kineglyph is on npm.** Check before anything else:

   ```bash
   npm view @kineglyph/core version
   npm view @kineglyph/export version
   ```

2. **Adopt it.**

   ```bash
   npm run adopt:kineglyph
   git add -A && git commit -m "Depend on published Kineglyph packages"
   ```

3. **Land everything.** `git status` clean, on `main`, pushed. CI green — both `test.yml` and
   `docs.yml`.

   The workflows may keep their checkout-Kineglyph-at-a-pinned-SHA-and-symlink block after step 2.
   Pinning the figure engine by commit is still the stricter thing to test against, and the
   symlink simply wins over the installed copy. Drop the block only when you want CI to exercise
   what a stranger actually gets.

4. **`npm login`**, then `npm whoami`.

5. **Dry run.**

   ```bash
   npm run release:check
   ```

   Cleans, reinstalls from the lockfile, runs the full gate — build, typecheck, lint, vitest,
   Playwright — then packs every package and audits the tarballs. A missing README or LICENSE, a
   shipped test, a `"*"` range, or an `exports` entry absent from the tarball each fail the run.
   Tarballs land in `.release/`.

   Run before step 2 it stops early and tells you Kineglyph is not installed, rather than failing
   three minutes later inside the build.

6. **Read the table.** `@pagina/editor` is the large one — roughly 1 MB packed — because it ships
   both `dist/editor.js` and the self-contained `dist/editor.iife.js`. Both are exported entry
   points and both are meant to be there: the IIFE is what a host page drops in with one `<script>`.

7. **Publish.**

   ```bash
   npm run release:publish
   ```

   Publishes in dependency order — `core → shell-static → vite → editor → cli` — each with
   `--access public`. `RELEASE_DRY_RUN=1 npm run release:publish` shows the run without touching
   the registry.

8. **Tag.**

   ```bash
   git tag -a npm-2026-08-18 -m "first npm release of @pagina/*"
   git push origin --tags
   ```

9. **Verify like a stranger**, in an empty directory outside both repositories:

   ```bash
   mkdir /tmp/pagina-smoke && cd /tmp/pagina-smoke && npm init -y
   npm install @pagina/cli
   npx pagina build path/to/an/article/folder --out site
   ```

## Provenance

Worth adding, on the second release rather than this one. `npm publish --provenance` has to run
inside GitHub Actions with `id-token: write`, and it cryptographically links each tarball to the
commit and workflow that built it — a real benefit for a package other people install, and cheap
once the workflow exists.

The reason not to do it now is sequencing: this repository's Actions already build a docs site and
run a 30-minute test lane, and adding a publish job means debugging OIDC token exchange at the
same moment as finding out whether the tarballs are correct. Publish by hand, confirm the install
works from the registry, then add a `release.yml` triggered on a tag that runs
`npm run release:publish` with `--provenance`.

## If something goes wrong mid-chain

Published versions are immutable and `npm unpublish` is only available for 72 hours. Fix, bump the
patch version of whatever did not make it, and re-run — the publish step does not skip packages
already on the registry, so anything already up must be bumped or it will fail on the duplicate.

## If the account has two-factor authentication

npm asks for a one-time password on publish, and its own prompt only appears on a TTY — which
this script does not give it, because it publishes several packages in a row. Pass the code in
instead; one code is valid long enough for the whole scope:

```bash
npm run release:publish -- --otp=123456
```

`NPM_CONFIG_OTP` works too, and is what CI would use. The durable answer for automation is a
granular access token of type **Automation**, which is exempt from 2FA on publish — worth setting
up before the next release, alongside `--provenance`.

Nothing is published until every check passes, and packages go out in dependency order, so a
failed OTP leaves the scope empty rather than half-filled.
