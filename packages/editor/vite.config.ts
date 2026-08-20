/**
 * The browser bundle.
 *
 * Two formats, because two kinds of host exist: `dist/editor.js` for a page with an import map or a
 * bundler, and `dist/editor.iife.js` (global `Pagina`) for a `<script>` tag — which is how the
 * Laravel package will ship it, the way Livewire ships its JS.
 *
 * React is bundled (a host page must not have to install it); `kineglyph` is not, because the
 * preview has to hydrate figures on the *same* runtime instance the site's own pages use, which
 * the page's import map decides.
 *
 * `@kineglyph/core` is aliased onto that same bare specifier. The social-card composer lives in
 * `@pagina/core` — shared with the build, which is the point — and imports `@kineglyph/core` by its
 * real package name, as a Node package must. Bundling that copy would put a second Kineglyph in the
 * page and hand the editor two `defaultTheme`s; leaving it as a bare `@kineglyph/core` would emit a
 * specifier no host's import map defines. Rewriting it to `kineglyph` is what makes the composer
 * one piece of code in two runtimes rather than two pieces that resemble each other. `emptyOutDir` is off because `tsc -p tsconfig.build.json` has
 * already written the ESM/type surface into `dist/` by the time this runs.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@kineglyph/core": "kineglyph" } },
  /**
   * The bundle runs in a plain page, and a plain page has no `process`.
   *
   * Several of the inlined CJS dependencies read `process.env.NODE_ENV` at *module-evaluation*
   * time, so without this the very first import a host performs throws
   * `ReferenceError: process is not defined`, `defineElement()` is never reached, and
   * `<pagina-editor>` sits in the DOM un-upgraded. Vite's dev server defines this for you, which
   * is exactly why `/__edit/` and everything else in this repo kept working while the published
   * artefact was dead on arrival — the Laravel integration found it, not us. `e2e/bundle.spec.ts`
   * loads the built file on a non-Vite server so that cannot happen again.
   *
   * `"production"` is correct for a distributed build: it is what strips React's development
   * warnings and dev-only code paths from what a host ships (1.80 MB → 1.29 MB here).
   *
   * `process: undefined` finishes the job. What is left after the two `process.env` rules is a
   * handful of `typeof process == "object" && typeof process.emit == "function"` guards — an
   * "am I running in Node?" test in an error reporter. Those cannot throw, but leaving them
   * would mean the check in `e2e/bundle.spec.ts` has to reason about which references are
   * guarded, and "no `process` in the bundle at all" is a rule that needs no reasoning. Telling
   * that guard it is not in Node is also simply true: it falls through to `console.error`, which
   * is what a browser wants.
   */
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": "{}",
    process: "undefined",
  },
  build: {
    target: "es2022",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("src/browser.ts", import.meta.url)),
      name: "Pagina",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "editor.js" : "editor.iife.js"),
    },
    rollupOptions: {
      external: ["kineglyph"],
      output: { assetFileNames: "editor.[ext]", globals: { kineglyph: "Kineglyph" } },
    },
  },
});
