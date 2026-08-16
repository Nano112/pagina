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

/**
 * Parses a dedented block body into the *enclosing* token stream, so tab panels and admonition
 * bodies are ordinary block tokens rather than pre-rendered HTML. `bodyLine` is the line the body
 * starts on in the outer source: `readIndentedBody` keeps lines one-for-one, so shifting the
 * nested `token.map`s by it restores outer-document line numbers.
 */
export function parseBodyInto(state: StateBlock, body: string, bodyLine: number): void {
  const start = state.tokens.length;
  state.md.block.parse(body, state.md, state.env, state.tokens);
  for (let i = start; i < state.tokens.length; i++) {
    const t = state.tokens[i]!;
    t.level += state.level; // `block.parse` numbers its tokens from 0; they sit inside us
    if (t.map !== null) t.map = [t.map[0]! + bodyLine, t.map[1]! + bodyLine];
  }
}

/** Renderer bookkeeping on `pg_tabs_open` — the button row needs every label before the first panel. */
export interface TabsMeta { readonly labels: readonly string[]; readonly group: number }
/** Renderer bookkeeping on `pg_tab_open`: which group and panel this is, for the aria wiring. */
export interface TabMeta { readonly group: number; readonly index: number }

export function tabsPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "pg_tabs", (state, startLine, endLine, silent) => {
    const first = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]!);
    if (!TAB_RE.test(first) || state.sCount[startLine]! > 3) return false;
    if (silent) return true;
    const tabs: { label: string; body: string; bodyLine: number; end: number }[] = [];
    let line = startLine;
    while (line < endLine) {
      const text = state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!);
      const m = TAB_RE.exec(text);
      if (m === null || state.sCount[line]! > 3) break;
      const [body, next] = readIndentedBody(state, line + 1);
      tabs.push({ label: m[1]!, body, bodyLine: line + 1, end: next });
      line = next;
      while (line < endLine && state.isEmpty(line)) line++;
    }
    const env = state.env as { tabCounter?: number };
    const group = (env.tabCounter = (env.tabCounter ?? 0) + 1);
    const open = state.push("pg_tabs_open", "", 1);
    open.markup = "===";
    open.map = [startLine, line];
    open.meta = { labels: tabs.map((t) => t.label), group } satisfies TabsMeta;
    tabs.forEach((t, index) => {
      const tabOpen = state.push("pg_tab_open", "", 1);
      tabOpen.markup = "===";
      tabOpen.attrSet("label", t.label);
      tabOpen.map = [t.bodyLine - 1, t.end];
      tabOpen.meta = { group, index } satisfies TabMeta;
      parseBodyInto(state, t.body, t.bodyLine);
      state.push("pg_tab_close", "", -1).markup = "===";
    });
    state.push("pg_tabs_close", "", -1).markup = "===";
    state.line = line;
    return true;
  });

  md.renderer.rules["pg_tabs_open"] = (tokens, idx) => {
    const { labels, group } = tokens[idx]!.meta as TabsMeta;
    const buttons = labels
      .map((label, i) => `<button role="tab" aria-selected="${i === 0}" aria-controls="tab-${group}-${i}" id="tabbtn-${group}-${i}" tabindex="${i === 0 ? 0 : -1}">${md.utils.escapeHtml(label)}</button>`)
      .join("");
    return `<div class="pg-tabs" data-pg-tabs><div class="pg-tabs__list" role="tablist">${buttons}</div>\n`;
  };
  md.renderer.rules["pg_tabs_close"] = () => "</div>\n";
  md.renderer.rules["pg_tab_open"] = (tokens, idx) => {
    const { group, index } = tokens[idx]!.meta as TabMeta;
    return `<section role="tabpanel" id="tab-${group}-${index}" aria-labelledby="tabbtn-${group}-${index}"${index === 0 ? "" : " hidden"}>\n`;
  };
  md.renderer.rules["pg_tab_close"] = () => "</section>\n";
}
