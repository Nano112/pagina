#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildStatic, createDevServer } from "@pagina/vite";
import { staticShell, createHighlightedMarkdown } from "@pagina/shell-static";
import { PaginaBuildError } from "@pagina/core";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    base: { type: "string" },
    port: { type: "string" },
    strict: { type: "boolean", default: true },
    "no-strict": { type: "boolean" },
  },
});
const [cmd, folderArg] = positionals;
if ((cmd !== "dev" && cmd !== "build") || folderArg === undefined) {
  console.error("usage: pagina dev|build <folder> [--out dist] [--base /] [--port 4321] [--no-strict]");
  process.exit(2);
}
const folder = resolve(folderArg);
const base = values.base ?? "/";
const md = await createHighlightedMarkdown();

// Port precedence: `--port` flag > `PORT` env var > 4321. `gerry run`/`gerry dev` injects the
// sticky port it granted as the `PORT` env var, so a plain `pagina dev <folder>` run under
// gerry picks it up without needing the flag.
const portFromFlag = values.port === undefined ? undefined : Number(values.port);
const portFromEnv = process.env.PORT === undefined ? undefined : Number(process.env.PORT);
const port = portFromFlag ?? portFromEnv ?? 4321;

if (cmd === "dev") {
  const server = await createDevServer({ folder, shell: staticShell, base, md, port });
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
