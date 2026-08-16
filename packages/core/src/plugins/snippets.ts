import type { ContentFs, Diagnostic } from "../types.js";

export interface SnippetContext { readonly fs: ContentFs; readonly roots: readonly string[]; readonly pagePath: string }

const DIRECTIVE = /^(\s*)--8<--\s+"([^"]+)"\s*$/;

function joinPosix(...parts: string[]): string {
  const out: string[] = [];
  for (const seg of parts.join("/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (out.length > 0 && out[out.length - 1] !== "..") out.pop(); else out.push(".."); continue; }
    out.push(seg);
  }
  return out.join("/");
}

function extractSection(text: string, section: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes(`--8<-- [start:${section}]`));
  if (start === -1) return undefined;
  const end = lines.findIndex((l, i) => i > start && l.includes(`--8<-- [end:${section}]`));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines.filter((l) => l.trim() !== "").map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((l) => l.slice(Math.min(min, /^[ \t]*/.exec(l)![0].length))).join("\n");
}

export async function expandSnippets(markdown: string, ctx: SnippetContext): Promise<{ text: string; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const out: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = DIRECTIVE.exec(line);
    if (m === null) { out.push(line); continue; }
    const [, indent, ref] = m as unknown as [string, string, string];
    const [path, section] = ref.split(":") as [string, string | undefined];
    let content: string | undefined;
    for (const root of ctx.roots) {
      const candidate = joinPosix(root, path);
      if (!(await ctx.fs.exists(candidate))) continue;
      const file = (await ctx.fs.read(candidate)).replace(/\r\n?/g, "\n");
      content = section === undefined ? file.replace(/\n$/, "") : extractSection(file, section);
      if (content === undefined) break; // file found, section missing → report
      break;
    }
    if (content === undefined) {
      diagnostics.push({ severity: "error", code: "snippet-missing", message: `--8<-- "${ref}" not found in roots [${ctx.roots.join(", ")}]`, page: ctx.pagePath });
      out.push(`${indent}<!-- snippet missing: ${ref} -->`);
      continue;
    }
    for (const l of dedent(content).split("\n")) out.push(l === "" ? "" : indent + l);
  }
  return { text: out.join("\n"), diagnostics };
}
