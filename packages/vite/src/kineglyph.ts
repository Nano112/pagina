import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The bare specifier `kineglyph`, used by scene modules and by inline `text/kineglyph`
 * scripts, maps to `@kineglyph/web/bundle`. That subpath has two entries: the raw
 * TypeScript source (`development`) which Vite serves and transforms in dev, and the
 * pre-built browser bundle (`import`) which is what a static build ships.
 *
 * `import.meta.resolve` cannot be used to pick between them — it applies whatever
 * conditions the *host* process installed (plain Node picks `import`, Vitest/Vite
 * prepend `development`), which is not necessarily the condition we want. So read the
 * package's own export map instead and pick the entry explicitly.
 */
export type KineglyphBundleCondition = "development" | "import";

const require_ = createRequire(import.meta.url);

/** Absolute path to the `@kineglyph/web/bundle` entry for the given export condition. */
export function resolveKineglyphBundle(condition: KineglyphBundleCondition): string {
  const pkgPath = require_.resolve("@kineglyph/web/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { exports?: Record<string, unknown> };
  const bundle = pkg.exports?.["./bundle"];
  const entry = typeof bundle === "object" && bundle !== null ? (bundle as Record<string, unknown>)[condition] : undefined;
  if (typeof entry !== "string")
    throw new Error(`@kineglyph/web: exports["./bundle"].${condition} is missing or not a string`);
  return fileURLToPath(new URL(entry, pathToFileURL(pkgPath)));
}

/** Root of the Kineglyph checkout/install that provides `@kineglyph/web` (for `server.fs.allow`). */
export function kineglyphRoot(): string {
  return resolve(dirname(require_.resolve("@kineglyph/web/package.json")), "../..");
}
