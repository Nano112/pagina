#!/usr/bin/env node
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BUNDLE_EXTENSION, buildStatic, createDevServer, packBundle, unpackBundle, verifyBundleFile, type ThemeLevel } from "@pagina/vite";
import { staticShell, createHighlightedMarkdown } from "@pagina/shell-static";
import { BundleError, PaginaBuildError } from "@pagina/core";

const USAGE = [
  "usage: pagina dev|build <folder> [--out dist] [--base /] [--port 4321] [--host <addr>] [--edit] [--as <name>] [--no-strict] [--theme full|tokens|none] [--no-chrome] [--strict-assets] [--no-search] [--site-url https://example.com/path/] [--mirror-of https://primary.example/path/]",
  "       pagina pack [folder] [-o article.pgz] [--base /] [--created <iso8601>] [--with-attribution]",
  "       pagina unpack <article.pgz> [dir] [--force]",
].join("\n");

let positionals: string[];
let values: { out?: string; base?: string; port?: string; host?: string; edit?: boolean; as?: string; "with-attribution"?: boolean; "no-strict"?: boolean; theme?: string; "no-chrome"?: boolean; "strict-assets"?: boolean; "no-search"?: boolean; "site-url"?: string; "mirror-of"?: string; created?: string; force?: boolean };
// Asking for help is not a usage error: it goes to stdout and exits 0, so `pagina --help` can
// be piped and the first command the docs tell a reader to run does not report failure. This
// sits above parseArgs because parseArgs throws on a flag it was not told about, and that
// throw is what used to turn a help request into exit 2.
if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  console.log(USAGE);
  process.exit(0);
}

try {
  ({ positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      base: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      edit: { type: "boolean" },
      // Who `--edit` records as the author. See `docs/editing.md`.
      as: { type: "string" },
      // Bundles carry no attribution unless asked: it is a staff list, and an export leaves.
      "with-attribution": { type: "boolean" },
      "no-strict": { type: "boolean" },
      theme: { type: "string" },
      "no-chrome": { type: "boolean" },
      // Turns the unreferenced-file report into a refusal. For the build that publishes something
      // you would mind leaking: nothing reaches the file, so nothing explains why it is going out.
      "strict-assets": { type: "boolean" },
      "no-search": { type: "boolean" },
      "site-url": { type: "string" },
      "mirror-of": { type: "string" },
      created: { type: "string" },
      force: { type: "boolean" },
    },
  }));
} catch {
  console.error(USAGE);
  process.exit(2);
}
const [cmd, folderArg] = positionals;
const COMMANDS = ["dev", "build", "pack", "unpack"];
if (cmd === undefined || !COMMANDS.includes(cmd)) {
  console.error(USAGE);
  process.exit(2);
}
// `pack` is the one command whose folder defaults: the folder it is run in is almost always the
// article, and `pagina pack` reads better than `pagina pack .`.
if (folderArg === undefined && cmd !== "pack") {
  console.error(USAGE);
  process.exit(2);
}
const folder = resolve(folderArg ?? ".");

/** An absolute URL, or a usage error naming the flag that was wrong. */
function absoluteUrlArg(flag: string, raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    console.error(`${flag} must be an absolute URL (got "${raw}")`);
    process.exit(2);
  }
}

/** A URL path as a base: always leading and trailing `/`, and `/` for the root. */
const asBase = (path: string): string => {
  const inner = path.replace(/^\/+|\/+$/g, "");
  return inner === "" ? "/" : `/${inner}/`;
};

// ---- where this build is going -----------------------------------------------------------------
// One article now has more than one home — schemat.io and a GitHub Pages mirror — so *where a build
// is served* is an input to the build, not a property of the folder. `--site-url` therefore takes
// the full deployment URL, path and all, and the path **is** the base: `--site-url
// https://user.github.io/Project/` alone produces both correct asset URLs and a correct canonical.
// Before this, the path was silently discarded and the canonical for that command was
// `https://user.github.io/` — a URL belonging to somebody else's site, with nothing in the output
// to show for it.
let siteUrlArg = values["site-url"];
let base = values.base ?? "/";
if (siteUrlArg !== undefined) {
  const u = absoluteUrlArg("--site-url", siteUrlArg);
  const fromUrl = asBase(u.pathname);
  if (values.base === undefined) base = fromUrl;
  else if (fromUrl !== "/" && asBase(values.base) !== fromUrl) {
    // Two answers to one question. Guessing which the author meant is how a site ends up half
    // deployed to a path it does not live at.
    console.error(`--site-url path "${fromUrl}" and --base "${values.base}" disagree; give one or make them match`);
    process.exit(2);
  }
  // The origin is what the SEO layer consumes; the path has been turned into `base` above.
  siteUrlArg = u.origin;
}
// A mirror declares which copy of the article counts. See `docs/deploying.md` for why this and not
// `noindex`: a page told not to be indexed is also never read, so it can never point at the primary.
if (values["mirror-of"] !== undefined) absoluteUrlArg("--mirror-of", values["mirror-of"]);
// `unpack` renders nothing, and the highlighter is the expensive part of starting up.
const md = cmd === "unpack" ? undefined : await createHighlightedMarkdown();

// Theming (see `docs/theming.md`): `--theme` picks how much pagina CSS the pages link, and
// `--no-chrome` drops pagina's own header row for a host that supplies one. Both are omitted
// from the options object when unset, so the shell keeps its own defaults.
if (values.theme !== undefined && !["full", "tokens", "none"].includes(values.theme)) {
  console.error(USAGE);
  process.exit(2);
}
// `--site-url` is what makes `link rel=canonical`, `og:url`, `og:image` and `sitemap.xml`
// possible; `article.yaml`'s `site_url` is the fallback, and with neither those are omitted and
// the build says so per page.
const seo = {
  ...(siteUrlArg === undefined ? {} : { siteUrl: siteUrlArg }),
  ...(values["mirror-of"] === undefined ? {} : { mirrorOf: values["mirror-of"] }),
};

const theming = {
  ...(values.theme === undefined ? {} : { theme: values.theme as ThemeLevel }),
  ...(values["no-chrome"] === true ? { chrome: false } : {}),
};

// `--no-search`: write no `_pagina/search.json` and render no search control. For a host that
// indexes its whole site itself — two search boxes on one page is worse than either of them.
const search = values["no-search"] === true ? { search: false } : {};

// Port precedence: `--port` flag > `PORT` env var > 4321, ignoring blank/non-numeric values
// (e.g. `PORT=""`). `gerry run`/`gerry dev` injects the sticky port it granted as the `PORT`
// env var, so a plain `pagina dev <folder>` run under gerry picks it up without needing the flag.
const port = [values.port, process.env.PORT].map((v) => Number(v)).find((n) => Number.isInteger(n) && n > 0) ?? 4321;
// `--host` / `HOST` env are opt-in only: omitted, `createDevServer` keeps its own
// loopback-only default.
const host = values.host ?? process.env.HOST;

/** The slug a bundle declares — read (and fully verified) without writing anything. */
async function peekSlug(file: string): Promise<string> {
  return (await verifyBundleFile(file)).manifest.slug;
}

if (cmd === "pack") {
  // Named after the folder rather than a fixed `bundle.pgz`: a downloads directory full of files
  // with one name tells nobody which article is which. `-o` overrides.
  const out = resolve(values.out ?? `${basename(folder)}${BUNDLE_EXTENSION}`);
  try {
    const r = await packBundle({
      folder, out, base,
      ...(md === undefined ? {} : { md }),
      ...(values.created === undefined ? {} : { created: values.created }),
      ...(values["with-attribution"] === true ? { withAttribution: true } : {}),
    });
    for (const d of r.diagnostics) console.warn(`[${d.severity}] ${d.code} ${d.page ?? ""}: ${d.message}`);
    console.log(`pagina: packed ${r.manifest.slug} — ${String(r.manifest.files.length)} files, ${String(r.size)} bytes → ${out}`);
  } catch (e) {
    if (e instanceof BundleError || e instanceof PaginaBuildError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
} else if (cmd === "unpack") {
  const file = resolve(folderArg!);
  const [, , dirArg] = positionals;
  try {
    // Without a destination, the article lands in a folder named after itself. The slug is only
    // known once the bundle has been read, so this needs the descriptor first.
    const r = await unpackBundle({
      file,
      dir: resolve(dirArg ?? (await peekSlug(file))),
      ...(values.force === true ? { force: true } : {}),
    });
    console.log(`pagina: unpacked ${r.manifest.slug} — ${String(r.files.length)} files → ${r.dir}`);
  } catch (e) {
    if (e instanceof BundleError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
} else if (cmd === "dev") {
  // `--edit` makes the folder writable over HTTP for anyone who can reach the port, so it stays
  // opt-in per run and inherits the server's loopback-only default bind.
  const server = await createDevServer({
    folder, shell: staticShell, base, md: md!, port, ...theming, ...seo,
    ...(host === undefined ? {} : { host }),
    ...(values.edit === true ? { edit: true } : {}),
    // `--as` names who the edit log records. Configuration, not a request field: the server is
    // told once who it is, and nothing a browser sends can change that answer.
    ...(values.as === undefined ? {} : { identity: { id: `cli:${values.as}`, name: values.as } }),
  });
  await server.listen();
  server.printUrls();
  if (values.edit === true) console.log("  ➜  Editor: /__edit/");
} else {
  try {
    const r = await buildStatic({
      folder,
      outDir: resolve(values.out ?? "dist"),
      base,
      strict: values["no-strict"] !== true,
      ...(values["strict-assets"] === true ? { strictAssets: true } : {}),
      shell: staticShell,
      md: md!,
      ...theming,
      ...search,
      ...seo,
    });
    for (const d of r.diagnostics) console.warn(`[${d.severity}] ${d.code} ${d.page ?? ""}: ${d.message}`);
    console.log(`pagina: wrote ${r.files.length} files`);
    if (values["mirror-of"] !== undefined)
      console.log(`pagina: mirror of ${values["mirror-of"]} — canonical and og:url point there, and no sitemap.xml was written`);
    // Not a diagnostic: nothing is broken and nothing in the folder can be changed to fix it. It is
    // a fact about the deployment that the person running the deploy has to act on once.
    if (r.robots.reason !== undefined) console.log(`pagina: ${r.robots.reason}`);
  } catch (e) {
    if (e instanceof PaginaBuildError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
