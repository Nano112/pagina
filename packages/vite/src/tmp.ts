/**
 * Where scratch space goes — and, more to the point, where it does *not* go.
 *
 * `os.tmpdir()` is not a guarantee, it is an echo. On POSIX it returns `$TMPDIR` very nearly
 * verbatim (Node only strips a trailing slash), and nothing anywhere requires `$TMPDIR` to be
 * absolute. A shell that exports `TMPDIR=.` — or `TMPDIR=tmp`, or an empty-ish value some wrapper
 * script built by string concatenation — turns every `join(tmpdir(), "pagina-…")` in this
 * codebase into a *relative* path, and a relative path is resolved against `process.cwd()`.
 *
 * That is not hypothetical. It is how a run of this repo's own test suite deposited two thousand
 * `pagina-*` directories and 442 MB into an unrelated project's working tree: the code all looked
 * correct, said `tmpdir()` everywhere, and still wrote to the caller's directory.
 *
 * A library that scribbles in its caller's current directory is a bug regardless of what the
 * caller's environment said, so the environment does not get the last word here: if `$TMPDIR`
 * cannot be trusted to be absolute, we ignore it and use the platform's real temp directory.
 */
import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";

/** The platform's temp directory when `$TMPDIR` is unusable. Never relative, never `cwd`. */
function platformDefault(): string {
  if (process.platform === "win32") {
    const root = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
    return `${root}\\Temp`;
  }
  return "/tmp";
}

/**
 * An **absolute** temp directory to create scratch space in.
 *
 * Use this instead of `os.tmpdir()` anywhere the result is about to be joined with a name and
 * written to. The two differ only when `$TMPDIR` is relative — which is exactly the case that
 * silently redirects writes into whatever directory the caller happened to be standing in.
 */
export function paginaTempRoot(): string {
  const raw = tmpdir();
  return raw !== "" && isAbsolute(raw) ? raw : platformDefault();
}
