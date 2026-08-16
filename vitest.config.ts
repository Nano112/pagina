import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"], pool: "forks" },
  resolve: {
    alias: {
      // The editor's preview imports the bare `kineglyph` specifier, which a host page resolves
      // through its import map. Tests get the same mapping `@pagina/vite`'s dev server uses, so a
      // test that wants a stub can `vi.mock("kineglyph", …)` against a specifier that resolves.
      kineglyph: fileURLToPath(new URL("node_modules/@kineglyph/web/src/bundle.ts", import.meta.url)),
    },
  },
});
