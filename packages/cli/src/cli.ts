#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildStatic, createDevServer } from "@pagina/vite";
import { staticShell, createHighlightedMarkdown } from "@pagina/shell-static";
import { PaginaBuildError } from "@pagina/core";

const USAGE = "usage: pagina dev|build <folder> [--out dist] [--base /] [--port 4321] [--host <addr>] [--no-strict]";

let positionals: string[];
let values: { out?: string; base?: string; port?: string; host?: string; "no-strict"?: boolean };
try {
  ({ positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      base: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      "no-strict": { type: "boolean" },
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

// Port precedence: `--port` flag > `PORT` env var > 4321, ignoring blank/non-numeric values
// (e.g. `PORT=""`). `gerry run`/`gerry dev` injects the sticky port it granted as the `PORT`
// env var, so a plain `pagina dev <folder>` run under gerry picks it up without needing the flag.
const port = [values.port, process.env.PORT].map((v) => Number(v)).find((n) => Number.isInteger(n) && n > 0) ?? 4321;
// `--host` / `HOST` env are opt-in only: omitted, `createDevServer` keeps its own
// loopback-only default.
const host = values.host ?? process.env.HOST;

if (cmd === "dev") {
  const server = await createDevServer({ folder, shell: staticShell, base, md, port, ...(host === undefined ? {} : { host }) });
  await server.listen();
  server.printUrls();
} else {
  try {
    const r = await buildStatic({
      folder,
      outDir: resolve(values.out ?? "dist"),
      base,
      strict: values["no-strict"] !== true,
      shell: staticShell,
      md,
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
