#!/usr/bin/env node
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BUNDLE_EXTENSION, buildStatic, createDevServer, packBundle, unpackBundle, verifyBundleFile, type ThemeLevel } from "@pagina/vite";
import { staticShell, createHighlightedMarkdown } from "@pagina/shell-static";
import { BundleError, PaginaBuildError } from "@pagina/core";

const USAGE = [
  "usage: pagina dev|build <folder> [--out dist] [--base /] [--port 4321] [--host <addr>] [--edit] [--no-strict] [--theme full|tokens|none] [--no-chrome] [--site-url https://example.com]",
  "       pagina pack [folder] [-o article.pgz] [--base /] [--created <iso8601>]",
  "       pagina unpack <article.pgz> [dir] [--force]",
].join("\n");

let positionals: string[];
let values: { out?: string; base?: string; port?: string; host?: string; edit?: boolean; "no-strict"?: boolean; theme?: string; "no-chrome"?: boolean; "site-url"?: string; created?: string; force?: boolean };
try {
  ({ positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      base: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      edit: { type: "boolean" },
      "no-strict": { type: "boolean" },
      theme: { type: "string" },
      "no-chrome": { type: "boolean" },
      "site-url": { type: "string" },
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
const base = values.base ?? "/";
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
// the build says so per page. Validated here so a typo is a usage error, not a broken tag.
if (values["site-url"] !== undefined) {
  try {
    new URL(values["site-url"]);
  } catch {
    console.error(`--site-url must be an absolute URL (got "${values["site-url"]}")`);
    process.exit(2);
  }
}
const seo = values["site-url"] === undefined ? {} : { siteUrl: values["site-url"] };

const theming = {
  ...(values.theme === undefined ? {} : { theme: values.theme as ThemeLevel }),
  ...(values["no-chrome"] === true ? { chrome: false } : {}),
};

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
      shell: staticShell,
      md: md!,
      ...theming,
      ...seo,
    });
    for (const d of r.diagnostics) console.warn(`[${d.severity}] ${d.code} ${d.page ?? ""}: ${d.message}`);
    console.log(`pagina: wrote ${r.files.length} files`);
  } catch (e) {
    if (e instanceof PaginaBuildError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
