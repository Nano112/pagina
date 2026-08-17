import type MarkdownIt from "markdown-it";
import { parseBodyInto, readIndentedBody } from "./tabs.js";

const ADM_RE = /^(!!!|\?\?\?)\s+([\w-]+)(?:\s+"([^"]*)")?\s*$/;

/**
 * The kinds the dialect names, and the glyph each one carries.
 *
 * An admonition's *kind* is the only thing separating "by the way" from "this will destroy your
 * data", and until now the published page expressed it as a 3px stripe in a colour — which is to
 * say `danger` and `note` were the same block with a different hue, and a reader skimming got
 * nothing. Each kind therefore gets an icon as well as a hue, and the icon is inline SVG rather
 * than a font or a sprite because the published page must not acquire a request or a dependency
 * to render a callout.
 *
 * The path data is lucide's (ISC), the same icon set the editor uses, so the block an author sees
 * while writing and the block a reader sees are the same block. An unknown kind falls back to
 * `note`'s glyph rather than rendering nothing: the class is still emitted, so a host that has
 * taught its stylesheet about `!!! spoiler` keeps working.
 */
const ICONS: Record<string, string> = {
  note: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  tip: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  danger: '<path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z"/>',
  example: '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
};

/** The kinds with a hue and a glyph of their own. Anything else still renders, as a `note`. */
export const ADMONITION_KINDS = Object.keys(ICONS) as readonly string[];

const CHEVRON = '<path d="m9 18 6-6-6-6"/>';

/** One 24×24 stroke icon, sized in `em` so it tracks the title's type rather than the page's. */
const icon = (cls: string, body: string): string =>
  `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

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
    const kind = token.attrGet("kind") ?? "";
    const title = md.utils.escapeHtml(token.attrGet("title") ?? "");
    const glyph = icon("pg-admonition__icon", ICONS[kind] ?? ICONS["note"]!);
    // `!!! kind ""` is the author asking for no title bar text at all — MkDocs' convention — so
    // the label is dropped and only the glyph remains. The bar itself stays: a `<details>` needs
    // a summary to be openable, and the icon is what still says which kind this is.
    const label = title === "" ? "" : `<span class="pg-admonition__label">${title}</span>`;
    const classes = ["pg-admonition", `pg-admonition--${md.utils.escapeHtml(kind)}`];
    if (title === "") classes.push("pg-admonition--untitled");
    if (token.attrGet("collapsible") === "true") {
      return `<details class="${classes.join(" ")} pg-admonition--collapsible"><summary class="pg-admonition__title">${glyph}${label}${icon("pg-admonition__chevron", CHEVRON)}</summary>\n`;
    }
    return `<aside class="${classes.join(" ")}"><p class="pg-admonition__title">${glyph}${label}</p>\n`;
  };

  md.renderer.rules["pg_admonition_close"] = (tokens, idx) => (tokens[idx]!.markup === "???" ? "</details>\n" : "</aside>\n");
}
