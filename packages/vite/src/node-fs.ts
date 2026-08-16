import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ContentFs } from "@pagina/core";

/** `ContentFs` backed by the real filesystem, rooted at a folder. */
export class NodeContentFs implements ContentFs {
  constructor(private readonly root: string) {}
  private abs(p: string): string { return resolve(this.root, p); }
  async read(p: string): Promise<string> { return readFile(this.abs(p), "utf8"); }
  async readBinary(p: string): Promise<Uint8Array> { return new Uint8Array(await readFile(this.abs(p))); }
  async exists(p: string): Promise<boolean> { return existsSync(this.abs(p)); }
  async list(dir: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const name of await readdir(d)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const f = join(d, name);
        if ((await stat(f)).isDirectory()) await walk(f);
        else out.push(relative(this.root, f).split("\\").join("/"));
      }
    };
    await walk(this.abs(dir));
    return out.sort();
  }
}
