import type MarkdownIt from "markdown-it";
import { readIndentedBody } from "./tabs.js";
import { renderNested, type NestedHeadings } from "./anchors.js";

const ADM_RE = /^(!!!|\?\?\?)\s+([\w-]+)(?:\s+"([^"]*)")?\s*$/;

export function admonitionPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "pg_admonition", (state, startLine, _endLine, silent) => {
    const text = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]!);
    const m = ADM_RE.exec(text);
    if (m === null || state.sCount[startLine]! > 3) return false;
    if (silent) return true;
    const [, marker, kind, rawTitle] = m as unknown as [string, string, string, string | undefined];
    const title = rawTitle ?? kind.charAt(0).toUpperCase() + kind.slice(1);
    const [body, next] = readIndentedBody(state, startLine + 1);
    const inner = renderNested(md, body, state.env);
    const cls = `pg-admonition pg-admonition--${md.utils.escapeHtml(kind)}`;
    const html =
      marker === "???"
        ? `<details class="${cls}"><summary>${md.utils.escapeHtml(title)}</summary>\n${inner.html}</details>\n`
        : `<aside class="${cls}"><p class="pg-admonition__title">${md.utils.escapeHtml(title)}</p>\n${inner.html}</aside>\n`;
    const token = state.push("html_block", "", 0);
    // See `renderNested`: these belong at this point in `headings[]`, not ahead of it.
    token.meta = { headings: inner.headings } satisfies NestedHeadings;
    token.content = html;
    token.map = [startLine, next];
    state.line = next;
    return true;
  });
}
