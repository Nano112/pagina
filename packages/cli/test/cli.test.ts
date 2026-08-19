import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

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
