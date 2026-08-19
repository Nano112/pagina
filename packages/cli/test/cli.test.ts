import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../test/tmp.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
/** The shared article fixture — the same one `@pagina/vite`'s build suite renders. */
const FIXTURE = fileURLToPath(new URL("../../core/test/fixture/", import.meta.url));

/** Run the built CLI and report what a shell would see. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("asking for help", () => {
  // `pagina --help` is the first command the docs give a reader. It used to print to stderr and
  // exit 2, because parseArgs throws on a flag it was not told about — so the documented first
  // step reported failure, and `pagina --help | less` got nothing.
  it.each([["--help"], ["-h"]])("%s succeeds and writes usage to stdout", (flag) => {
    const { code, stdout, stderr } = run([flag]);
    expect(code).toBe(0);
    expect(stdout).toContain("usage: pagina");
    expect(stderr).toBe("");
  });

  it("still refuses a command it does not have", () => {
    const { code, stderr } = run(["bogus"]);
    expect(code).toBe(2);
    expect(stderr).toContain("usage: pagina");
  });

  it("still refuses no command at all", () => {
    expect(run([]).code).toBe(2);
  });
});

/** Every file under `dir`, as paths relative to it. */
async function walk(dir: string, root = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p, root));
    else out.push(relative(root, p));
  }
  return out;
}

describe("building a site", () => {
  /**
   * `pagina: wrote N files` is the only report a build gives of what it did, and it was wrong: the
   * count came from a list that every write appended to *except* the client bundle, which vite
   * writes. A build that put 28 files in `dist` said 22. Anyone reconciling the line against the
   * directory — which is the only reason to print a count — found six files nobody claimed.
   *
   * So this counts the output directory and holds the line to it. It is deliberately blind to what
   * the number is: the fixture will grow chunks and pages, and the claim being pinned is that the
   * sentence is true of the directory, not that it says any particular number.
   */
  it("reports as many files as it actually wrote", async () => {
    const outDir = await tempDir("cli-build");
    const { code, stdout, stderr } = run(["build", FIXTURE, "--out", outDir]);
    expect(code, stderr).toBe(0);

    const written = await walk(outDir);
    const line = stdout.split("\n").find((l) => l.startsWith("pagina: wrote "));
    expect(line, `no "pagina: wrote …" line in:\n${stdout}`).toBeDefined();
    expect(line).toBe(`pagina: wrote ${String(written.length)} files`);
  }, 120_000);
});
