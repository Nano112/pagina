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

export interface AnchorEnv { headings?: Heading[]; slugCounts?: Map<string, number> }

export function anchorsPlugin(md: MarkdownIt): void {
  md.core.ruler.push("pg_anchors", (state) => {
    const env = state.env as AnchorEnv;
    env.headings ??= [];
    env.slugCounts ??= new Map();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.type !== "heading_open") continue;
      const inline = tokens[i + 1]!;
      const text = inline.children?.filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("") ?? "";
      const base = slugify(text);
      const n = (env.slugCounts.get(base) ?? 0) + 1;
      env.slugCounts.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      t.attrSet("id", id);
      env.headings.push({ id, text, level: Number(t.tag.slice(1)) });
    }
  });
}
