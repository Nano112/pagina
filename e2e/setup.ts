/**
 * A throwaway copy of the fixture article for the dev server to serve.
 *
 * The spec edits pages and uploads files; doing that to `packages/core/test/fixture` would leave
 * the repo dirty and would make the unit suites depend on whether the e2e lane had run.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { staticShell } from "@pagina/shell-static";
import { buildStatic } from "@pagina/vite";
import { recordWorkingDirectories } from "./cwd-guard.js";

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
 * The same article, published again with a Kineglyph theme module of its own.
 *
 * The fixture deliberately declares none — it is the "follows its host's tokens" case, which
 * `host-theming.spec.ts` covers — and that is exactly why the *other* case had no coverage at all
 * and stayed broken: an article that ships a theme had it applied when its figures were drawn and
 * then overruled when they were painted, because `pagina.css` points every `--kg-color-*` at a
 * `--pg-*`. `figure-theme.spec.ts` measures the published artefact instead of the markup.
 */
/**
 * The same article with **no cover**, which is the only shape that draws a social card.
 *
 * The fixture sets `cover:` at the article level, so every one of its pages inherits an author's
 * image and the precedence rule correctly skips them all — which is right, and which means the
 * fixture can say nothing at all about cards. This copy drops the cover and turns on a glyph, so
 * both rasterisers have the same eleven pictures to draw and `og-cards.spec.ts` has something to
 * compare.
 */
export const CARDS_ARTICLE = fileURLToPath(new URL(".tmp/cards-article/", import.meta.url));
export const CARDS_SITE = fileURLToPath(new URL(".tmp/cards-site/", import.meta.url));
export const CARDS_BASE = "/cards-site/";

export const THEMED_ARTICLE = fileURLToPath(new URL(".tmp/themed-article/", import.meta.url));
export const THEMED_SITE = fileURLToPath(new URL(".tmp/themed-site/", import.meta.url));
export const THEMED_BASE = "/themed/";

/** The article's palette. Deliberately nothing near pagina's own, so a mix-up is unmistakable. */
export const THEMED_COLORS = {
  light: { canvas: "#f4f1e9", accent: "#237f74" },
  dark: { canvas: "#101216", accent: "#67cbbb" },
};

/**
 * A theme module as an article ships one: a bare `kineglyph` import, resolved server-side by the
 * builder and client-side by the page's import map. Written from `defaultTheme` so only the two
 * colours under test differ from it — anything else that moves is this file's fault, not a theme's.
 */
const THEME_MODULE = `import { defaultTheme } from "kineglyph";

const tint = (colors) => ({ ...defaultTheme, colors: { ...defaultTheme.colors, ...colors } });

export const light = tint(${JSON.stringify(THEMED_COLORS.light)});
export const dark = tint(${JSON.stringify(THEMED_COLORS.dark)});
`;

/** The one colour the scoped palette claims. Not near anything else here, so a mix-up is visible. */
export const SCOPED_CANVAS = "#ff00ff";

/**
 * A palette a single `<figure>` can name — and the shape that makes level 5 mean anything.
 *
 * `createTheme` rather than a spread over `defaultTheme`, and that is the whole difference: naming
 * a colour *claims* it, so this theme asserts `canvas` and inherits the other nineteen roles. The
 * figure that names it therefore holds one colour against the page and still follows it everywhere
 * else — which is what "scoped" has to mean, and what a full-palette override could not
 * demonstrate, because a figure that overrode everything would look right for the wrong reason.
 */
const SCOPED_THEME_MODULE = `import { createTheme } from "kineglyph";

export const light = createTheme({ colors: { canvas: "${SCOPED_CANVAS}" } });
export const dark = light;
`;

/**
 * Three figures, one page: the whole of the figure-level cascade in a form a browser can measure.
 *
 * They are neighbours on purpose. "Scoped" is not a property of the declaring figure, it is a
 * property of the ones beside it — a declaration that leaked would still look correct on the figure
 * that made it, and only the neighbour would say so.
 */
export const FIGURE_THEMES_PAGE = "guide/figure-themes.md";
const scene = '<figure class="kg" data-scene="../scenes/demo.mjs"';
export const FIGURE_THEMES_MARKDOWN = `# Figure themes

## Declares one

${scene} id="fig-declared" data-theme="scoped"></figure>

## Declares nothing

${scene} id="fig-neighbour"></figure>

## Declines, out loud

${scene} id="fig-inherit" data-theme="inherit"></figure>
`;

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

  await rm(THEMED_ARTICLE, { recursive: true, force: true });
  await mkdir(join(THEMED_ARTICLE, "theme"), { recursive: true });
  await cp(FIXTURE, THEMED_ARTICLE, { recursive: true });
  // `article.yaml` declares `../outside` as a snippet root, and one page includes from it — so the
  // sibling has to come along, or the build fails on a missing snippet rather than on anything
  // this copy is for.
  await cp(fileURLToPath(new URL("../packages/core/test/outside/", import.meta.url)), join(THEMED_ARTICLE, "..", "outside"), { recursive: true });
  await writeFile(join(THEMED_ARTICLE, "theme/kineglyph.mjs"), THEME_MODULE, "utf8");
  await writeFile(join(THEMED_ARTICLE, "theme/scoped.mjs"), SCOPED_THEME_MODULE, "utf8");
  await writeFile(join(THEMED_ARTICLE, FIGURE_THEMES_PAGE), FIGURE_THEMES_MARKDOWN, "utf8");
  const config = await readFile(join(FIXTURE, "article.yaml"), "utf8");
  // The fixture's `nav:` is the last thing in the file and ends on a `children:` list, so the new
  // page appends as one more child at that indent rather than needing the YAML re-emitted.
  await writeFile(
    join(THEMED_ARTICLE, "article.yaml"),
    `${config}      - { title: Figure themes, page: ${FIGURE_THEMES_PAGE} }\n\nkineglyph:\n  theme: theme/kineglyph.mjs\n  themes:\n    scoped: theme/scoped.mjs\n`,
    "utf8",
  );
  await rm(THEMED_SITE, { recursive: true, force: true });
  await buildStatic({ folder: THEMED_ARTICLE, outDir: THEMED_SITE, shell: staticShell, base: THEMED_BASE, strict: true });

  // The cards article: the fixture, minus its cover, built and left ready to be published from a
  // browser. `og-cards.spec.ts` publishes it through the editor and compares what the browser drew
  // against what resvg drew here.
  await rm(CARDS_ARTICLE, { recursive: true, force: true });
  await mkdir(CARDS_ARTICLE, { recursive: true });
  await cp(FIXTURE, CARDS_ARTICLE, { recursive: true });
  await cp(fileURLToPath(new URL("../packages/core/test/outside/", import.meta.url)), join(CARDS_ARTICLE, "..", "outside"), { recursive: true });
  await writeFile(
    join(CARDS_ARTICLE, "article.yaml"),
    `${(await readFile(join(FIXTURE, "article.yaml"), "utf8")).replace(/^cover: .*\n/m, "")}\nog:\n  template: editorial\n`,
    "utf8",
  );
  await rm(CARDS_SITE, { recursive: true, force: true });
  await buildStatic({ folder: CARDS_ARTICLE, outDir: CARDS_SITE, shell: staticShell, base: CARDS_BASE, strict: true });

  // Everything above is deliberate and gitignored. From here on, anything new in the working
  // directory is a leak — see `e2e/cwd-guard.ts`.
  await recordWorkingDirectories();
}
