/**
 * R2 in a `Map`, for running the Worker under vitest without wrangler.
 *
 * It implements the seven methods `bindings.ts` declares and the two behaviours the contract leans
 * on: an ETag that is a hash of the bytes, and `onlyIf.etagMatches` refusing a write by answering
 * `null`. Everything else about R2 — durability, multipart, lifecycle rules — is absent, because
 * nothing here touches it.
 *
 * This is a stand-in, and a stand-in is a thing that agrees with the assertions rather than with
 * the product. That is why it is not the only way the Worker is exercised: `npm run smoke` in this
 * folder drives the same code under `wrangler dev`, against miniflare's real R2, over real HTTP.
 */
import { createHash } from "node:crypto";
import type {
  R2BucketLike, R2ListOptions, R2ListResult, R2ObjectBodyLike, R2ObjectLike, R2PutOptions,
} from "../src/bindings.js";

interface Stored {
  bytes: Uint8Array;
  etag: string;
  uploaded: Date;
  customMetadata?: Record<string, string> | undefined;
}

const md5 = (bytes: Uint8Array): string => createHash("md5").update(bytes).digest("hex");

const toBytes = (value: ArrayBuffer | string): Uint8Array =>
  typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);

function head(key: string, stored: Stored): R2ObjectLike {
  return {
    key, etag: stored.etag, size: stored.bytes.byteLength, uploaded: stored.uploaded,
    customMetadata: stored.customMetadata,
  };
}

export class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, Stored>();

  /** Puts bytes with no attribution — which is what a folder that nobody has edited yet looks like. */
  seed(key: string, text: string): void {
    const bytes = toBytes(text);
    this.objects.set(key, { bytes, etag: md5(bytes), uploaded: new Date() });
  }

  async head(key: string): Promise<R2ObjectLike | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : head(key, stored);
  }

  async get(key: string): Promise<R2ObjectBodyLike | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return null;
    const bytes = stored.bytes;
    return {
      ...head(key, stored),
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  async put(key: string, value: ArrayBuffer | string, options?: R2PutOptions): Promise<R2ObjectLike | null> {
    const expected = options?.onlyIf?.etagMatches;
    if (expected !== undefined && this.objects.get(key)?.etag !== expected) return null;
    const bytes = toBytes(value);
    const stored: Stored = {
      bytes, etag: md5(bytes), uploaded: new Date(),
      ...(options?.customMetadata === undefined ? {} : { customMetadata: options.customMetadata }),
    };
    this.objects.set(key, stored);
    return head(key, stored);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options: R2ListOptions = {}): Promise<R2ListResult> {
    const prefix = options.prefix ?? "";
    // R2 lists ascending by key, which is the property the edit log's inverted timestamps use.
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const from = options.cursor === undefined ? 0 : Number(options.cursor);
    const limit = options.limit ?? 1000;
    const page = keys.slice(from, from + limit);
    const wantsMetadata = options.include?.includes("customMetadata") === true;
    const truncated = from + limit < keys.length;
    return {
      objects: page.map((key) => {
        const entry = head(key, this.objects.get(key)!);
        return wantsMetadata ? entry : { ...entry, customMetadata: undefined };
      }),
      truncated,
      ...(truncated ? { cursor: String(from + limit) } : {}),
    };
  }
}
