/**
 * The browser bundle.
 *
 * Two formats, because two kinds of host exist: `dist/editor.js` for a page with an import map or a
 * bundler, and `dist/editor.iife.js` (global `Pagina`) for a `<script>` tag — which is how the
 * Laravel package will ship it, the way Livewire ships its JS.
 *
 * React is bundled (a host page must not have to install it); `kineglyph` is not, because the
 * preview has to hydrate figures on the *same* runtime instance the site's own pages use, which
 * the page's import map decides. `emptyOutDir` is off because `tsc -p tsconfig.build.json` has
 * already written the ESM/type surface into `dist/` by the time this runs.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
