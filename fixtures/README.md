# fixtures/

Other people's documents, vendored so the tests can be run on them.

pagina's parser, serializer and renderer are only as good as the pages people actually wrote in the
dialect, so parts of the suite read real ones. Those pages live in other repositories, and the
tempting shortcut — read them out of a sibling checkout at an absolute path, and skip the test when
the path is absent — is the reason this directory exists instead. A test that skips itself proves
nothing on anyone else's machine or on CI, and one that reads another repository's *working tree*
fails here the moment somebody edits something unrelated. Both happened.

So the pages are copied in and committed. What the tests read is versioned with the code that has to
parse it, and a change in the source repository arrives as a reviewable diff rather than as a
surprise.

## nucleation/

Two pages from [Nucleation](https://github.com/Nano112/Nucleation)'s documentation, plus the
`article.yaml` they are configured by and the source files their `--8<--` snippet directives
include. The layout mirrors the repository (`docs/…` and `examples/…`) because the snippet roots are
`[".", ".."]` — the paths only resolve if the shape does.

Read by:

- `packages/editor/test/roundtrip.test.ts` — the byte-exact round trip, on real markup;
- `packages/editor/test/parser.test.ts` — what the parser makes of that markup;
- `packages/core/test/golden.test.ts` — the committed HTML goldens, generated from these copies.

### Refreshing them

Explicitly, by hand, never by a test:

```sh
node scripts/sync-nucleation-fixtures.mjs /path/to/Nucleation
# or: PAGINA_NUCLEATION_ROOT=/path/to/Nucleation node scripts/sync-nucleation-fixtures.mjs
```

Then review the diff, run the suite, and regenerate the goldens if the pages really changed:

```sh
PAGINA_UPDATE_GOLDEN=1 npx vitest run packages/core/test/golden.test.ts
```
