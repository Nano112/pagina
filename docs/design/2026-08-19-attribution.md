# Who edited what — design

Date: 2026-08-19. Status: from the user's brief, asking whether pagina can track who edited what
across Laravel, Node, or any other host.

## Where this starts

It cannot. `FileEntry` is `{ path, version, size?, mtime? }`; `write()` takes a path, text and an
optional version. No part of the backend contract carries identity, so nothing downstream can. The
Laravel package calls `auth()` when importing a bundle and when listing articles, and never in the
write path.

The clearest symptom is the conflict banner. It already knows a file changed under an editor and can
show `theirs` — and has to say *"changed on the server"*, because whose is not a thing it can know.

## The rule that shapes everything else

**Identity comes from the host, never from the client.** The browser says what it is editing; the
server says who is editing. An author supplied in a request body is a claim, and a claim is
forgeable — a docs tool that lets a caller name themselves records fiction and invites the one
attack that matters here, writing as somebody else.

So `write()` gains no author parameter. The backend already knows.

## Two levels, because they cost differently

**Attribution** — who last touched this file, and when. One row per file, overwritten. Cheap enough
that every backend can do it, and it answers the question people actually ask.

`FileEntry` and `stat()` gain `lastEditedBy?: Author` and `lastEditedAt?: string`.

**History** — the sequence. An append-only record of who did what, when, and to which version.
Expensive to keep, and not every host wants it, so it is an *optional* backend method:

```ts
history?(path?: string, opts?: { limit?: number }): Promise<Edit[]>
```

A backend that cannot answer omits the method; the editor hides the panel rather than showing an
empty one. `Author` is `{ id, name, email?, avatarUrl? }` — `id` is the host's own identifier, and
`name` is what a person is called, because a UI that shows a UUID is not attribution.

## What each backend can honestly do

| Backend | Attribution | History |
|---|---|---|
| Laravel | `auth()->user()` on every write | a table |
| `viteEditMiddleware` | a configured identity, or the OS user | an append-only JSON log beside the folder |
| Memory | a single caller identity | in memory |
| LocalStorage | one browser, one person, and it should say so | in that browser only |

The local ones are not pretending to be an audit trail. A single-user dev server recording "harrison"
is honest; the same server recording nothing at all is less useful and no more honest.

## Publishing is an edit too

`publish()` returns `{ publishedAt }`. It should also record who published, because that is the event
a reader's page is attributed to, and the one most worth having later. Add it to the returned record
and to whatever the host stores.

## The conflict banner is the reason to do this

"index.md changed on the server while you were editing it" becomes "Alice changed index.md two minutes
ago". Same mechanism, same 409, materially different for the person deciding whether to keep their
version. This is where attribution stops being metadata and starts being useful.

## Bundles carry provenance, but not by default

A `.pgz` is an export, and an export can leave the organisation it came from. Attribution is personal
data: a staff list, effectively. So `pack` **strips it by default** and `--with-attribution` includes
it, documented in both directions. The opposite default would leak names to whoever receives a
bundle, which is not a thing to discover afterwards.

## What this is not

Not revision history: pagina does not store old contents, and `history` records that an edit happened
rather than what it said. Not collaboration: no presence, no cursors, no merge. A host that wants
real revisions has git or a database and should use them; this is the layer that says who, so that a
host with either can join them up.

## Verification

The security property first, because it is the one that matters: a request that names an author in
its body must be attributed to its session, not to the name it sent. Then attribution surviving the
round trip a real host makes (write, read back, list, conflict), history ordering and its absence
being handled, `pack` stripping by default and including on request, and the conflict banner naming
a person against a backend that reports one.
