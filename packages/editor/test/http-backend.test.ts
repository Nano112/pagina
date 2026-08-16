import { describe, expect, it, vi } from "vitest";
import { HttpBackend } from "../src/store/http-backend.js";
import { BackendError, ConflictError } from "../src/store/types.js";

interface Call { url: string; init: RequestInit }

function stub(responses: Response[] | ((call: Call) => Response)): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return typeof responses === "function" ? responses(call) : responses[i++] ?? new Response(null, { status: 500 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

const BASE = "https://app.test/api/articles/demo";

describe("HttpBackend", () => {
  it("lists files", async () => {
    const files = [{ path: "index.md", version: "v1", size: 3, mtime: "2026-08-17T00:00:00Z" }];
    const { fetch, calls } = stub([json({ files })]);
    const b = new HttpBackend({ baseUrl: `${BASE}/`, fetch, headers: { "X-CSRF-TOKEN": "abc" } });

    expect(await b.list()).toEqual(files);
    expect(calls[0]!.url).toBe(`${BASE}/files`);
    expect(calls[0]!.init.method).toBe("GET");
    expect(new Headers(calls[0]!.init.headers).get("x-csrf-token")).toBe("abc");
  });

  it("reads text, taking the version from the ETag and encoding each path segment", async () => {
    const { fetch, calls } = stub([new Response("# Hi\n", { headers: { ETag: '"v7"' } })]);
    const b = new HttpBackend({ baseUrl: BASE, fetch });

    expect(await b.read("guide/a b.md")).toEqual({ text: "# Hi\n", version: "v7" });
    expect(calls[0]!.url).toBe(`${BASE}/files/guide/a%20b.md?responseType=text`);
    expect(new Headers(calls[0]!.init.headers).get("accept")).toContain("text/plain");
  });

  it("reads binary", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { fetch, calls } = stub([new Response(bytes, { headers: { ETag: "W/\"v2\"" } })]);
    const b = new HttpBackend({ baseUrl: BASE, fetch });

    expect(await b.readBinary("media/x.png")).toEqual({ bytes, version: "v2" });
    expect(calls[0]!.url).toBe(`${BASE}/files/media/x.png?responseType=binary`);
    expect(new Headers(calls[0]!.init.headers).get("accept")).toContain("application/octet-stream");
  });

  it("writes with If-Match and the dialect's content type", async () => {
    const { fetch, calls } = stub([json({ version: "v2" })]);
    const b = new HttpBackend({ baseUrl: BASE, fetch });

    expect(await b.write("index.md", "body", { version: "v1" })).toEqual({ version: "v2" });
    const h = new Headers(calls[0]!.init.headers);
    expect(calls[0]!.url).toBe(`${BASE}/files/index.md`);
    expect(calls[0]!.init.method).toBe("PUT");
    expect(h.get("if-match")).toBe('"v1"');
    expect(h.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(calls[0]!.init.body).toBe("body");
  });

  it("omits If-Match when no version is known", async () => {
    const { fetch, calls } = stub([json({ version: "v1" })]);
    await new HttpBackend({ baseUrl: BASE, fetch }).write("new.md", "x");
    expect(new Headers(calls[0]!.init.headers).has("if-match")).toBe(false);
  });

  it("maps a 409 to a ConflictError carrying theirs", async () => {
    const { fetch } = stub([json({ theirs: "# Theirs\n", version: "v9" }, { status: 409 })]);
    const b = new HttpBackend({ baseUrl: BASE, fetch });

    const err = await b.write("index.md", "mine", { version: "v1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ path: "index.md", theirs: "# Theirs\n", version: "v9", status: 409 });
  });

  it("uploads multipart with file and optional path", async () => {
    const { fetch, calls } = stub([json({ path: "media/a.png", url: "/media/a.png", version: "v1" })]);
    const b = new HttpBackend({ baseUrl: BASE, fetch });

    const out = await b.upload(new File([new Uint8Array([1])], "a.png"), "media/a.png");
    expect(out).toEqual({ path: "media/a.png", url: "/media/a.png", version: "v1" });
    expect(calls[0]!.url).toBe(`${BASE}/upload`);
    expect(calls[0]!.init.method).toBe("POST");
    const form = calls[0]!.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("file") as File).name).toBe("a.png");
    expect(form.get("path")).toBe("media/a.png");
    // the browser must set the multipart boundary itself
    expect(new Headers(calls[0]!.init.headers).has("content-type")).toBe(false);
  });

  it("deletes, renames, stats and publishes", async () => {
    const { fetch, calls } = stub([
      new Response(null, { status: 204 }),
      json({ version: "v3" }),
      json({ files: [{ path: "index.md", version: "v1" }] }),
      json({ publishedAt: "2026-08-17T12:00:00Z" }),
    ]);
    const b = new HttpBackend({ baseUrl: BASE, fetch });

    await b.delete("media/x.png");
    expect(calls[0]!.url).toBe(`${BASE}/files/media/x.png`);
    expect(calls[0]!.init.method).toBe("DELETE");

    expect(await b.rename("a.md", "b.md")).toEqual({ version: "v3" });
    expect(calls[1]!.url).toBe(`${BASE}/rename`);
    expect(calls[1]!.init.body).toBe(JSON.stringify({ from: "a.md", to: "b.md" }));
    expect(new Headers(calls[1]!.init.headers).get("content-type")).toBe("application/json");

    expect(await b.stat("index.md")).toEqual({ path: "index.md", version: "v1" });

    const payload = { manifest: {}, pages: { "/": "<h1></h1>" }, figures: {} } as never;
    expect(await b.publish(payload)).toEqual({ publishedAt: "2026-08-17T12:00:00Z" });
    expect(calls[3]!.url).toBe(`${BASE}/publish`);
    expect(calls[3]!.init.body).toBe(JSON.stringify(payload));
  });

  it("returns null from stat for an unknown path", async () => {
    const { fetch } = stub([json({ files: [] })]);
    expect(await new HttpBackend({ baseUrl: BASE, fetch }).stat("gone.md")).toBeNull();
  });

  it("maps non-2xx to BackendError with the server message and status", async () => {
    const { fetch } = stub([json({ message: "Forbidden by policy" }, { status: 403 })]);
    const err = await new HttpBackend({ baseUrl: BASE, fetch }).read("secret.md").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ status: 403, message: "Forbidden by policy" });
  });

  it("falls back to the status text when the body is not JSON", async () => {
    const { fetch } = stub([new Response("nope", { status: 500, statusText: "Server Error" })]);
    const err = await new HttpBackend({ baseUrl: BASE, fetch }).list().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500 });
    expect((err as BackendError).message).toContain("500");
  });

  it("subscribes over SSE when EventSource exists and no-ops otherwise", async () => {
    const b = new HttpBackend({ baseUrl: BASE, fetch: stub([]).fetch });
    expect(typeof b.subscribe(() => {})).toBe("function");   // no EventSource in node → no-op

    const close = vi.fn();
    const instances: { url: string; onmessage?: (e: { data: string }) => void }[] = [];
    class FakeEventSource {
      onmessage?: (e: { data: string }) => void;
      close = close;
      constructor(readonly url: string) { instances.push(this); }
    }
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
    try {
      const seen: unknown[] = [];
      const off = b.subscribe((ev) => seen.push(ev));
      expect(instances[0]!.url).toBe(`${BASE}/events`);
      instances[0]!.onmessage?.({ data: JSON.stringify({ type: "changed", path: "index.md", version: "v2" }) });
      expect(seen).toEqual([{ type: "changed", path: "index.md", version: "v2" }]);
      off();
      expect(close).toHaveBeenCalled();
    } finally {
      delete (globalThis as { EventSource?: unknown }).EventSource;
    }
  });
});
