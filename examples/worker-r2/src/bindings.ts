/**
 * The exact slice of the Workers runtime this example uses, written out as interfaces.
 *
 * `@cloudflare/workers-types` would supply all of it and several hundred things besides. Declaring
 * only what is touched has two payoffs: the example typechecks with no Cloudflare dependency at
 * all, and the file doubles as a list of the R2 features the HTTP contract actually needs — which
 * is short, and is the argument that another object store could stand in.
 */

/** `{ id, name, email?, avatarUrl? }`, per the attribution contract. */
export interface Author {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly avatarUrl?: string;
}

export interface R2ObjectLike {
  readonly key: string;
  /** Content hash for a single-part upload, unquoted. This is the contract's `version`. */
  readonly etag: string;
  readonly size: number;
  readonly uploaded: Date;
  readonly customMetadata?: Record<string, string> | undefined;
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface R2PutOptions {
  readonly customMetadata?: Record<string, string>;
  /**
   * Compare-and-swap. R2 evaluates it inside the write, so `If-Match` closes over the read as
   * well — a plain read-then-write would leave a window in which two editors both saw the same
   * version and both stored. A refused write answers `null`.
   */
  readonly onlyIf?: { readonly etagMatches?: string };
}

export interface R2ListOptions {
  readonly prefix?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly include?: ("customMetadata" | "httpMetadata")[];
}

export interface R2ListResult {
  readonly objects: R2ObjectLike[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: ArrayBuffer | string, options?: R2PutOptions): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
  list(options?: R2ListOptions): Promise<R2ListResult>;
}

export interface DurableObjectStubLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface Env {
  /** The bucket every article folder lives in. */
  readonly ARTICLES: R2BucketLike;
  /** One instance per slug, holding that article's open event streams. */
  readonly EVENTS: DurableObjectNamespaceLike;
  /**
   * `{ "<token>": { "id": "…", "name": "…", "email": "…" } }` as JSON.
   *
   * A shared secret per person, which is the smallest thing that can answer "who wrote this" for
   * a two-author blog. It is not an identity provider: see the deployment page for what that costs
   * you and what to put in front of it instead.
   */
  readonly EDITORS?: string;
  /** URL prefix the editor contract is mounted at. Default `/api/articles`. */
  readonly API_BASE?: string;
  /** Prefix for the `url` an upload reports, so a page can link the file it just stored. */
  readonly SITE_BASE?: string;
}
