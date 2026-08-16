import type { Diagnostic, LinkRef } from "./types.js";

export function hrefOf(pagePath: string): string {
  const p = pagePath.replace(/\\/g, "/").replace(/\.md$/i, "");
  if (p === "index") return "/";
  return `/${p.replace(/\/index$/, "")}/`;
}

export function resolveRelative(fromPage: string, target: string): string {
  const dir = fromPage.includes("/") ? fromPage.slice(0, fromPage.lastIndexOf("/")) : "";
  const parts = (dir === "" ? [] : dir.split("/"));
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join("/");
}

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const ATTR = /\b(href|src|data-scene|srcset)="([^"]*)"/g;

export function rewriteLinks(html: string, opts: { pagePath: string; navPages: ReadonlySet<string>; assetPrefix: string; base: string }): { html: string; links: LinkRef[]; diagnostics: Diagnostic[] } {
  const links: LinkRef[] = [];
  const diagnostics: Diagnostic[] = [];
  const out = html.replace(ATTR, (whole, attr: string, value: string) => {
    if (value === "") return whole;
    if (value.startsWith("#")) { links.push({ raw: value, resolved: value }); return whole; } // same-page anchor; checked by renderArticle
    if (SKIP.test(value)) return whole;
    if (value.startsWith("/")) return whole; // already site-absolute (e.g. emitted by figures)
    const [pathPart, frag] = value.split("#") as [string, string | undefined];
    const resolved = resolveRelative(opts.pagePath, pathPart);
    if (/\.md$/i.test(resolved)) {
      if (!opts.navPages.has(resolved)) {
        diagnostics.push({ severity: "error", code: "link-unresolved", message: `link to "${value}" resolves to ${resolved}, which is not in nav`, page: opts.pagePath });
        links.push({ raw: value });
        return whole;
      }
      const href = `${opts.base.replace(/\/$/, "")}${hrefOf(resolved)}${frag === undefined ? "" : `#${frag}`}`;
      links.push({ raw: value, resolved: href });
      return `${attr}="${href}"`;
    }
    const href = `${opts.assetPrefix.replace(/\/$/, "")}/${resolved}${frag === undefined ? "" : `#${frag}`}`;
    links.push({ raw: value, resolved: href });
    return `${attr}="${href}"`;
  });
  return { html: out, links, diagnostics };
}
