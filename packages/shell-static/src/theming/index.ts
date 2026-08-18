/**
 * `@pagina/shell-static/theming` — the theming showcase and the theme lab, and one call that wires
 * both from markup.
 *
 * These are documentation surfaces first: they are what `docs/theming.md` uses to *show* the token
 * contract instead of tabulating it. They are exported rather than kept in the docs folder because
 * they belong to the package that owns the contract — a host evaluating pagina can drop the lab
 * onto its own staging page, pick a palette against its own content, and paste the result. Nothing
 * in either module is pagina-docs-specific.
 */
export { IDENTITIES, PRESETS, identityCss, lineCount, themeCss, tokenBlock } from "./identities.js";
export type { Identity, Preset, ThemeLevel, TokenMap } from "./identities.js";
export { CONTROLLED_TOKENS, TOKEN_GROUPS } from "./catalogue.js";
export type { TokenControl, TokenGroup, TokenKind } from "./catalogue.js";
export { mountThemeLab, splitPreset } from "./lab.js";
export type { ThemeLabHandle, ThemeLabOptions } from "./lab.js";
export { mountThemeShowcase } from "./showcase.js";
export type { ThemeShowcaseHandle, ThemeShowcaseOptions } from "./showcase.js";

import { mountThemeLab, type ThemeLabHandle } from "./lab.js";
import { mountThemeShowcase, type ThemeShowcaseHandle } from "./showcase.js";

/**
 * Where this page's pagina stylesheet is, read off the page rather than passed in.
 *
 * The showcase's frames need an **absolute** URL — a `srcdoc` document resolves relative hrefs
 * against its embedder, which is right until the embedder is served without its trailing slash —
 * and the one thing every pagina page already carries is the `<link>` the shell emitted. Taking it
 * from there means the showcase works at a domain root, under a sub-path, and in the editor's
 * hand-written page, with nothing to keep in step.
 */
function stylesheets(doc: Document): { pagina: string; tokens: string } | undefined {
  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (!/pagina(\.tokens)?\.css(?=$|[?#])/.test(link.getAttribute("href") ?? "")) continue;
    const href = link.href;
    return {
      pagina: href.replace(/pagina\.tokens\.css(?=$|[?#])/, "pagina.css"),
      tokens: href.replace(/pagina\.css(?=$|[?#])/, "pagina.tokens.css"),
    };
  }
  return undefined;
}

export interface AutoMounted {
  readonly showcases: readonly ThemeShowcaseHandle[];
  readonly labs: readonly ThemeLabHandle[];
}

/**
 * Mounts every `[data-pg-theme-showcase]` and `[data-pg-theme-lab]` in the document.
 *
 * This exists so the page that uses them needs two empty elements and one line of script, which is
 * as much unchecked markup as a documentation page should ever contain. `data-floating="false"` on
 * a lab puts it in the flow instead of pinning it to the corner.
 */
export function autoMount(doc: Document = document): AutoMounted {
  const css = stylesheets(doc);
  const showcases: ThemeShowcaseHandle[] = [];
  const labs: ThemeLabHandle[] = [];
  if (css !== undefined) {
    for (const host of doc.querySelectorAll<HTMLElement>("[data-pg-theme-showcase]")) {
      showcases.push(mountThemeShowcase(host, { paginaCssUrl: css.pagina, tokensCssUrl: css.tokens }));
    }
  }
  for (const host of doc.querySelectorAll<HTMLElement>("[data-pg-theme-lab]")) {
    labs.push(mountThemeLab(host, { floating: host.dataset["floating"] !== "false", doc }));
  }
  return { showcases, labs };
}
