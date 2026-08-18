import { describe, expect, it } from "vitest";
import { DEFAULT_EXCLUDE, articleExcluder, makeExcluder } from "../src/exclude.js";

describe("makeExcluder", () => {
  it("matches a bare name at any depth, as a file and as a directory", () => {
    const ex = makeExcluder(["notes"]);
    expect(ex("notes")).toBe(true);
    expect(ex("notes/private.md")).toBe(true);
    expect(ex("a/b/notes/private.md")).toBe(true);
    expect(ex("notes.md")).toBe(false);
    expect(ex("release-notes/x.png")).toBe(false);
  });

  it("anchors on a leading or middle slash, but not on a trailing one", () => {
    // gitignore's rule: a trailing separator says "directory", it does not say "here".
    const anywhere = makeExcluder(["plans/"]);
    expect(anywhere("plans/q3.md")).toBe(true);
    expect(anywhere("docs/plans/q3.md")).toBe(true);
    const here = makeExcluder(["/plans/"]);
    expect(here("plans/q3.md")).toBe(true);
    expect(here("docs/plans/q3.md")).toBe(false);
    const middle = makeExcluder(["docs/plans/"]);
    expect(middle("docs/plans/q3.md")).toBe(true);
    expect(middle("a/docs/plans/q3.md")).toBe(false);
  });

  it("treats a trailing slash as directory-only", () => {
    const ex = makeExcluder(["build/"]);
    expect(ex("build/main.css")).toBe(true);
    // A *file* called `build` is not a build directory.
    expect(ex("build")).toBe(false);
  });

  it("keeps `*` inside one segment and lets `**` cross them", () => {
    expect(makeExcluder(["*.psd"])("art/logo.psd")).toBe(true);
    expect(makeExcluder(["media/*.psd"])("media/logo.psd")).toBe(true);
    expect(makeExcluder(["media/*.psd"])("media/deep/logo.psd")).toBe(false);
    expect(makeExcluder(["media/**/*.psd"])("media/deep/logo.psd")).toBe(true);
  });

  it("lets a later `!` re-include, and a later plain pattern re-exclude", () => {
    expect(makeExcluder(["private/", "!private/ok.png"])("private/ok.png")).toBe(false);
    expect(makeExcluder(["private/", "!private/ok.png"])("private/secret.png")).toBe(true);
    expect(makeExcluder(["!private/ok.png", "private/"])("private/ok.png")).toBe(true);
  });

  it("ignores blank lines and comments, so raw ignore-file text can be handed to it", () => {
    const ex = makeExcluder(["", "   ", "# a comment", "secret"]);
    expect(ex("secret/x")).toBe(true);
    expect(ex("a comment")).toBe(false);
  });

  it("excludes nothing when given nothing", () => {
    expect(makeExcluder([])("anything/at/all.png")).toBe(false);
  });
});

describe("the built-in defaults", () => {
  const ex = articleExcluder([]);

  it("covers dotfiles and everything under a dot-directory", () => {
    expect(ex(".env")).toBe(true);
    expect(ex(".DS_Store")).toBe(true);
    expect(ex("media/.DS_Store")).toBe(true);
    expect(ex(".git/config")).toBe(true);
    expect(ex(".superpowers/notes/plan.md")).toBe(true);
    // The bundle writer refuses any path with a dot-segment; the static build now agrees.
    expect(DEFAULT_EXCLUDE).toContain(".*");
  });

  it("covers node_modules at any depth", () => {
    expect(ex("node_modules/react/index.js")).toBe(true);
    expect(ex("scenes/node_modules/x/y.js")).toBe(true);
  });

  it("leaves real content alone", () => {
    for (const path of ["media/hero.png", "scenes/flow.mjs", "guide/diagram.svg", "fonts/inter.woff2"])
      expect(ex(path), path).toBe(false);
  });

  it("does not guess about names an author might have meant", () => {
    // Every one of these is a plausible thing to publish on purpose. `exclude` is where an author
    // says otherwise; a default that guessed would break folders silently.
    for (const path of ["dist/app.js", "build.png", "out/report.pdf", "tmp/scratch.svg", "server.log"])
      expect(ex(path), path).toBe(false);
  });

  it("can be overridden by the folder's own list", () => {
    expect(articleExcluder(["!.well-known/security.txt"])(".well-known/security.txt")).toBe(false);
    expect(articleExcluder(["!.well-known/security.txt"])(".well-known/other")).toBe(true);
  });

  it("appends the caller's extra exclusions last", () => {
    expect(articleExcluder([], ["media/hero.png"])("media/hero.png")).toBe(true);
  });
});
