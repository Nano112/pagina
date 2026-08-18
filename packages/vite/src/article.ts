import { parseArticleConfig, renderArticle, type ArticleConfig, type Diagnostic, type RenderedArticle } from "@pagina/core";
import type MarkdownIt from "markdown-it";
import { NodeContentFs } from "./node-fs.js";
import { gitIgnoredPaths } from "./gitignore.js";

/**
 * Everything this folder excludes beyond the built-in defaults and its own `exclude` list — which
 * today means whatever git ignores — and what to tell the author about it.
 *
 * Reported rather than applied silently. Honouring `.gitignore` is the right default (it is where
 * "not for publication" is already written, and it is what would have kept a directory of internal
 * notes off the public web), but a default that removes files without saying so is exactly the
 * kind of quiet behaviour this work exists to remove. So every build that drops something names
 * how much and, up to a readable number, which.
 */
export async function folderExclusions(
  folder: string,
  fs: NodeContentFs,
  config: ArticleConfig,
): Promise<{ exclude: string[]; gitIgnored: Set<string>; diagnostics: Diagnostic[] }> {
  const none = { exclude: [], gitIgnored: new Set<string>(), diagnostics: [] };
  if (!config.excludeGitignore) return none;
  const all = await fs.list(".");
  const ignored = await gitIgnoredPaths(folder, all);
  if (ignored === undefined || ignored.size === 0) return none;
  const named = [...ignored].sort();
  const shown = named.slice(0, 10);
  return {
    // As literal paths, not as patterns: git already decided, and re-expressing its answer as a
    // glob is a second matcher that can disagree with the first.
    exclude: named,
    gitIgnored: ignored,
    diagnostics: [{
      severity: "warning",
      code: "gitignored-excluded",
      message: `git ignores ${String(ignored.size)} file(s) in this folder, so they were not published: ${shown.join(", ")}${named.length > shown.length ? `, and ${String(named.length - shown.length)} more` : ""}. Set \`exclude_gitignore: false\` in article.yaml to publish them anyway.`,
    }],
  };
}

export interface ResolveArticleOptions {
  readonly folder: string;
  readonly base: string;
  readonly strict: boolean;
  readonly md?: MarkdownIt;
  readonly siteUrl?: string;
}

export interface ResolvedArticle {
  readonly fs: NodeContentFs;
  readonly config: ArticleConfig;
  readonly article: RenderedArticle;
  readonly containment: Awaited<ReturnType<typeof folderExclusions>>;
  /** The article's own diagnostics plus the containment pass's, in the order they were produced. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * One answer to "what is this folder's article", for both `pagina build` and `pagina dev`.
 *
 * It exists because the two used to compute it separately and therefore differently. The dev
 * server called {@link renderArticle} with no `exclude` at all, so it served files a build refuses
 * to publish; and it dropped the diagnostics on the floor, so a page that failed to render simply
 * *was not there* — the request fell through to Vite and the author got "Cannot GET /" with nothing
 * anywhere saying why. A nav entry naming a file that does not exist is the everyday way into that:
 * it is an error a build states and stops on, and it used to be a silent 404 in dev. Worse, an
 * `article.yaml` with **no `nav:` at all** has no pages by construction, so a build wrote a site of
 * zero pages and exited 0 while the dev server 404'd at `/` — the two disagreeing about whether the
 * folder is an article at all.
 *
 * So both paths come through here: same config, same exclusions, same render, same diagnostics.
 * What differs between them is only what they *do* with the result — a build refuses, a dev server
 * logs and keeps serving — which is a policy difference an author can see, not a hidden one.
 */
export async function resolveArticle(o: ResolveArticleOptions): Promise<ResolvedArticle> {
  const fs = new NodeContentFs(o.folder);
  const config = parseArticleConfig(await fs.read("article.yaml"));
  // What the folder says is not for publication, before anything is read as content. `.gitignore`
  // is asked first because it is the answer that already exists — see `gitignore.ts`.
  const containment = await folderExclusions(o.folder, fs, config);
  const article = await renderArticle({
    fs, strict: o.strict, base: o.base,
    ...(containment.exclude.length === 0 ? {} : { exclude: containment.exclude }),
    ...(o.md === undefined ? {} : { md: o.md }),
    ...(o.siteUrl === undefined ? {} : { siteUrl: o.siteUrl }),
  });
  return { fs, config, article, containment, diagnostics: [...article.diagnostics, ...containment.diagnostics] };
}

/**
 * An article with no pages, said plainly.
 *
 * `nav` is what makes a markdown file a page, so a folder that never wrote one renders to nothing —
 * and "nothing" reads identically to "the server is broken" from the outside. Neither lane can
 * usefully guess a nav (the order is the author's, and inventing one publishes drafts), so both
 * say so instead: a build warns, and the dev server logs it beside the 404 it is about to serve.
 */
export function emptyArticleDiagnostic(article: RenderedArticle): Diagnostic | undefined {
  if (Object.keys(article.pages).length > 0) return undefined;
  return {
    severity: "warning",
    code: "no-pages",
    message: "this folder has no pages: `nav` in article.yaml is empty or missing, and `nav` is what makes a markdown file a page. Add one entry per page, in reading order.",
  };
}
