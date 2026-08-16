import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { HttpBackend } from "@pagina/editor/store";
import { createDevServer, pagePathForHref, renderEditPage } from "../src/index.js";
import { stubShell } from "./stub-shell.js";

const fixture = new URL("../../core/test/fixture/", import.meta.url).pathname;

describe("renderEditPage", () => {
  const page = renderEditPage({
    backendUrl: "/__pagina/edit",
    page: "guide/tabs.md",
    base: "/",
    kineglyphRuntimeUrl: "/@fs/kg/bundle.ts",
    editorEntryUrl: "/@fs/editor/src/index.ts",
    siteCssUrl: "/@fs/shell/pagina.css",
    editorCssUrl: "/@fs/editor/src/ui/theme.css",
  });

  it("registers the custom element from the editor entry", () => {
    expect(page).toContain(`<script type="module" src="/@fs/editor/src/index.ts"></script>`);
    expect(page).toContain(`import { defineElement } from "/@fs/editor/src/index.ts"; defineElement();`);
    expect(page).toContain(`<pagina-editor backend-url="/__pagina/edit" page="guide/tabs.md" base="/">`);
  });

  it("carries the site's import map and both stylesheets", () => {
    expect(page).toContain(`{"imports":{"kineglyph":"/@fs/kg/bundle.ts"}}`);
    expect(page).toContain(`<link rel="stylesheet" href="/@fs/shell/pagina.css">`);
    expect(page).toContain(`<link rel="stylesheet" href="/@fs/editor/src/ui/theme.css">`);
  });

  it("omits the editor stylesheet when the build has none", () => {
    const bare = renderEditPage({
      backendUrl: "/b", page: "index.md", base: "/",
      kineglyphRuntimeUrl: "/kg", editorEntryUrl: "/e", siteCssUrl: "/c",
    });
    expect(bare).not.toContain("theme.css");
  });

  it("maps hrefs to markdown paths", () => {
    expect(pagePathForHref("/")).toBe("index.md");
    expect(pagePathForHref("")).toBe("index.md");
    expect(pagePathForHref("/guide/tabs/")).toBe("guide/tabs.md");
    expect(pagePathForHref("/guide/tabs/index.html")).toBe("guide/tabs.md");
    expect(pagePathForHref("/guide/tabs.md")).toBe("guide/tabs.md");
  });
});

/** `"v1"` / `W/"v1"` → `v1`, matching what `HttpBackend` does client-side. */
const unquote = (raw: string | null): string => (raw ?? "").replace(/^W\//, "").replace(/^"|"$/g, "");

describe("pagina dev --edit", () => {
  let server: ViteDevServer;
  let folder: string;
  let outside: string;
  let origin: string;
  let api: string;

  beforeAll(async () => {
    // A temp copy: every test in here writes to the folder, and the fixture is shared.
    folder = await mkdtemp(join(tmpdir(), "pagina-edit-"));
    await cp(fixture, folder, { recursive: true });

    // A separate tree the folder must never be able to reach, plus the two symlinks that would
    // reach it if containment were lexical only.
    outside = await mkdtemp(join(tmpdir(), "pagina-outside-"));
    await writeFile(join(outside, "secret.txt"), "top secret\n");
    await symlink(join(outside, "secret.txt"), join(folder, "escape.txt"));
    await symlink(outside, join(folder, "escape-dir"));
    server = await createDevServer({ folder, shell: stubShell, port: 0, host: "127.0.0.1", edit: true });
    await server.listen();
    const addr = server.httpServer!.address() as AddressInfo;
    origin = `http://127.0.0.1:${addr.port}`;
    api = `${origin}/__pagina/edit`;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (folder !== undefined) await rm(folder, { recursive: true, force: true });
    if (outside !== undefined) await rm(outside, { recursive: true, force: true });
  });

  it("lists the folder, skipping dotfiles and node_modules", async () => {
    const res = await fetch(`${api}/files`);
    expect(res.status).toBe(200);
    const { files } = (await res.json()) as { files: { path: string; version: string; size?: number }[] };
    const paths = files.map((f) => f.path);
    expect(paths).toContain("index.md");
    expect(paths).toContain("guide/tabs.md");
    expect(paths).toContain("article.yaml");
    expect(paths.some((p) => p.split("/").some((s) => s.startsWith(".") || s === "node_modules"))).toBe(false);
    const index = files.find((f) => f.path === "index.md")!;
    expect(index.version).toMatch(/^[0-9a-f]{40}$/);
    expect(index.size).toBeGreaterThan(0);
  }, 30_000);

  it("reads a text file with the version as ETag", async () => {
    const res = await fetch(`${api}/files/index.md?responseType=text`, { headers: { Accept: "text/plain, */*" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(unquote(res.headers.get("ETag"))).toMatch(/^[0-9a-f]{40}$/);
    expect(await res.text()).toBe(await readFile(join(folder, "index.md"), "utf8"));
  }, 30_000);

  it("reads a binary file with a type from its extension", async () => {
    const res = await fetch(`${api}/files/media/static.svg?responseType=binary`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }, 30_000);

  it("writes with a matching If-Match and changes the file on disk", async () => {
    const read = await fetch(`${api}/files/guide/tabs.md?responseType=text`);
    const version = unquote(read.headers.get("ETag"));

    const res = await fetch(`${api}/files/guide/tabs.md`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8", "If-Match": `"${version}"` },
      body: "# Tabs\n\nrewritten by the edit middleware\n",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string };
    expect(body.version).toMatch(/^[0-9a-f]{40}$/);
    expect(body.version).not.toBe(version);
    expect(await readFile(join(folder, "guide/tabs.md"), "utf8")).toContain("rewritten by the edit middleware");
  }, 30_000);

  it("rejects a stale If-Match with a 409 carrying theirs", async () => {
    const res = await fetch(`${api}/files/guide/tabs.md`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8", "If-Match": `"deadbeef"` },
      body: "clobber\n",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { theirs: string; version: string };
    expect(body.theirs).toContain("rewritten by the edit middleware");
    expect(body.version).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(folder, "guide/tabs.md"), "utf8")).not.toContain("clobber");
  }, 30_000);

  it("creates a file when it is absent and no If-Match is sent", async () => {
    const res = await fetch(`${api}/files/guide/new page.md`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "# New\n",
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { version: string }).version).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(folder, "guide/new page.md"), "utf8")).toBe("# New\n");
  }, 30_000);

  it("uploads multipart form data under media/ and returns path, url and version", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }), "My Logo!.png");
    const res = await fetch(`${api}/upload`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; url: string; version: string };
    expect(body.path).toBe("media/My-Logo-.png");
    expect(body.url).toBe("/media/My-Logo-.png");
    expect(body.version).toMatch(/^[0-9a-f]{40}$/);
    expect(new Uint8Array(await readFile(join(folder, body.path)))).toEqual(new Uint8Array([1, 2, 3, 4]));
  }, 30_000);

  it("uploads to an explicit path when one is given", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([9])]), "x.bin");
    form.append("path", "assets/nested/thing.bin");
    const res = await fetch(`${api}/upload`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect((await res.json() as { path: string }).path).toBe("assets/nested/thing.bin");
    expect(existsSync(join(folder, "assets/nested/thing.bin"))).toBe(true);
  }, 30_000);

  it("renames a file", async () => {
    const res = await fetch(`${api}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "guide/new page.md", to: "guide/renamed.md" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { version: string }).version).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(folder, "guide/new page.md"))).toBe(false);
    expect(await readFile(join(folder, "guide/renamed.md"), "utf8")).toBe("# New\n");
  }, 30_000);

  it("deletes a file", async () => {
    const res = await fetch(`${api}/files/guide/renamed.md`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(existsSync(join(folder, "guide/renamed.md"))).toBe(false);
    expect((await fetch(`${api}/files/guide/renamed.md`)).status).toBe(404);
  }, 30_000);

  it("refuses traversal, absolute paths and writes into .pagina/", async () => {
    // `..%2F` survives URL normalisation as one segment, so the server (not `fetch`) rejects it.
    expect((await fetch(`${api}/files/..%2Fescaped.md`)).status).toBeGreaterThanOrEqual(400);
    const write = await fetch(`${api}/files/..%2Fescaped.md`, { method: "PUT", body: "nope" });
    expect(write.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(folder, "../escaped.md"))).toBe(false);

    const rename = await fetch(`${api}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "index.md", to: "../escaped.md" }),
    });
    expect(rename.status).toBeGreaterThanOrEqual(400);

    const dotPagina = await fetch(`${api}/files/.pagina/published.json`, { method: "PUT", body: "{}" });
    expect(dotPagina.status).toBeGreaterThanOrEqual(400);
  }, 30_000);

  it("refuses a symlink that leaves the folder, for reads and for writes", async () => {
    // Positive control: the symlinks really do resolve, so the refusals below are a decision the
    // middleware makes and not an accident of a dangling link.
    expect(await readFile(join(folder, "escape.txt"), "utf8")).toBe("top secret\n");
    expect(await readFile(join(folder, "escape-dir/secret.txt"), "utf8")).toBe("top secret\n");

    // Lexically `escape.txt` is a perfectly ordinary child of the folder; only its realpath is not.
    for (const path of ["escape.txt", "escape-dir/secret.txt"]) {
      const read = await fetch(`${api}/files/${path}?responseType=text`);
      expect([403, 404]).toContain(read.status);
      expect(await read.text()).not.toContain("top secret");

      const write = await fetch(`${api}/files/${path}`, { method: "PUT", body: "owned\n" });
      expect([403, 404]).toContain(write.status);

      const remove = await fetch(`${api}/files/${path}`, { method: "DELETE" });
      expect([403, 404]).toContain(remove.status);
    }
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("top secret\n");

    // A symlinked directory is not a back door for creating files outside, either.
    const created = await fetch(`${api}/files/escape-dir/planted.md`, { method: "PUT", body: "planted\n" });
    expect([403, 404]).toContain(created.status);
    expect(existsSync(join(outside, "planted.md"))).toBe(false);

    const upload = new FormData();
    upload.append("file", new Blob([new Uint8Array([7])]), "u.bin");
    upload.append("path", "escape-dir/u.bin");
    expect([403, 404]).toContain((await fetch(`${api}/upload`, { method: "POST", body: upload })).status);
    expect(existsSync(join(outside, "u.bin"))).toBe(false);

    for (const body of [{ from: "escape.txt", to: "moved.md" }, { from: "index.md", to: "escape-dir/index.md" }]) {
      const res = await fetch(`${api}/rename`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      expect([403, 404]).toContain(res.status);
    }
    expect(existsSync(join(outside, "index.md"))).toBe(false);
    expect(await readdir(outside)).toEqual(["secret.txt"]);
  }, 30_000);

  it("omits symlinks from the listing", async () => {
    const { files } = (await (await fetch(`${api}/files`)).json()) as { files: { path: string }[] };
    expect(files.some((f) => f.path === "escape.txt" || f.path.startsWith("escape-dir/"))).toBe(false);
  }, 30_000);

  it("refuses to write, rename, upload to or delete any dotfile", async () => {
    expect((await fetch(`${api}/files/.git/config`, { method: "PUT", body: "[core]\n" })).status).toBe(403);
    expect(existsSync(join(folder, ".git/config"))).toBe(false);

    const rename = await fetch(`${api}/rename`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "index.md", to: ".env" }),
    });
    expect(rename.status).toBe(403);
    expect(existsSync(join(folder, ".env"))).toBe(false);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1])]), "x.bin");
    form.append("path", ".hidden/x.bin");
    expect((await fetch(`${api}/upload`, { method: "POST", body: form })).status).toBe(403);
    expect(existsSync(join(folder, ".hidden"))).toBe(false);

    // `.pagina/` is refused before existence is even considered, so publish's output is safe
    // whether or not it has run yet.
    expect((await fetch(`${api}/files/.pagina/published.json`, { method: "DELETE" })).status).toBe(403);

    // Reads answer 404: a dotfile never appears in the listing, so it is not addressable either.
    expect((await fetch(`${api}/files/.pagina/published.json`)).status).toBe(404);
  }, 30_000);

  it("treats `If-Match: *` as must-exist", async () => {
    const ok = await fetch(`${api}/files/index.md`, {
      method: "PUT", headers: { "If-Match": "*" }, body: "# Fixture\n\nstill here\n",
    });
    expect(ok.status).toBe(200);

    const missing = await fetch(`${api}/files/never/created.md`, {
      method: "PUT", headers: { "If-Match": "*" }, body: "# Nope\n",
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ theirs: "", version: "" });
    expect(existsSync(join(folder, "never/created.md"))).toBe(false);
  }, 30_000);

  it("caps request bodies with a 413 instead of buffering them", async () => {
    const huge = "x".repeat(6 * 1024 * 1024);
    const res = await fetch(`${api}/files/big.md`, { method: "PUT", body: huge });
    expect(res.status).toBe(413);
    expect((await res.json() as { message: string }).message).toContain("limit");
    expect(existsSync(join(folder, "big.md"))).toBe(false);

    const json = await fetch(`${api}/rename`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "index.md", to: "x.md", pad: huge }),
    });
    expect(json.status).toBe(413);
  }, 60_000);

  it("writes atomically, leaving no temp files behind", async () => {
    await fetch(`${api}/files/atomic.md`, { method: "PUT", body: "# Atomic\n" });
    const { files } = (await (await fetch(`${api}/files`)).json()) as { files: { path: string }[] };
    expect(files.some((f) => f.path.endsWith(".tmp"))).toBe(false);
    expect(await readFile(join(folder, "atomic.md"), "utf8")).toBe("# Atomic\n");

    // A refused write must not leave debris either.
    await fetch(`${api}/files/escape-dir/nope.md`, { method: "PUT", body: "x" });
    expect((await readdir(join(folder))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  }, 30_000);

  it("publishes rendered output into .pagina/", async () => {
    const res = await fetch(`${api}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: { article: { slug: "fixture", title: "Fixture" }, nav: [], pages: {}, figures: {}, assets: [] },
        pages: { "/": "<h1>Home</h1>", "/guide/tabs/": "<h1>Tabs</h1>" },
        figures: { "inline-demo": { light: "<svg>light</svg>", dark: "<svg>dark</svg>" } },
      }),
    });
    expect(res.status).toBe(200);
    const { publishedAt } = (await res.json()) as { publishedAt: string };
    expect(Number.isNaN(Date.parse(publishedAt))).toBe(false);

    expect(JSON.parse(await readFile(join(folder, ".pagina/rendered/manifest.json"), "utf8"))).toMatchObject({
      article: { slug: "fixture" },
    });
    expect(await readFile(join(folder, ".pagina/rendered/pages/index.html"), "utf8")).toBe("<h1>Home</h1>");
    expect(await readFile(join(folder, ".pagina/rendered/pages/guide-tabs.html"), "utf8")).toBe("<h1>Tabs</h1>");
    expect(await readFile(join(folder, ".pagina/rendered/figures/inline-demo.light.svg"), "utf8")).toBe("<svg>light</svg>");
    expect(JSON.parse(await readFile(join(folder, ".pagina/published.json"), "utf8"))).toEqual({ publishedAt });
  }, 30_000);

  it("keeps .pagina/ out of the listing", async () => {
    const { files } = (await (await fetch(`${api}/files`)).json()) as { files: { path: string }[] };
    expect(files.some((f) => f.path.startsWith(".pagina/"))).toBe(false);
  }, 30_000);

  it("streams file events over SSE", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${api}/events`, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    // The watcher only reports a change once it is watching; give it a beat, then write.
    await new Promise((r) => setTimeout(r, 300));
    await fetch(`${api}/files/index.md`, { method: "PUT", body: `# Fixture\n\ntouched at ${Date.now()}\n` });

    let buffer = "";
    let frame: { type: string; path: string; version?: string } | undefined;
    while (frame === undefined) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value ?? "";
      for (const line of buffer.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const parsed = JSON.parse(line.slice(6)) as { type: string; path: string; version?: string };
        if (parsed.path === "index.md") { frame = parsed; break; }
      }
    }
    expect(frame).toMatchObject({ type: "changed", path: "index.md" });
    expect(frame!.version).toMatch(/^[0-9a-f]{40}$/);
    ctrl.abort();
  }, 30_000);

  it("serves the editor page with the custom element wired to the backend", async () => {
    const res = await fetch(`${origin}/__edit/`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<pagina-editor");
    expect(html).toContain(`backend-url="/__pagina/edit"`);
    expect(html).toContain(`page="index.md"`);
    expect(html).toContain(`base="/"`);
    expect(html).toContain("importmap");
    // The editor is loaded from source through Vite, so it hot-reloads while B4a is built.
    expect(html).toContain("/@fs");
    expect(html).toContain("/packages/editor/src/index.ts");
    // `transformIndexHtml` moves the inline `defineElement()` module into an html-proxy module;
    // `renderEditPage` is asserted on its own below for the literal call it emits.
    expect(html).toContain("/@vite/client");

    // …and `server.fs.allow` really covers it, so the `/@fs` URL is not a 403.
    const entry = /<script type="module" src="(\/@fs[^"]+src\/index\.ts)"><\/script>/.exec(html)?.[1];
    expect(entry).toBeDefined();
    const module = await fetch(`${origin}${entry!}`);
    expect(module.status).toBe(200);
    expect(await module.text()).toContain("defineElement");
  }, 60_000);

  it("maps an /__edit/<href> to the page's markdown path", async () => {
    const html = await (await fetch(`${origin}/__edit/guide/tabs/`, { headers: { accept: "text/html" } })).text();
    expect(html).toContain(`page="guide/tabs.md"`);
  }, 60_000);

  it("interoperates with the editor's own HttpBackend", async () => {
    const backend = new HttpBackend({ baseUrl: api });
    const created = await backend.write("guide/from-client.md", "# From the client\n");
    expect(created.version).toMatch(/^[0-9a-f]{40}$/);

    const round = await backend.read("guide/from-client.md");
    expect(round.text).toBe("# From the client\n");
    expect(round.version).toBe(created.version);

    const second = await backend.write("guide/from-client.md", "# Second\n", { version: round.version });
    expect(await readFile(join(folder, "guide/from-client.md"), "utf8")).toBe("# Second\n");

    await expect(backend.write("guide/from-client.md", "# Stale\n", { version: round.version })).rejects.toMatchObject({
      name: "ConflictError",
      theirs: "# Second\n",
      version: second.version,
    });

    expect((await backend.list()).some((f) => f.path === "guide/from-client.md")).toBe(true);
    expect(await backend.stat("guide/from-client.md")).toMatchObject({ path: "guide/from-client.md" });

    await backend.delete("guide/from-client.md");
    expect(existsSync(join(folder, "guide/from-client.md"))).toBe(false);
  }, 30_000);
});
