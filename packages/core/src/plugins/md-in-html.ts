import type MarkdownIt from "markdown-it";

// MkDocs' `md_in_html` extension (a subset of python-markdown's, part of the "MkDocs subset"
// this dialect promises): an HTML block whose opening tag carries a `markdown="1|block|span"`
// attribute has its inner content parsed as Markdown instead of passed through verbatim. This
// is the idiom docs authors use for captioned figures:
//
//   <figure markdown="span">
//     ![alt](src){ width="480" }
//     <figcaption>Caption.</figcaption>
//   </figure>
//
// markdown-it's own `html_block` rule already isolates raw HTML into `html_block` tokens during
// block parsing; this core rule runs right after that ("block") rule and rewrites any such
// token whose content opens with a `markdown` attribute: the inner content (up to the matching
// closing tag at the end of the token) is rendered as Markdown — `md.render` for `1`/`block`,
// `md.renderInline` for `span` — and spliced back between the opening tag (with the `markdown`
// attribute stripped) and the closing tag. Any further raw HTML inside (e.g. `<figcaption>`)
// passes through untouched because `html: true` keeps it in the rendered Markdown.
//
// Limitation: this handles the common case where the whole `<tag markdown="…">…</tag>` element
// arrives as a single `html_block` token — true whenever there is no blank line between the
// opening and closing tag (true of every figure in Nucleation's docs). markdown-it's HTML block
// rules end a block at a blank line for "block-level" tag names (`div`, `figure`, … — the
// CommonMark type-6 list), so a blank line inside the element splits it across separate
// `html_block`/paragraph tokens instead of one; reassembling that general case is not attempted
// here — the content between (already outside any raw-HTML token at that point) still renders
// as ordinary Markdown, just without the `markdown` attribute being stripped from the tag text.
const OPEN_RE = /^<([a-zA-Z][\w-]*)\b([^>]*)\bmarkdown="(1|block|span)"([^>]*)>/;

export function mdInHtmlPlugin(md: MarkdownIt): void {
  md.core.ruler.after("block", "pg_md_in_html", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "html_block") continue;
      const m = OPEN_RE.exec(token.content);
      if (m === null) continue;
      const [openTag, tag, , mode] = m as unknown as [string, string, string, "1" | "block" | "span"];
      const closeTag = `</${tag}>`;
      const closeAt = token.content.toLowerCase().lastIndexOf(closeTag.toLowerCase());
      if (closeAt < openTag.length) continue; // no matching top-level closing tag in this token
      const inner = token.content.slice(openTag.length, closeAt);
      const trailing = token.content.slice(closeAt + closeTag.length);
      const openWithoutMarkdown = openTag.replace(/\s*markdown="(?:1|block|span)"/, "");
      const rendered = mode === "span" ? md.renderInline(inner, state.env) : md.render(inner, state.env);
      token.content = `${openWithoutMarkdown}${rendered}${closeTag}${trailing}`;
    }
  });
}
