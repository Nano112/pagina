/**
 * The end-to-end lane: a real Chromium against a real `pagina dev --edit`.
 *
 * Best-effort by design. It needs `npm run build` (the CLI is run from `dist`) and a Chromium
 * that `npx playwright install chromium` has fetched; on a machine with neither, `npm test` is
 * still the whole suite, and this simply is not run.
 *
 * The server is pointed at a *copy* of the fixture — the spec types into a page and asserts the
 * file on disk changed, which the shared fixture must not have to survive.
 */
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env["PAGINA_E2E_PORT"] ?? 4599);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/setup.ts",
  use: { baseURL: `http://127.0.0.1:${String(PORT)}`, trace: "retain-on-failure" },
  webServer: {
    command: `node packages/cli/dist/cli.js dev e2e/.tmp/article --edit --port ${String(PORT)}`,
    // The contract's listing, not `/`: a page is only served to a request that asks for
    // `text/html`, and the readiness probe does not.
    url: `http://127.0.0.1:${String(PORT)}/__pagina/edit/files`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
