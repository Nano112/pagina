/**
 * The Worker, run against the same contract suite every other `ArticleBackend` runs against.
 *
 * `@pagina/editor`'s `HttpBackend` is the client, the Worker's own `fetch` handler is the server,
 * and the two talk over real `Request`/`Response` objects — headers, ETags, status codes, multipart
 * uploads and an event stream included. What is faked is the storage underneath (`FakeR2Bucket`),
 * because vitest is not workerd; `npm run smoke` in this folder closes that gap by driving the same
 * handler under `wrangler dev` against miniflare's R2.
 *
 * Reusing `describeBackendContract` is the point. A Worker that passed a suite written for a Worker
 * would prove that it does what its author expected; passing the suite the memory, localStorage and
 * HTTP backends already pass proves it does what the *editor* expects.
 */
import { describe, expect, it } from "vitest";
import { describeBackendContract, OTHER } from "../../../packages/editor/test/backend-contract.js";
import { HttpBackend } from "../../../packages/editor/src/store/http-backend.js";
import type { Author } from "../../../packages/editor/src/store/types.js";
import worker, { ArticleEvents } from "../src/worker.js";
import type { DurableObjectNamespaceLike, Env } from "../src/bindings.js";
import { FakeR2Bucket } from "./fake-r2.js";

const ALICE: Author = { id: "editor:alice", name: "Alice", email: "alice@example.com" };
const TOKENS = { alice: "alice-dev-token", bob: "bob-dev-token" };
const SLUG = "demo";
const BASE = `https://worker.test/api/articles/${SLUG}`;

/** One `ArticleEvents` per name, which is what a Durable Object namespace is for our purposes. */
function fakeEvents(): DurableObjectNamespaceLike {
  const instances = new Map<string, ArticleEvents>();
  return {
    idFromName: (name) => name,
    get: (id) => {
      const key = String(id);
      let instance = instances.get(key);
      if (instance === undefined) { instance = new ArticleEvents(); instances.set(key, instance); }
      const held = instance;
      return { fetch: async (input, init) => await held.fetch(new Request(input, init)) };
    },
  };
}

/**
 * Lets pending stream work run.
 *
 * SSE delivery crosses a `TransformStream`, so a frame written during an awaited request is not yet
 * in the subscriber's reader when that request resolves. Real macrotasks are the only thing that
 * bridges it; the alternative — asserting immediately — is a test that passes on a fast machine.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

interface World {
  env: Env;
  fetch: typeof globalThis.fetch;
  restoreEventSource(): void;
}

function world(seed: Record<string, string>): World {
  const bucket = new FakeR2Bucket();
  for (const [path, text] of Object.entries(seed)) bucket.seed(`${SLUG}/files/${path}`, text);

  const env: Env = {
    ARTICLES: bucket,
    EVENTS: fakeEvents(),
    EDITORS: JSON.stringify({ [TOKENS.alice]: ALICE, [TOKENS.bob]: OTHER }),
    SITE_BASE: "",
  };

  const dispatch = (async (input: string | URL | Request, init: RequestInit = {}) =>
    await worker.fetch(new Request(input as string, init), env)) as unknown as typeof globalThis.fetch;

  // A stand-in for `EventSource`, which cannot carry an `Authorization` header in a browser either
  // — so it authenticates with a cookie, exactly as the real one would.
  const previous = (globalThis as { EventSource?: unknown }).EventSource;
  class WorkerEventSource {
    onmessage: ((e: { data: string }) => void) | null = null;
    #closed = false;
    constructor(readonly url: string) { void this.#run(); }
    async #run(): Promise<void> {
      const response = await worker.fetch(
        new Request(this.url, { headers: { Cookie: `pagina_token=${TOKENS.alice}` } }), env,
      );
      const body = response.body;
      if (body === null) return;
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!this.#closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          for (const line of buffer.slice(0, split).split("\n")) {
            if (line.startsWith("data: ") && !this.#closed) this.onmessage?.({ data: line.slice(6) });
          }
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");
        }
      }
      await reader.cancel().catch(() => undefined);
    }
    close(): void { this.#closed = true; }
  }
  (globalThis as { EventSource?: unknown }).EventSource = WorkerEventSource;

  return {
    env, fetch: dispatch,
    restoreEventSource: () => { (globalThis as { EventSource?: unknown }).EventSource = previous; },
  };
}

describe("Worker over R2 / the contract", () => {
  describeBackendContract((seed) => {
    const w = world(seed);
    const backend = new HttpBackend({
      baseUrl: BASE, fetch: w.fetch, history: true,
      headers: { Authorization: `Bearer ${TOKENS.alice}` },
    });
    // The second person, holding the second token. `external` is "somebody else did this", and
    // against this backend somebody else is a different credential rather than a different flag.
    const bob = new HttpBackend({
      baseUrl: BASE, fetch: w.fetch, headers: { Authorization: `Bearer ${TOKENS.bob}` },
    });
    return {
      backend,
      expectedAuthor: ALICE,
      external: async (ev) => {
        // Before, so a subscription opened a moment ago is attached when the frame goes out;
        // after, so the frame has crossed the stream before the assertion reads it.
        await settle();
        if (ev.type === "deleted") await bob.delete(ev.path);
        else await bob.write(ev.path, ev.text ?? "");
        await settle();
      },
      cleanup: () => { w.restoreEventSource(); },
    };
  });
});

// --- what only this backend has -----------------------------------------------------------------

const seeded = (): World => world({ "index.md": "# Demo\n", "article.yaml": "slug: demo\n" });

const asAlice = (w: World, path: string, init: RequestInit = {}): Promise<Response> =>
  worker.fetch(new Request(`${BASE}${path}`, {
    ...init, headers: { Authorization: `Bearer ${TOKENS.alice}`, ...(init.headers ?? {}) },
  }), w.env);

describe("Worker over R2", () => {
  it("refuses every editor endpoint without a token", async () => {
    const w = seeded();
    for (const [path, init] of [
      ["/files", {}],
      ["/files/index.md", {}],
      ["/files/index.md", { method: "PUT", body: "x" }],
      ["/publish", { method: "POST", body: "{}" }],
      ["/history", {}],
      ["/events", {}],
    ] as [string, RequestInit][]) {
      const response = await worker.fetch(new Request(`${BASE}${path}`, init), w.env);
      expect(response.status, `${init.method ?? "GET"} ${path}`).toBe(401);
    }
    w.restoreEventSource();
  });

  /**
   * The security property, at the wire rather than at the interface.
   *
   * `HttpBackend` has no field for an author, so the contract suite's forgery test only proves the
   * client does not send one. This proves the server would not believe it — which is the half that
   * matters, because the attacker writes the client.
   */
  it("ignores an author named in the body, the query string or a header", async () => {
    const w = seeded();
    const mallory = encodeURIComponent(JSON.stringify({ id: "mallory", name: "Mallory" }));
    const response = await asAlice(w, `/files/index.md?author=${mallory}&by=mallory`, {
      method: "PUT",
      body: "# Forged\n",
      headers: { "X-Author": "Mallory", "X-Pagina-Author": mallory },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ lastEditedBy: ALICE });

    const listed = await (await asAlice(w, "/files")).json() as { files: { path: string; lastEditedBy?: Author }[] };
    expect(listed.files.find((f) => f.path === "index.md")?.lastEditedBy).toEqual(ALICE);
    expect(JSON.stringify(listed)).not.toMatch(/mallory/i);
    w.restoreEventSource();
  });

  it("answers 412 for If-Match: * on a file that is not there, and 200 when it is", async () => {
    const w = seeded();
    const missing = await asAlice(w, "/files/nope.md", { method: "PUT", body: "x", headers: { "If-Match": "*" } });
    expect(missing.status).toBe(412);
    expect(await missing.json()).toMatchObject({ message: expect.stringContaining("does not exist") as unknown as string });

    const present = await asAlice(w, "/files/index.md", { method: "PUT", body: "x", headers: { "If-Match": "*" } });
    expect(present.status).toBe(200);
    w.restoreEventSource();
  });

  it("refuses to write a dotfile, so publish output cannot be forged through the file endpoint", async () => {
    const w = seeded();
    const response = await asAlice(w, "/files/.pagina/rendered/manifest.json", { method: "PUT", body: "{}" });
    expect(response.status).toBe(403);
    w.restoreEventSource();
  });

  it("refuses a path that tries to climb out of the article", async () => {
    const w = seeded();
    for (const path of ["/files/..%2F..%2Fother%2Ffiles%2Findex.md", "/files/a/../../b.md"]) {
      const response = await asAlice(w, path, { method: "PUT", body: "x" });
      expect([400, 404], path).toContain(response.status);
    }
    // Nothing outside `demo/files/` was created.
    const bucket = w.env.ARTICLES as FakeR2Bucket;
    expect([...bucket.objects.keys()].filter((k) => !k.startsWith(`${SLUG}/`))).toEqual([]);
    w.restoreEventSource();
  });

  it("stores what the browser rendered and serves it back without a token", async () => {
    const w = seeded();
    const published = await asAlice(w, "/publish", {
      method: "POST",
      body: JSON.stringify({
        manifest: { article: { slug: SLUG, title: "Demo" } },
        pages: { "/": "<h1>Demo</h1>", "/guide/tabs/": "<h2>Tabs</h2>" },
        figures: { "kg-1": { light: "<svg id='light'/>", dark: "<svg id='dark'/>" } },
      }),
    });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ publishedBy: ALICE });

    // Public: the reader of a blog has no token, and this is the half they read.
    const page = await worker.fetch(new Request(`https://worker.test/rendered/${SLUG}/pages/guide-tabs.html`), w.env);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<h2>Tabs</h2>");

    const figure = await worker.fetch(new Request(`https://worker.test/rendered/${SLUG}/figures/kg-1.dark.svg`), w.env);
    expect(figure.headers.get("content-type")).toBe("image/svg+xml");
    expect(await figure.text()).toBe("<svg id='dark'/>");
    w.restoreEventSource();
  });

  /**
   * The reason `If-Match` is a compare-and-swap rather than a read followed by a write.
   *
   * Both requests are built from the same version and dispatched together, so they interleave the
   * way two editors saving at once do. Exactly one may store; a read-then-write server would let
   * both through and lose whichever landed first.
   */
  it("lets exactly one of two simultaneous writers win", async () => {
    const w = seeded();
    const version = (await asAlice(w, "/files/index.md")).headers.get("ETag") ?? "";
    const [first, second] = await Promise.all([
      asAlice(w, "/files/index.md", { method: "PUT", body: "# Mine\n", headers: { "If-Match": version } }),
      asAlice(w, "/files/index.md", { method: "PUT", body: "# Theirs\n", headers: { "If-Match": version } }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    w.restoreEventSource();
  });

  it("says plainly when no editors are configured rather than writing anonymously", async () => {
    const w = seeded();
    const response = await worker.fetch(new Request(`${BASE}/files`), { ...w.env, EDITORS: "" });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("EDITORS") as unknown as string });
    w.restoreEventSource();
  });
});
