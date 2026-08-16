import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

const TAB_RE = /^=== "(.+)"\s*$/;

/** Reads a 4-space-indented body starting at `line`; returns [dedentedText, nextLine]. */
export function readIndentedBody(state: StateBlock, line: number): [string, number] {
  const out: string[] = [];
  let i = line;
  while (i < state.eMarks.length) {
    const end = state.eMarks[i]!;
    const start = state.bMarks[i]! + state.tShift[i]!;
    if (start >= end) { out.push(""); i++; continue; } // blank
    if (state.sCount[i]! < 4) break;
    const raw = state.src.slice(state.bMarks[i]!, end);
    out.push(raw.replace(/^(\t| {1,4})/, ""));
    i++;
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return [out.join("\n"), i];
}

export function tabsPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "pg_tabs", (state, startLine, endLine, silent) => {
    const first = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]!);
    if (!TAB_RE.test(first) || state.sCount[startLine]! > 3) return false;
    if (silent) return true;
    const tabs: { label: string; body: string }[] = [];
    let line = startLine;
    while (line < endLine) {
      const text = state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!);
      const m = TAB_RE.exec(text);
      if (m === null || state.sCount[line]! > 3) break;
      const [body, next] = readIndentedBody(state, line + 1);
      tabs.push({ label: m[1]!, body });
      line = next;
      while (line < endLine && state.isEmpty(line)) line++;
    }
    const env = state.env as { tabCounter?: number };
    const n = (env.tabCounter = (env.tabCounter ?? 0) + 1);
    const buttons = tabs
      .map((t, i) => `<button role="tab" aria-selected="${i === 0}" aria-controls="tab-${n}-${i}" id="tabbtn-${n}-${i}" tabindex="${i === 0 ? 0 : -1}">${md.utils.escapeHtml(t.label)}</button>`)
      .join("");
    const panels = tabs
      .map((t, i) => `<section role="tabpanel" id="tab-${n}-${i}" aria-labelledby="tabbtn-${n}-${i}"${i === 0 ? "" : " hidden"}>\n${md.render(t.body, state.env)}</section>`)
      .join("\n");
    const token = state.push("html_block", "", 0);
    token.content = `<div class="pg-tabs" data-pg-tabs><div class="pg-tabs__list" role="tablist">${buttons}</div>\n${panels}\n</div>\n`;
    token.map = [startLine, line];
    state.line = line;
    return true;
  });
}
