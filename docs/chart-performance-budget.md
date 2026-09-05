# Chart performance budget (QEO-97)

## Scope

These budgets apply to `/insights/[ticker]` and preserve the canonical QEO-103 history horizons:

- `1m / 15m / 30m`: at most 31 calendar days;
- `1h / 2h / 4h`: at most 366 calendar days;
- `>=1D`: full available canonical Daily history.

The client must never solve performance by requesting history outside those product limits or by fabricating lower-timeframe candles.

## Production budgets

| Interaction | Budget | Enforcement / evidence |
| --- | ---: | --- |
| Initial visible chart, uncached | p95 <= 2.5 s to usable chart | Vercel/API timing + production smoke |
| Repeat closed-session timeframe switch | no duplicate network request for a covered range; cache resolution <= 50 ms | bounded client range cache stats / network observation |
| Pan-left hydration | p95 <= 2.5 s per bounded window | API timing; current chart remains visible |
| Initial lower-timeframe browser payload | <= 2 MiB JSON | bounded initial history windows |
| Mid-term aggregated browser payload | <= 2 MiB JSON | server-side QEO-93 aggregation |
| Client closed-range cache | <= 24 response windows, TTL <= 10 min | hard code bound |
| Realtime freshness | 5 s polling; closed-range cache is bypassed during live session | explicit fresh request path |
| Indicator calculation | target < 16 ms for the canonical bars already present in the browser | production profiling when all indicators enabled |

## Cache rules

1. Cache normalized server responses only when metadata says `sessionState=CLOSED`.
2. Live/current-session requests always bypass the closed-session cache.
3. A cached window may satisfy a repeat request only when it covers the requested start and its end is no more than 10 minutes behind the new wall-clock `to`. This tolerates timeframe switches after market close without treating a live market as immutable.
4. Cache is in-memory, per browser tab/runtime, bounded to 24 LRU-like entries and 10 minutes. It is an acceleration layer only, never a source of truth.
5. In-flight request coalescing remains independent of the response cache.

## Derived hourly cache decision gate

Do **not** add another canonical or durable `1h` store by default. A rebuildable derived hourly cache is justified only when production measurements show one-year `1h/2h/4h` requests materially miss the 2.5 s p95 budget or repeatedly decompress/aggregate enough cold raw `1m` data to create a clear cost bottleneck. QEO-93 aggregation remains the only semantic authority.

## Regression guardrails

- Panning/prepending must not clear the current bars while the older request is in flight.
- Realtime refresh must merge by timestamp and preserve the current viewport/drawings.
- Provider failure must surface `stale` rather than spin an infinite loading state.
- Cache hits must never suppress a live-session refresh.
