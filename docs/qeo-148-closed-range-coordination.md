# QEO-148 closed-range ingestion contract

Last reviewed: 2026-09-09.

This document defines the reusable closed-range coordination boundary introduced by QEO-148. It is an implementation contract for current chart-data callers and for QEO-150 ingestion scheduling. It does not activate any pending database migration by itself.

## Scope

QEO-148 coordinates canonical raw `1m` provider ingestion for **closed** requested ranges. It does not own UI behavior, scheduler cadence, historical provenance cleanup, or live current-minute transport.

The pending database change is `supabase/pending-migrations/20260909160500_qeo148_closed_range_coordination.sql`. It remains **QUARANTINED** until an explicit release/production gate promotes it. Pending schema is not production evidence.

## Durable success authority

`chart_ohlcv_backfill_ranges.success_at` is the reusable success authority for a closed range. A provenance row, a prior failure, or a lease by itself is never coverage authority.

A range may publish QEO-148 success only after canonical persistence for that ingestion attempt has resolved successfully and the completion RPC accepts the active lease owner/fence. Application code therefore follows:

```text
claim closed range
  -> provider fetch
  -> canonical validation
  -> canonical HOT/COLD persistence owned by the caller
  -> provenance/evidence identity
  -> fenced completion
  -> reusable durable success
```

Failure before fenced completion abandons the lease best-effort and does not convert partial persistence or provenance into reusable coverage.

## Shared coordinator

Callers use `runClosedRangeIngestion` from `modules/market/chart-data/provider-ingestion.ts` with the Supabase adapters in `hot-store.ts`.

The coordinator provides:

- shared durable claim state across runtimes;
- overlapping active-range exclusion;
- bounded claim retries rather than unbounded provider fan-out;
- lease expiry recovery;
- fencing so a stale owner cannot publish after another owner takes over;
- ordinary success reuse with zero provider/write/provenance work on the covered path.

QEO-150 must call this shared coordinator/API. It must not introduce a second lock namespace, a second durable claim table, or a scheduler-specific interpretation of success.

## Coverage reads

`qeo_chart_intraday_success_coverage` performs gaps-and-islands merging in PostgreSQL and returns one ordered JSONB array. Returning one scalar instead of a rowset prevents a PostgREST result-row cap from truncating coverage when the requested history contains more than 1000 disjoint successful intervals.

Only rows with durable `success_at` participate. Coverage ordering is deterministic by range start/end.

## Live tail

The current live tail is outside ordinary closed-range reuse. During a live session, the chart service separates the closed portion from the recent/live tail:

- closed ranges use QEO-148 coordination and provider requests with `includeCurrent: false`;
- live-tail fetches keep `includeCurrent: true`;
- the current minute remains ephemeral;
- completed live minutes may persist through the existing canonical writer.

QEO-148 must not suppress live corrections by treating the current minute as durable closed coverage.

## Correction revalidation

Legitimate historical corrections use explicit `revalidateClosedIntradayRange` semantics rather than ordinary replay.

Revalidation intentionally bypasses the normal covered result and receives the previous durable content/provenance identity. If canonical provider content is unchanged, the caller can reuse the prior evidence without creating a new write/provenance record. If content changed, the corrected canonical bars remain writable, new provenance is preserved, and fenced completion replaces only the current durable success identity. Prior provenance remains auditable.

Provider/source identity participates in the canonical content identity; a source change therefore cannot silently impersonate unchanged evidence.

## Mixed-version rollout

While the QEO-148 migration is still quarantined, application code preserves compatibility with a schema that does not yet expose the coordination RPCs. An explicit missing-RPC condition may use the pre-QEO-148 uncoordinated path, but that fallback must not synthesize QEO-148 durable success.

Consequences until production promotion:

- correctness remains fail-open for retry rather than false coverage;
- QEO-148 idempotence/coordination guarantees are not active on runtimes lacking the schema;
- repeated-provider suppression must not be claimed as production-verified solely from branch tests.

## Release evidence

The isolated local rehearsal must prove at minimum:

- one successful ingestion followed by 100 ordinary replays leaves the durable fence unchanged and returns covered every time;
- overlapping active requests cannot both own provider work;
- provenance plus partial HOT persistence cannot publish reusable success;
- an abandoned/expired claim is recoverable and advances the fence;
- a stale owner cannot complete after takeover;
- correction revalidation replaces current success identity while preserving prior provenance;
- 1201 disjoint durable intervals are returned in full, stable order through the JSONB coverage RPC, including a covered claim beyond the 1000th element.

Production promotion/deployment and historical cleanup are separate authorized operations, not part of this contract.