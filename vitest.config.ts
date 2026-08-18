import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"],
    /**
     * Cleans up every scratch directory the file allocated, and fails the file if it left
     * anything in the working directory. See `test/setup.ts` — the second half is a regression
     * guard for a bug that put 442 MB in someone else's repository.
     */
    setupFiles: ["./test/setup.ts"],
    /**
     * The repository root, for the setup file's working-directory guard.
     *
     * It is passed as an environment variable because a setup file cannot work this out for
     * itself: inside the test environment `import.meta.url` is one of Vite's `/@fs/…` URLs, not a
     * `file:` URL, so `new URL("..", import.meta.url).pathname` yields a path that does not exist.
     * This file runs in plain Node, where `import.meta.url` means what it says.
     */
    env: { PAGINA_REPO_ROOT: fileURLToPath(new URL(".", import.meta.url)) },
    pool: "forks",
    /**
     * Test *files* run one at a time.
     *
     * The jsdom suites drive React through fake timers, and React's scheduler runs on
     * `MessageChannel`, which fake timers do not control. `test/settle.ts` advances the clock and
     * then yields real macrotasks to bridge that, which is enough on an idle machine — but under
     * the CPU pressure of seven jsdom environments running at once, a commit occasionally lands
     * after `settle` has given up, and some *other* suite fails. Measured on this machine: ~40% of
     * parallel runs failed somewhere, in a different file each time; 6/6 serial runs were clean.
     *
     * It costs about five seconds (≈5 s → ≈10 s for the whole suite). A gate that is wrong two
     * runs in five is not a gate, and five seconds is not a reason to keep one.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // The editor's preview imports the bare `kineglyph` specifier, which a host page resolves
      // through its import map. Tests get the same mapping `@pagina/vite`'s dev server uses, so a
      // test that wants a stub can `vi.mock("kineglyph", …)` against a specifier that resolves.
      kineglyph: fileURLToPath(new URL("node_modules/@kineglyph/web/src/bundle.ts", import.meta.url)),
    },
  },
});
