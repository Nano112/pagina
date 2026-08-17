/**
 * The end-to-end lane, in two projects, because there are two ways the editor is loaded and only
 * one of them was ever being tested.
 *
 * - **dev** — `pagina dev --edit`, i.e. `/__edit/` served through Vite from TypeScript source.
 * - **bundle** — the *built* `dist/editor.js` on a plain Node server, which is how the Laravel
 *   package and any other host loads it. Vite's dev pipeline defines `process.env.NODE_ENV`,
 *   shims CJS interop and rewrites bare specifiers; a bundle that depends on any of that passes
 *   the first project and fails in production. One did.
 *
 * Best-effort by design: both need `npm run build` and a Chromium that
 * `npx playwright install chromium` has fetched. On a machine with neither, `npm test` is still
 * the whole unit suite and this is simply not run.
 *
 * Each server gets its own *copy* of the fixture — the specs type into pages and assert the file
 * on disk changed, which the shared fixture must not have to survive, and which two servers must
 * not do to one folder.
 */
import { defineConfig } from "@playwright/test";

const DEV_PORT = Number(process.env["PAGINA_E2E_PORT"] ?? 4599);
const STATIC_PORT = Number(process.env["PAGINA_STATIC_PORT"] ?? 4600);

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/setup.ts",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "dev",
      testMatch: /edit\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${String(DEV_PORT)}` },
    },
    {
      name: "bundle",
      // `host-theming.spec.ts` belongs here for the same reason: it is about what a *host* gets
      // from the built stylesheets, and the dev server's import resolution is exactly what hid
      // the defect it covers.
      testMatch: /(bundle|host-theming|admonitions|metadata)\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${String(STATIC_PORT)}` },
    },
  ],
  webServer: [
    {
      command: `node packages/cli/dist/cli.js dev e2e/.tmp/article --edit --port ${String(DEV_PORT)}`,
      // The contract's listing, not `/`: a page is only served to a request that asks for
      // `text/html`, and the readiness probe does not.
      url: `http://127.0.0.1:${String(DEV_PORT)}/__pagina/edit/files`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `node e2e/static-server.mjs`,
      url: `http://127.0.0.1:${String(STATIC_PORT)}/vendor/pagina/editor.js`,
      env: { PAGINA_STATIC_PORT: String(STATIC_PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
