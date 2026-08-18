/**
 * The one property that matters about the temp root: it is never a relative path, whatever the
 * environment says. A relative temp root is not a cosmetic problem — it silently redirects every
 * scratch write in the process into `process.cwd()`, which is somebody else's directory.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isAbsolute } from "node:path";
import { paginaTempRoot } from "../src/tmp.js";

const original = process.env["TMPDIR"];

afterEach(() => {
  if (original === undefined) delete process.env["TMPDIR"];
  else process.env["TMPDIR"] = original;
});

describe("paginaTempRoot", () => {
  it("is absolute with the environment left alone", () => {
    expect(isAbsolute(paginaTempRoot())).toBe(true);
  });

  // `$TMPDIR=.` is the exact value that turned `join(tmpdir(), "pagina-build-")` into
  // `./pagina-build-` and put 442 MB in an unrelated repository.
  it.each([".", "", "tmp", "./scratch", "relative/path"])("ignores a relative $TMPDIR (%j)", (value) => {
    process.env["TMPDIR"] = value;
    const root = paginaTempRoot();
    expect(isAbsolute(root)).toBe(true);
    expect(root).not.toBe(".");
  });

  it("uses an absolute $TMPDIR as given", () => {
    process.env["TMPDIR"] = "/var/tmp";
    // Node strips the trailing slash and otherwise passes `$TMPDIR` through, so this is the
    // honour-the-environment case and it must still be honoured.
    expect(paginaTempRoot()).toBe("/var/tmp");
  });
});
