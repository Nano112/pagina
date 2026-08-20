---
date: 2026-07-02
description: I deleted eleven of the fourteen scripts in my bin directory and missed two of them.
tags: [tools]
cover: media/toolbox.svg
cover_alt: Three tools laid out on a bench, and eleven empty outlines beside them
---

# The smaller toolbox

My `~/bin` had fourteen scripts in it. I wrote all of them, most between 2019 and 2022, and I could
not have told you what nine of them did.

So I deleted eleven and kept three, on the rule that anything I had not run since the start of the
year was gone. The deleted ones are in git; this was not brave.

Over the following two months I missed two of them. One was a four-line wrapper around `ffmpeg`
that I rewrote from memory in about a minute. The other was a script that renamed scanned receipts
by their date, which took longer to reconstruct than it had taken to write, because the original
had accumulated three years of small fixes for edge cases I no longer remembered encountering.

That second one is the interesting case. The value was not in the code, which was thirty lines. It
was in the list of things that had gone wrong with scanned receipts since 2021, and that list only
existed as conditionals in a file I had stopped reading.

A tool you use weekly is a tool you can rewrite. A tool you use twice a year is a record of
problems you have forgotten, and deleting it deletes the record.

I have not put the other nine back.
