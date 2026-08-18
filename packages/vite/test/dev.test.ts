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

  /**
   * A browser sends `Accept: text/html`; `curl`, a health check, a link checker and every CI
   * script do not. Gating the page lane on that header therefore looked correct by hand and
   * returned 404 to everything automated — which reads as "the dev server is down".
   */
  it("serves a page to a request that sends no Accept header", async () => {
    for (const path of ["/", "/guide/figures/"]) {
      const res = await fetch(`${origin}${path}`);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain("importmap");
    }
    const head = await fetch(`${origin}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
  }, 60_000);

  /** The author's own 404 page, which until now only a deployed build ever showed anyone. */
  it("serves the article's 404 page for an unknown path, with or without Accept", async () => {
    for (const headers of [{ accept: "text/html" }, {}]) {
      const res = await fetch(`${origin}/guide/that/never/existed/`, { headers });
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("data-pagina-404");
    }
  }, 60_000);

  /** A missing subresource is not a document: handing an `<img>` a page of HTML helps nobody. */
  it("leaves a missing subresource as a bare 404", async () => {
    const res = await fetch(`${origin}/nothing-here.png`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("data-pagina-404");
  }, 60_000);
});
