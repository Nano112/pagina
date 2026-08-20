---
date: 2026-08-19
draft: true
description: Unfinished. Half of this is wrong and I have not worked out which half.
tags: [caching]
---

# Notes towards something about caching

`draft: true` keeps this out of the archive on the front page, out of `feed.xml` and out of
`sitemap.xml`. It still builds, and it still has a URL, which is the point: a draft you cannot open
in a browser is a draft nobody can review.

What I have so far is that the two hard cases are not invalidation and naming. They are the case
where the cache is correct and stale at the same time, and the case where two callers disagree
about how long stale is acceptable.

The second one is really a configuration problem wearing a caching costume, and I think the first
one is too, but I have not been able to write the argument down without it collapsing into "it
depends".

Not publishing this yet.
