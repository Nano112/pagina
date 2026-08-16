import MarkdownIt from "markdown-it";
import attrsPluginRaw from "markdown-it-attrs";
import { escapeHtml } from "markdown-it/lib/common/utils.mjs";
import { anchorsPlugin, type AnchorEnv } from "./plugins/anchors.js";
import { tabsPlugin } from "./plugins/tabs.js";
import { admonitionPlugin } from "./plugins/admonition.js";
import { mdInHtmlPlugin } from "./plugins/md-in-html.js";
import type { Heading } from "./types.js";

export interface MarkdownOptions { readonly highlight?: (code: string, lang: string) => string }

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
  md.use(anchorsPlugin).use(attrsPlugin).use(tabsPlugin).use(admonitionPlugin).use(mdInHtmlPlugin);
  return md;
}

export function renderMarkdown(md: MarkdownIt, text: string): { html: string; headings: Heading[]; title: string } {
  const env: AnchorEnv & { tabCounter?: number } = {};
  const html = md.render(text, env);
  const headings = env.headings ?? [];
  const title = headings.find((h) => h.level === 1)?.text ?? "";
  return { html, headings, title };
}
