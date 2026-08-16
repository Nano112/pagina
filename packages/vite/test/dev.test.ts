import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { createDevServer } from "../src/index.js";
import { stubShell } from "./stub-shell.js";

const fixture = new URL("../../core/test/fixture/", import.meta.url).pathname;

describe("createDevServer", () => {
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    server = await createDevServer({ folder: fixture, shell: stubShell, port: 0, host: "127.0.0.1" });
    await server.listen();
    // `port: 0` means the OS picked one — ask the listening socket, not the requested options.
    const addr = server.httpServer!.address() as AddressInfo;
    origin = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  const page = (path: string): Promise<Response> => fetch(`${origin}${path}`, { headers: { accept: "text/html" } });

  it("serves the index page with the import map", async () => {
    const res = await page("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("importmap");
  }, 60_000);

  it("serves a nested page, and its /index.html alias", async () => {
    const pretty = await page("/guide/figures/");
    expect(pretty.status).toBe(200);
    const alias = await page("/guide/figures/index.html");
    expect(alias.status).toBe(200);
    expect(await alias.text()).toContain("importmap");
  }, 60_000);

  it("pre-renders a figure on demand and 404s an unknown one", async () => {
    const res = await fetch(`${origin}/_pagina/figures/guide-figures/inline-demo.light.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("Inline");

    const missing = await fetch(`${origin}/_pagina/figures/guide-figures/nope.light.svg`);
    expect(missing.status).toBe(404);
  }, 60_000);
});
