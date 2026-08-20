/**
 * The card font, into `dist/`, so a host that publishes the editor bundle publishes the font too.
 *
 * Social cards are drawn in the browser at publish time, and an SVG rasterised through an `<img>`
 * cannot fetch a font — it has to carry one, inlined. So the bytes have to be reachable from the
 * page, which means beside `editor.js`: the one location every host arrangement already shares
 * (`vendor/pagina/` under Laravel, `editor/` on the docs site).
 *
 * Copied from `@pagina/vite`, which owns the file because the *build* rasteriser reads it straight
 * off disk and has no reason for a second copy. One font, one licence, two readers.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
await mkdir(fileURLToPath(dist), { recursive: true });
await copyFile(
  fileURLToPath(new URL("../../vite/fonts/InstrumentSans-VF.ttf", import.meta.url)),
  fileURLToPath(new URL("pagina-card-font.ttf", dist)),
);
// The OFL requires the licence to travel with the font. It travels with it.
await copyFile(
  fileURLToPath(new URL("../../vite/fonts/OFL.txt", import.meta.url)),
  fileURLToPath(new URL("pagina-card-font.OFL.txt", dist)),
);
