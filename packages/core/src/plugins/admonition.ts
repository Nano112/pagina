import type MarkdownIt from "markdown-it";
import { parseBodyInto, readIndentedBody } from "./tabs.js";

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
    const open = state.push("pg_admonition_open", "", 1);
    open.markup = marker;
    open.attrSet("kind", kind);
    open.attrSet("title", title);
    open.attrSet("collapsible", marker === "???" ? "true" : "false");
    open.map = [startLine, next];
    parseBodyInto(state, body, startLine + 1);
    state.push("pg_admonition_close", "", -1).markup = marker;
    state.line = next;
    return true;
  });

  md.renderer.rules["pg_admonition_open"] = (tokens, idx) => {
    const token = tokens[idx]!;
    const cls = `pg-admonition pg-admonition--${md.utils.escapeHtml(token.attrGet("kind") ?? "")}`;
    const title = md.utils.escapeHtml(token.attrGet("title") ?? "");
    return token.attrGet("collapsible") === "true"
      ? `<details class="${cls}"><summary>${title}</summary>\n`
      : `<aside class="${cls}"><p class="pg-admonition__title">${title}</p>\n`;
  };
  md.renderer.rules["pg_admonition_close"] = (tokens, idx) => (tokens[idx]!.markup === "???" ? "</details>\n" : "</aside>\n");
}
