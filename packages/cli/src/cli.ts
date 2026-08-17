#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildStatic, createDevServer, type ThemeLevel } from "@pagina/vite";
import { staticShell, createHighlightedMarkdown } from "@pagina/shell-static";
import { PaginaBuildError } from "@pagina/core";

const USAGE = "usage: pagina dev|build <folder> [--out dist] [--base /] [--port 4321] [--host <addr>] [--edit] [--no-strict] [--theme full|tokens|none] [--no-chrome] [--site-url https://example.com]";

let positionals: string[];
let values: { out?: string; base?: string; port?: string; host?: string; edit?: boolean; "no-strict"?: boolean; theme?: string; "no-chrome"?: boolean; "site-url"?: string };
try {
  ({ positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      base: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      edit: { type: "boolean" },
      "no-strict": { type: "boolean" },
      theme: { type: "string" },
      "no-chrome": { type: "boolean" },
      "site-url": { type: "string" },
    },
  }));
} catch {
  console.error(USAGE);
  process.exit(2);
}
const [cmd, folderArg] = positionals;
if ((cmd !== "dev" && cmd !== "build") || folderArg === undefined) {
  console.error(USAGE);
  process.exit(2);
}
const folder = resolve(folderArg);
const base = values.base ?? "/";
const md = await createHighlightedMarkdown();

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

if (cmd === "dev") {
  // `--edit` makes the folder writable over HTTP for anyone who can reach the port, so it stays
  // opt-in per run and inherits the server's loopback-only default bind.
  const server = await createDevServer({
    folder, shell: staticShell, base, md, port, ...theming, ...seo,
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
      md,
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
