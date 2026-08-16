import MarkdownIt from "markdown-it";
import attrsPluginRaw from "markdown-it-attrs";
import { escapeHtml } from "markdown-it/lib/common/utils.mjs";
import { anchorsPlugin, type AnchorEnv } from "./plugins/anchors.js";
import { tabsPlugin } from "./plugins/tabs.js";
import { admonitionPlugin } from "./plugins/admonition.js";
import { mdInHtmlPlugin } from "./plugins/md-in-html.js";
import type { Heading } from "./types.js";

export interface MarkdownOptions {
  readonly highlight?: (code: string, lang: string) => string;
  /**
   * MkDocs' `md_in_html`: render markdown inside `<tag markdown="…">` HTML blocks (default true).
   * The editor turns this off — it keeps raw HTML blocks raw so they survive a round-trip, and
   * parses their inner markdown itself.
   */
  readonly mdInHtml?: boolean;
}

// markdown-it-attrs' .d.ts types its `md` param via `require("markdown-it")`, which resolves to
// @types/markdown-it's CJS declaration file; our ESM import resolves the .d.mts declaration file
// instead. Both describe the same runtime class but are structurally distinct types to TS
// (a dual-package-hazard artifact), hence the narrow cast at the single call site below.
const attrsPlugin = attrsPluginRaw as unknown as (md: MarkdownIt) => void;

export function createMarkdown(opts: MarkdownOptions = {}): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: false,
    typographer: false,
    highlight: (code, lang) => {
      if (opts.highlight !== undefined) return opts.highlight(code, lang);
      return `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`;
    },
  });
  md.use(anchorsPlugin).use(attrsPlugin).use(tabsPlugin).use(admonitionPlugin);
  if (opts.mdInHtml !== false) md.use(mdInHtmlPlugin);
  return md;
}

/**
 * Tokens, for consumers that need the document's structure rather than HTML (the editor):
 * `createMarkdown().parse(text, env)` yields the ordinary markdown-it stream plus this dialect's
 * structured tokens — `pg_tabs_open`/`pg_tab_open`(attr `label`)/`pg_tab_close`/`pg_tabs_close`
 * and `pg_admonition_open`(attrs `kind`, `title`, `collapsible`)/`pg_admonition_close` — whose
 * bodies are ordinary block tokens between the open/close pair, and whose HTML comes from the
 * renderer rules the plugins install.
 */
export function renderMarkdown(md: MarkdownIt, text: string): { html: string; headings: Heading[]; title: string } {
  const env: AnchorEnv & { tabCounter?: number } = {};
  const html = md.render(text, env);
  const headings = env.headings ?? [];
  const title = headings.find((h) => h.level === 1)?.text ?? "";
  return { html, headings, title };
}
