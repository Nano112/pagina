/**
 * @vitest-environment jsdom
 *
 * The `/__edit/` page's self-write guard, run as the page runs it.
 *
 * The guard ships as a string — it has to be a classic inline script, because Vite's HMR client is
 * a module and has already opened its socket by the time any module on the page could patch
 * anything. So the test evaluates that same string and then drives a socket through it. What is
 * under test is the decision, not the plumbing: a `full-reload` frame is dropped when the editor
 * has just written, and nothing else ever is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_WRITE_GUARD, SELF_WRITE_WINDOW_MS, renderEditPage } from "../src/edit-page.js";

/** Enough of a `WebSocket` for the guard to patch and for a test to dispatch through. */
class FakeSocket extends EventTarget {}

interface GuardWindow {
  __paginaSelfWrite?: (path: string, at?: number) => void;
  __paginaWroteRecently?: () => boolean;
  WebSocket?: unknown;
}

const host = (): GuardWindow => globalThis as unknown as GuardWindow;

const frame = (payload: unknown): MessageEvent =>
  new MessageEvent("message", { data: JSON.stringify(payload) });

describe("the edit page's self-write guard", () => {
  let received: unknown[];
  let socket: FakeSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    received = [];
    host().WebSocket = FakeSocket;
    delete host().__paginaSelfWrite;
    delete host().__paginaWroteRecently;
    // The page runs this as `<script>…</script>`; the test runs the same characters.
    new Function(SELF_WRITE_GUARD)();
    socket = new FakeSocket();
    socket.addEventListener("message", (event) => {
      received.push(JSON.parse((event as MessageEvent).data as string));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete host().WebSocket;
  });

  const send = (payload: unknown): void => { socket.dispatchEvent(frame(payload)); };

  it("passes a full-reload through when the editor has written nothing", () => {
    send({ type: "full-reload" });
    expect(received).toEqual([{ type: "full-reload" }]);
  });

  it("drops a full-reload that lands inside the editor's own write window", () => {
    host().__paginaSelfWrite!("guide/tabs.md");
    send({ type: "full-reload" });
    expect(received).toEqual([]);
  });

  it("passes it again once the window has expired", () => {
    host().__paginaSelfWrite!("guide/tabs.md");
    vi.advanceTimersByTime(SELF_WRITE_WINDOW_MS + 1);
    send({ type: "full-reload" });
    expect(received).toEqual([{ type: "full-reload" }]);
  });

  // Everything else on that socket is either harmless or wanted — a scene hot-swap most of all,
  // which is the one message the editor actively benefits from receiving after its own save.
  it("never drops anything but a full-reload", () => {
    host().__paginaSelfWrite!("scenes/demo.mjs");
    send({ type: "custom", event: "kineglyph:update", data: { url: "/scenes/demo.mjs" } });
    send({ type: "connected" });
    send({ type: "update", updates: [] });
    expect(received).toHaveLength(3);
  });

  it("survives a frame that is not JSON, and one that is not an object", () => {
    host().__paginaSelfWrite!("index.md");
    socket.dispatchEvent(new MessageEvent("message", { data: "full-reload but not json" }));
    socket.dispatchEvent(new MessageEvent("message", { data: 42 }));
    expect(received).toHaveLength(1); // only the parseable one reached the handler's JSON.parse
  });

  it("keeps removeEventListener working, so a reconnect can detach its handler", () => {
    const listener = vi.fn();
    socket.addEventListener("message", listener);
    send({ type: "connected" });
    expect(listener).toHaveBeenCalledTimes(1);

    socket.removeEventListener("message", listener);
    send({ type: "connected" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is carried by the rendered page, ahead of every module script", () => {
    const html = renderEditPage({
      backendUrl: "/__pagina/edit", page: "index.md", base: "/",
      kineglyphRuntimeUrl: "/kg", editorEntryUrl: "/e", siteCssUrl: "/c",
    });
    expect(html).toContain("__paginaSelfWrite");
    // A classic script, not a module: a module would run after Vite's client had already connected.
    expect(html).not.toContain(`<script type="module">${SELF_WRITE_GUARD}`);
    expect(html.indexOf("__paginaSelfWrite")).toBeLessThan(html.indexOf(`<script type="module"`));
  });
});
