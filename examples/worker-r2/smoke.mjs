/**
 * Drives the Worker under `wrangler dev` — miniflare, real R2 on disk, real HTTP — with the editor's
 * own `HttpBackend` as the client.
 *
 * The unit suite runs the same Worker against a `Map` pretending to be R2. This is the other half:
 * the storage is the real binding, the transport is a real socket, and the client is the class the
 * browser loads. What it checks is the round trip a person makes — write, collide, publish, read
 * back — rather than the shape of a response.
 *
 * Run it with `npm run smoke` in this folder. It starts and stops `wrangler dev` itself.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { HttpBackend, ConflictError } from "@pagina/editor/store";

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SLUG = `smoke-${Date.now().toString(36)}`;
const BASE = `${ORIGIN}/api/articles/${SLUG}`;
const ALICE = "alice-dev-token";
const BOB = "bob-dev-token";

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${ok || detail === undefined ? "" : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

const backendFor = (token) => new HttpBackend({
  baseUrl: BASE, history: true, headers: { Authorization: `Bearer ${token}` },
});

/** Reads SSE frames with `fetch`, because `EventSource` cannot be given a header from Node. */
async function subscribe(token, onFrame) {
  const controller = new AbortController();
  const response = await fetch(`${BASE}/events`, {
    headers: { Cookie: `pagina_token=${token}` }, signal: controller.signal,
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          for (const line of buffer.slice(0, split).split("\n")) {
            if (line.startsWith("data: ")) onFrame(JSON.parse(line.slice(6)));
          }
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");
        }
      }
    } catch { /* aborted */ }
  })();
  return () => { controller.abort(); };
}

async function waitForServer(deadlineMs = 60_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${BASE}/files`);
      if (response.status === 401) return;            // up, and asking for a token
      if (response.status === 200) return;
    } catch { /* not listening yet */ }
    await sleep(400);
  }
  throw new Error(`wrangler dev did not answer on ${ORIGIN} within ${String(deadlineMs)}ms`);
}

async function drive() {
  const alice = backendFor(ALICE);
  const bob = backendFor(BOB);

  check("an unauthenticated request is refused", (await fetch(`${BASE}/files`)).status === 401);
  check("a bad token is refused", (await fetch(`${BASE}/files`, {
    headers: { Authorization: "Bearer not-a-token" },
  })).status === 401);

  // --- write, and read the same bytes back ---
  //
  // CRLF, a trailing space, a tab, an emoji and a combining mark: everything a transport is tempted
  // to normalise. The comparison below is on the string, so any of it would show up.
  const page = "# Smoke \t\r\nA line with a trailing space \nCafé — 🌍\n";
  const written = await alice.write("index.md", page);
  const read = await alice.read("index.md");
  check("write then read is byte-exact", read.text === page,
    `wrote ${JSON.stringify(page)}\n        read  ${JSON.stringify(read.text)}`);
  check("the read's ETag is the version the write reported", read.version === written.version);
  check("the write is attributed to the token's owner", written.lastEditedBy?.name === "Alice",
    JSON.stringify(written.lastEditedBy));

  // --- the conflict a second person causes ---
  const stale = read.version;
  const frames = [];
  const unsubscribe = await subscribe(ALICE, (frame) => frames.push(frame));
  await sleep(200);

  await bob.write("index.md", "# Bob was here\n");
  const conflict = await alice.write("index.md", "# Mine\n", { version: stale }).then(
    () => undefined, (error) => error,
  );
  check("a stale write is a ConflictError", conflict instanceof ConflictError, String(conflict));
  check("the conflict carries the other side's text", conflict?.theirs === "# Bob was here\n",
    JSON.stringify(conflict?.theirs));
  check("the conflict names the person, not just the file", conflict?.by?.name === "Bob",
    JSON.stringify(conflict?.by));
  check("the refused write did not land", (await alice.read("index.md")).text === "# Bob was here\n");

  await sleep(400);
  unsubscribe();
  const bobsFrame = frames.find((f) => f.path === "index.md" && f.by?.name === "Bob");
  check("the other tab was told, and told who", bobsFrame !== undefined, JSON.stringify(frames));

  // --- a binary upload, byte for byte ---
  const bytes = new Uint8Array(256).map((_, i) => i);
  const upload = await alice.upload(new File([bytes], "all-bytes.png", { type: "image/png" }));
  const back = await alice.readBinary(upload.path);
  check("an upload lands at media/ and comes back identical",
    upload.path === "media/all-bytes.png" && Buffer.compare(Buffer.from(back.bytes), Buffer.from(bytes)) === 0);

  // --- rename ---
  await alice.write("guide/tabs.md", "# Tabs\n");
  await alice.rename("guide/tabs.md", "guide/panels.md");
  const paths = (await alice.list()).map((f) => f.path);
  check("a rename moves the listing entry",
    paths.includes("guide/panels.md") && !paths.includes("guide/tabs.md"), paths.join(", "));

  // --- history ---
  const history = await alice.history();
  const times = history.map((e) => Date.parse(e.at));
  check("history is newest first", [...times].sort((a, b) => b - a).join() === times.join());
  check("history names both people",
    new Set(history.map((e) => e.by.name)).size === 2, [...new Set(history.map((e) => e.by.name))].join(", "));
  check("a rename is logged against the new path, naming the old one",
    (await alice.history("guide/panels.md"))[0]?.from === "guide/tabs.md");

  // --- publish, and read the published bytes as a reader with no token ---
  const html = "<h1>Smoke</h1><p>Rendered in the client, stored as bytes.</p>";
  const published = await alice.publish({
    manifest: { article: { slug: SLUG, title: "Smoke" }, pages: [], assets: [], nav: [] },
    pages: { "/": html, "/guide/panels/": "<h2>Panels</h2>" },
    figures: { "kg-1": { light: "<svg id='light'/>", dark: "<svg id='dark'/>" } },
  });
  check("publish records who published", published.publishedBy?.name === "Alice");

  const readerView = await fetch(`${ORIGIN}/rendered/${SLUG}/pages/index.html`);
  check("a reader with no token gets the published page", readerView.status === 200);
  check("the published page is the exact HTML the browser rendered", (await readerView.text()) === html);
  const svg = await fetch(`${ORIGIN}/rendered/${SLUG}/figures/kg-1.light.svg`);
  check("figures are served with an SVG content type", svg.headers.get("content-type") === "image/svg+xml");
}

const wrangler = spawn(
  "npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } },
);
let log = "";
wrangler.stdout.on("data", (d) => { log += String(d); });
wrangler.stderr.on("data", (d) => { log += String(d); });

try {
  console.log(`starting wrangler dev on ${ORIGIN} …`);
  await waitForServer();
  console.log(`driving the contract against slug "${SLUG}"\n`);
  await drive();
} catch (error) {
  failures += 1;
  console.error(`\nsmoke run threw: ${String(error)}`);
  console.error(log.split("\n").slice(-25).join("\n"));
} finally {
  wrangler.kill("SIGTERM");
}

console.log(`\n${failures === 0 ? "all checks passed" : `${String(failures)} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
