/**
 * Reading an {@link Author} off a wire nobody here controls.
 *
 * Both consumers are boundaries: `HttpBackend` reads authors out of a server's JSON, and
 * `parseBundleManifest` reads them out of an archive that arrived from somewhere else. In each
 * case the value is whatever the other side sent, so it is validated into shape or discarded —
 * never widened with a cast. Anything that would render as a blank name is discarded, because an
 * empty label in the conflict banner is worse than no attribution at all.
 */
import type { Author } from "./types.js";

/** A non-empty string, or `undefined`. Trimmed, since a name of spaces renders as nothing. */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * An {@link Author} from untrusted JSON, or `undefined` when the value is not one.
 *
 * `id` and `name` are both required: an author with no name cannot be shown, and one with no id
 * cannot be matched against the person a host knows about.
 */
export function parseAuthor(raw: unknown): Author | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const id = str(o["id"]);
  const name = str(o["name"]);
  if (id === undefined || name === undefined) return undefined;
  const email = str(o["email"]);
  const avatarUrl = str(o["avatarUrl"]);
  return {
    id, name,
    ...(email === undefined ? {} : { email }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  };
}

/** An ISO-8601 instant from untrusted JSON, or `undefined`. A timestamp that cannot be parsed is not one. */
export function parseInstant(raw: unknown): string | undefined {
  const text = str(raw);
  if (text === undefined || Number.isNaN(Date.parse(text))) return undefined;
  return text;
}
