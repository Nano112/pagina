---
date: 2026-05-11
description: Seven days of reading a service's logs by hand, and the two things that turned up.
tags: [operations, logs]
---

# A week of reading logs by hand

The dashboards said the service was healthy. It was, on average. So for a week I read the raw log
instead, forty minutes each morning, no filters beyond a `grep -v` for the health check.

Two things turned up that no chart would have shown.

The first was a retry loop that succeeded on the second attempt every single time. Success rate:
100%. Latency at the 99th percentile: fine, because the retry was fast. But the first attempt was
failing on a stale connection roughly nine hundred times a day, and had been for months. Nobody had
written an alert for a thing that always worked in the end.

The second was a customer running the export endpoint on a cron, at midnight, requesting the whole
dataset. That request took eleven minutes and blocked nothing, which is why it never appeared
anywhere. It had been running nightly since February. When I asked, the customer said they had
built it as a stopgap and forgotten about it.

Neither of these is an outage and neither would have been caught by a better alert threshold. They
were both visible on the first morning of reading, and invisible on every dashboard we had.

I do not think this scales. A busy service produces more log than anyone can read, and the whole
point of aggregation is that you stop looking at lines. But a week of it, once, told me more about
what the system actually does than the previous quarter of graphs.
