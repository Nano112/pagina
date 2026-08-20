/**
 * `GET {base}/events` — one Durable Object per article slug, holding that article's open streams.
 *
 * A Worker cannot do this on its own. Module-global state in a Worker is per-isolate, and there
 * are many isolates in many colos, so a `Set` of subscribers in `worker.ts` would deliver an event
 * to whichever fraction of the readers happened to share an isolate with the writer. Under
 * `wrangler dev` that bug is invisible, because one isolate serves everything. A Durable Object is
 * the runtime's answer to "all of these connections must meet in one place", and routing it by
 * slug means two articles never contend.
 *
 * It stores nothing. The edit log lives in R2 beside the files, so the folder stays the whole
 * truth and this object can be thrown away and re-created without losing anything.
 */
const encoder = new TextEncoder();

/**
 * How long a single subscriber may take a frame before it is treated as gone.
 *
 * A reader that has closed its connection does **not** make the next write reject. The frame goes
 * into the stream's queue, the queue fills, and the write after that waits for room that will
 * never come. Nothing times it out, so the request that triggered the broadcast never finishes
 * either — the author's save hangs because somebody else closed a tab.
 *
 * This was not visible against an in-memory stand-in, where the queue never filled. It showed up
 * on the first run under `wrangler dev`, which is the argument for running it under `wrangler dev`.
 */
const WRITE_TIMEOUT_MS = 250;

/** Frames a subscriber may fall behind by before backpressure is real rather than incidental. */
const QUEUE_DEPTH = 64;

export class ArticleEvents {
  /** Every writer currently attached to an open `text/event-stream` response. */
  readonly #writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/subscribe") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(
        undefined, { highWaterMark: QUEUE_DEPTH },
      );
      const writer = writable.getWriter();
      this.#writers.add(writer);
      // A comment frame and a retry hint: the first proves the stream is open before anything has
      // happened, the second is what an EventSource uses to come back after a deploy.
      void writer.write(encoder.encode(": pagina edit events\n\nretry: 2000\n\n")).catch(() => {
        this.#writers.delete(writer);
      });
      return new Response(readable, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          // Proxies that buffer an unknown stream turn SSE into a page that arrives at the end.
          "x-accel-buffering": "no",
        },
      });
    }

    if (pathname === "/broadcast" && request.method === "POST") {
      const frame = encoder.encode(`data: ${await request.text()}\n\n`);
      await Promise.all([...this.#writers].map(async (writer) => {
        // Failing and stalling both mean "gone". Only the first announces itself, so the second
        // needs a clock: whichever way a subscriber stops taking frames, it is dropped, and the
        // write that is waiting on it is abandoned rather than allowed to hold up a save.
        const delivered = await Promise.race([
          writer.write(frame).then(() => true, () => false),
          new Promise<boolean>((resolve) => setTimeout(() => { resolve(false); }, WRITE_TIMEOUT_MS)),
        ]);
        if (delivered) return;
        this.#writers.delete(writer);
        void writer.abort().catch(() => undefined);
      }));
      return new Response(null, { status: 204 });
    }

    return new Response("not found", { status: 404 });
  }
}
