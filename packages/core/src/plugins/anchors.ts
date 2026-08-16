import type MarkdownIt from "markdown-it";
import type { Heading } from "../types.js";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

export interface AnchorEnv { headings?: Heading[] | undefined; slugCounts?: Map<string, number> }

/**
 * Renders markdown that will be spliced into an enclosing `html_block` — today only
 * `markdown="1"` HTML blocks, whose inner markdown has to become HTML *inside* raw HTML that
 * the main token stream cannot represent. (Tabs and admonitions used to come through here too;
 * they now emit structured tokens, so their bodies are ordinary block tokens in the main stream.)
 *
 * Such a nested render runs while the outer document is still being parsed, i.e. before the
 * outer `pg_anchors` core rule has seen a single heading — so letting it push into the shared
 * `env.headings` would hoist every inner heading ahead of the outer ones. Instead the inner
 * headings are collected separately and handed back to the caller, which attaches them to the
 * emitted token as `token.meta.headings`; `pg_anchors` then splices them in at the token's own
 * position, keeping `headings[]` in document order.
 *
 * The slug-dedupe bookkeeping (`env.slugCounts`) deliberately stays shared, so ids remain unique
 * across the whole page.
 */
export function renderNested(md: MarkdownIt, text: string, env: unknown, inline = false): { html: string; headings: Heading[] } {
  const e = env as AnchorEnv;
  const outer = e.headings;
  e.headings = [];
  try {
    const html = inline ? md.renderInline(text, env) : md.render(text, env);
    return { html, headings: e.headings ?? [] };
  } finally {
    e.headings = outer;
  }
}

/** Headings collected by a nested render, parked on the token that carries their HTML. */
export interface NestedHeadings { headings?: readonly Heading[] }

export function anchorsPlugin(md: MarkdownIt): void {
  md.core.ruler.push("pg_anchors", (state) => {
    const env = state.env as AnchorEnv;
    const headings = (env.headings ??= []);
    const counts = (env.slugCounts ??= new Map());
    /** Records `base` and returns it suffixed if it has been handed out before. */
    const dedupe = (base: string): string => {
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return n === 1 ? base : `${base}-${n}`;
    };
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const nested = (t.meta as NestedHeadings | null | undefined)?.headings;
      if (nested !== undefined) headings.push(...nested);
      if (t.type !== "heading_open") continue;
      const inline = tokens[i + 1]!;
      const text = inline.children?.filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("") ?? "";
      // markdown-it-attrs has already applied an explicit `{#custom-id}`; keep it rather than
      // overwriting it with the slug, but still record it so a later slug can't collide with it.
      const explicit = t.attrGet("id");
      const id = explicit ?? dedupe(slugify(text));
      if (explicit !== null) dedupe(explicit);
      t.attrSet("id", id);
      headings.push({ id, text, level: Number(t.tag.slice(1)) });
    }
  });
}
