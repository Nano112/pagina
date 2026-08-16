/**
 * The browser bundle's entry (`dist/editor.js` / `dist/editor.iife.js`).
 *
 * It is `src/index.ts` plus the stylesheet, which is the one thing `tsc` cannot emit: Vite extracts
 * the CSS import into `dist/editor.css`, while the `tsc` build (whose output is what a bundler
 * consumer imports, and which resolves `./ui/theme.css` to nothing) skips this file entirely.
 *
 * `pagina dev --edit` loads `src/index.ts` directly and links `src/ui/theme.css` itself, so the
 * dev path never goes through here either.
 */
import "./ui/theme.css";

export * from "./index.js";
