/**
 * The build's way of climbing the card-palette ladder: `node:fs`.
 *
 * The ladder itself, the `--pg-*` contract it reads and the defaults it starts from all live in
 * `@pagina/core`'s `og-palette.ts`, because the editor climbs the same rungs out of its store when
 * it publishes from a browser. What is left here is the one thing a build has and a browser does
 * not — a folder on disk — and the re-exports that keep `og-theme.js` the name the rest of this
 * package imports a palette from.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { composeCardPalette, type CardPalette, type CardPaletteSources, type Diagnostic, type OgScheme } from "@pagina/core";

export {
  DEFAULT_DARK, DEFAULT_LIGHT, applyTokens, readPgTokens,
  type CardPalette, type CardPaletteSources,
} from "@pagina/core";

/**
 * The palette a card is painted with, from the stylesheets this build can read.
 *
 * A stylesheet that is not there is not an error: the card keeps pagina's palette and the ladder
 * says so, which is `composeCardPalette`'s contract for a read that answers `undefined`.
 */
export async function resolveCardPalette(
  folder: string,
  scheme: OgScheme,
  sources: CardPaletteSources,
): Promise<{ readonly palette: CardPalette; readonly diagnostics: Diagnostic[] }> {
  return composeCardPalette(scheme, sources, async (rel, dir) => {
    try {
      return await readFile(resolve(folder, dir, rel), "utf8");
    } catch {
      return undefined;
    }
  });
}
