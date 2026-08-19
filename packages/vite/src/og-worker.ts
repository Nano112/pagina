/**
 * The child process that draws cards.
 *
 * A separate process for what is otherwise a function call, and the reason is specific: resvg is
 * Rust, and a handful of degenerate inputs make it **abort** rather than return an error. A group
 * with an opacity or a clip whose geometry misses the canvas entirely is one of them — five minutes
 * of prototyping found it. An abort is not catchable from JavaScript; it takes the whole process
 * with it, and with it the build.
 *
 * pagina composes its own cards carefully enough never to produce that shape (see `og-card.ts`),
 * but a **glyph** is an author's scene module and can be any shape at all. "A broken glyph must not
 * fail the build" is only true if a glyph that aborts the renderer is survivable, and the only way
 * to survive an abort is to have it happen somewhere else. So: jobs in, one line of NDJSON out per
 * job, and a parent that can tell which job was in flight when the process stopped answering.
 *
 * Protocol, one JSON object per line on stdout:
 *
 *   {"start":<index>}                      before a job is attempted
 *   {"index":<index>,"ok":true,"bytes":n}  after it is written
 *   {"index":<index>,"ok":false,"error":s} after it fails in a way that can be reported
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { renderCard, type CardJob } from "./og-render.js";

/** Draws every job in `file`, reporting each one as it goes. Exits non-zero only on a bad job file. */
export async function runCardJobs(file: string, report: (line: string) => void): Promise<void> {
  const jobs = JSON.parse(await readFile(file, "utf8")) as CardJob[];
  for (const [index, job] of jobs.entries()) {
    // Announced *before* the attempt: if this job is the one that aborts the process, this line is
    // the only evidence of which one it was.
    report(JSON.stringify({ start: index }));
    try {
      const png = await renderCard(job);
      await mkdir(dirname(job.out), { recursive: true });
      await writeFile(job.out, png);
      report(JSON.stringify({ index, ok: true, bytes: png.length }));
    } catch (error) {
      report(JSON.stringify({ index, ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

// `node og-worker.js <jobs.json>`. Guarded so importing this module in a test does not run it.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (file === undefined) {
    process.stderr.write("og-worker: expected a path to a jobs file\n");
    process.exit(2);
  }
  await runCardJobs(file, (line) => { process.stdout.write(`${line}\n`); });
}
