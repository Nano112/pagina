import type MarkdownIt from "markdown-it";
import { escapeHtml } from "markdown-it/lib/common/utils.mjs";
import { createHighlighter } from "shiki";
import { createMarkdown } from "@pagina/core";

// Kept small and explicit: only the languages pagina's own docs/snippets actually use.
const LANGS = [
  "python", "javascript", "typescript", "rust", "console", "bash", "shell",
  "json", "yaml", "toml", "html", "css", "kotlin", "php", "c", "cpp",
] as const;

/**
 * Builds a `MarkdownIt` instance wired to a shiki highlighter that emits dual light/dark
 * theme HTML (`.shiki` spans with `--shiki-light`/`--shiki-dark` custom properties; see
 * `client/pagina.css` for the `[data-theme="dark"]` hookup). The highlighter is created
 * once, up front, because `createHighlighter` is async while markdown-it's `highlight`
 * hook is synchronous.
 */
export async function createHighlightedMarkdown(): Promise<MarkdownIt> {
  const highlighter = await createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: [...LANGS],
  });
  return createMarkdown({
    highlight: (code, lang) => {
      try {
        return highlighter.codeToHtml(code, {
          lang: lang || "text",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
      } catch {
        return `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`;
      }
    },
  });
}
