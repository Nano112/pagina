/**
 * The two things pagina does with a date, in one place because three surfaces have to agree.
 *
 * A date is written by an author — `date: 2026-08-01` in a page's front matter — and then read by
 * a reader (the line under a post's title), by a feed reader (Atom's `updated`, which must be
 * RFC 3339) and by a sort (the blog index's order). Those are three different renderings of one
 * value, and when they lived in three files they disagreed: the shell spelled a month out, the
 * feed passed the string through untouched, and the index compared strings.
 *
 * Neither function uses `Intl`. The shell renders on whatever Node a build runs on and the same
 * HTML is then served to every reader, so an ICU build difference between two machines would make
 * one folder produce two different sites. A value that is not a date pagina understands is passed
 * through unchanged rather than guessed at — it is still the author's — and the machine-readable
 * half is simply omitted where it cannot be produced.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date as a reader reads it: `2026-08-01` → `1 August 2026`. Anything else, unchanged. */
export function readableDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (month === undefined) return iso;
  return `${String(Number(m[3]))} ${month} ${m[1]!}`;
}

/**
 * A date as Atom requires it, or `undefined` when the string is not a date at all.
 *
 * A bare `2026-08-01` is midnight UTC rather than midnight *somewhere*: the alternative is a feed
 * whose entry order depends on the timezone of the machine that built it, which is the same folder
 * producing two different feeds. Anything with a time in it is normalised through `Date`, so an
 * offset the author wrote is honoured and then expressed in UTC.
 */
export function rfc3339(iso: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso}T00:00:00Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/**
 * A date as a sort key: milliseconds, and `-Infinity` for a string that is not a date.
 *
 * Unorderable dates therefore sort *last* rather than first, which is the safe direction for an
 * index that is newest-first — a typo puts a post at the bottom of the page instead of at the top
 * of it. Callers break the resulting tie on the page's path so the order is still deterministic.
 */
export function dateStamp(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}
