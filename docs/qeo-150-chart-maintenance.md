# QEO-150 completed-session chart maintenance

Last reviewed: 2026-09-09.

This document defines routine completed-session freshness maintenance for the canonical interactive-chart `1m` universe. It extends the active chart-data contract without changing canonical storage ownership, QEO-148 coordination semantics, QEO-149 writer safety, or the QEO-107 historical bootstrap contract.

## Freshness identity

Each maintenance dispatch freezes:

- canonical universe `runId` and `sourceAsOfDate`;
- the exact 200 ticker membership;
- one expected latest completed Vietnam trading session derived from the securities calendar and configured close time.

A ticker is `current` only when its actual latest HOT `1m` trading date equals the expected completed session. Historical depth is not freshness: five older HOT sessions never make a stale ticker current.

Each report row exposes:

- `expectedSession`;
- `actualSession`;
- exact `current` boolean;
- evidence category;
- last available QEO-150 attempt outcome/dispatch identity.

## Evidence categories

The categories remain intentionally separate:

| Category | Meaning |
| --- | --- |
| `traded` | Actual canonical `1m` session identity equals the expected session. |
| `no_trade` | Explicit zero-volume Daily authority from VCI/DNSE or the existing verified market-close repair contract. No minute bars are fabricated. |
| `suspension` | Explicit suspension text exists in source evidence. Absence of bars alone never implies suspension. |
| `provider_gap` | The expected session is not present in HOT and traded/positive-volume Daily or explicit provider-gap evidence exists. |
| `failure` | Bounded provider/coordination/storage/capacity work failed. Failure never counts as fresh. |
| `unknown` | Evidence is insufficient to classify the missing expected session. |

Generic zero-volume fallback is `unknown`, not `no_trade`. Positive Daily volume proves that trading occurred but does not synthesize or prove complete minute history.

## Incremental ingestion

Routine reconciliation is not a QEO-107 bootstrap. Only the expected completed session range is considered.

QEO-150 calls the shared QEO-148 `runClosedRangeIngestion` coordinator with the existing claim/complete/abandon adapters. Provider work therefore inherits:

- durable shared claims across chart requests and maintenance;
- bounded claim retries and fencing;
- reuse of already-covered successful ranges;
- success publication only after canonical persistence;
- no network I/O while a database transaction lock is held.

New bars persist through `upsertHotIntradayBars`, preserving the QEO-149 writer boundary. QEO-150 has no uncoordinated fallback when claim/coordination fails: a missing/broken shared contract is an explicit failed maintenance outcome.

No fixed minute-bar count is assumed. Session identity, source evidence and real provider bars are used instead.

## Workflow and capacity

`chartIntradayMaintenanceWorkflow` processes the frozen universe in batches of 10. Tickers in a batch are isolated with `Promise.all`; one ticker failure does not abort siblings. Retryable outcomes receive at most two workflow attempts, in addition to the bounded QEO-148 claim/provider retry behavior.

Before each new batch, current chart storage capacity is checked. `HARD_STOP` prevents additional provider/write work and records explicit capacity-stop outcomes for remaining work. WARN does not invent projected bar counts.

A universe publication that changes during the run is reported through `universeChangedDuringRun`; the in-flight run continues to describe only its frozen membership.

## Dispatch and SLA

The existing authenticated `/api/qeoindex/eod` machine boundary adds:

- `POST ?mode=chart-maintenance` — starts the canonical-200 maintenance workflow and returns `dispatchId` plus workflow run ID;
- `GET ?mode=chart-maintenance-coverage` — read-only current freshness report.

Supabase `pg_cron` job `qeoindex-chart-intraday-maintenance-1450-ict` runs at 14:50 ICT on weekdays. This is four minutes after the currently configured 14:46 chart-session close and leaves the workflow inside the 30-minute reconciliation target. Holidays are resolved by the market calendar; a holiday dispatch resolves the previous completed trading session rather than inventing a session.

The workflow reports the exact SLA deadline, whether all frozen tickers were accounted for, and whether completion occurred by that deadline. Historical success or row depth cannot make a late/partial run green.

## Rollback and release

Rollback disables only `qeoindex-chart-intraday-maintenance-1450-ict`. Existing HOT/COLD data, QEO-148 range evidence, QEO-149 correction safety and chart reads remain intact.

Production acceptance requires source/CI gates plus release-authorized scheduler migration and a read-only post-dispatch coverage check. Destructive production tests, fabricated OHLCV, full-history maintenance replay and historical provenance cleanup are outside QEO-150.
