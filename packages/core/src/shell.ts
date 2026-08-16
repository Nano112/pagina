import type { RenderedArticle } from "./types.js";

/**
 * Context a shell gets for one render pass. All URLs are site URLs (they include `base`).
 *
 * This lives in `@pagina/core` rather than next to the build that supplies it, so a shell
 * implementation (`@pagina/shell-static` and any third-party one) can type itself against the
 * contract without taking a dependency on the Vite-based builder that happens to call it.
 * `@pagina/vite` re-exports both types for compatibility.
 */
export interface ShellContext {
  readonly base: string;
  readonly kineglyphRuntimeUrl: string;
  readonly clientUrl: string;
  readonly cssUrl: string;
  readonly dev: boolean;
  /** The dev server is running with `--edit`, so a shell may offer an "Edit this page" link
   *  into `/__edit/<href>`. Absent (or false) everywhere else, including every static build. */
  readonly edit?: boolean;
}

/** A page shell: turns a rendered article into files (`out path` → contents). */
export interface Shell {
  readonly clientEntry: string;
  render(article: RenderedArticle, ctx: ShellContext): Promise<Record<string, string | Uint8Array>>;
}
