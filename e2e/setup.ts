/**
 * A throwaway copy of the fixture article for the dev server to serve.
 *
 * The spec edits pages and uploads files; doing that to `packages/core/test/fixture` would leave
 * the repo dirty and would make the unit suites depend on whether the e2e lane had run.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { staticShell } from "@pagina/shell-static";
import { buildStatic } from "@pagina/vite";

export const ARTICLE = fileURLToPath(new URL(".tmp/article/", import.meta.url));
/** A second copy, for the static-host spec: two servers must not write to one folder. */
export const STATIC_ARTICLE = fileURLToPath(new URL(".tmp/static-article/", import.meta.url));
/**
 * A *published* site, built by `buildStatic` and served as flat files at `SITE_BASE`.
 *
 * `host-theming.spec.ts` compares the editor's preview against this — the actual artefact, on a
 * server that is not Vite. Both halves of the class of bug this guards (an unstyled preview
 * under a host reset, a `<link>` to a stylesheet no build writes) survived the dev server twice,
 * because the dev server resolves imports and browsers supply heading defaults.
 */
export const SITE = fileURLToPath(new URL(".tmp/site/", import.meta.url));
export const SITE_BASE = "/site/";
const FIXTURE = fileURLToPath(new URL("../packages/core/test/fixture/", import.meta.url));

/**
 * Every admonition the dialect has, in one page, for `admonitions.spec.ts`.
 *
 * It lives in the throwaway copy rather than in `packages/core/test/fixture/` because the fixture
 * is pinned by three unit suites that assert its exact page list, and a page added there for a
 * screenshot would be a page four other tests have to be told about. The static server renders
 * this same file two ways — published, through core, and open in the editor — so the two surfaces
 * are compared on identical source.
 */
export const ADMONITIONS_PAGE = "guide/admonitions.md";
export const ADMONITIONS_MARKDOWN = `# Admonitions

Every kind, so that a reader can tell them apart at a glance.

${["note", "tip", "info", "warning", "danger", "example", "quote"]
  .map((kind) => `!!! ${kind} "A ${kind} with a title"\n    The body of the ${kind}, with \`code\` and a [link](../index.md).`)
  .join("\n\n")}

!!! warning
    Untitled: the title resolves to the capitalised kind.

??? tip "A collapsible one, closed"
    You should not be able to see this until you open it.
`;

export default async function globalSetup(): Promise<void> {
  for (const target of [ARTICLE, STATIC_ARTICLE]) {
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await cp(FIXTURE, target, { recursive: true });
    await writeFile(join(target, ADMONITIONS_PAGE), ADMONITIONS_MARKDOWN, "utf8");
  }
  await rm(SITE, { recursive: true, force: true });
  await buildStatic({ folder: FIXTURE, outDir: SITE, shell: staticShell, base: SITE_BASE, strict: true });
}
