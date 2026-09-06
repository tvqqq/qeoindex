# QEO-129 Adjusted Daily Shadow Design

Date: 2026-09-06
Status: Approved in chat; written-spec review pending
Parent: QEO-125
Depends on: QEO-123, QEO-124
Unblocks: QEO-126, then QEO-125 consumer cutover

## 1. Purpose

QEO-129 creates the production-safe shadow foundation for corporate-action-adjusted Daily OHLCV without changing any current Chart, Wyckoff, indicator, AI Council or EOD consumer source.

The existing `market_ohlcv_history` table remains raw/provider evidence. QEO-129 adds a separate adjusted Daily store derived from raw Daily plus one exact QEO-124 factor run. Production consumers remain on the pre-QEO-129 source until QEO-126 maintains the shadow state through EOD and QEO-125 performs the later consumer cutover.

## 2. Non-goals

- Do not repurpose, rewrite, delete or rename `market_ohlcv_history`.
- Do not activate Chart, Wyckoff, indicators or AI Council on adjusted Daily.
- Do not implement corporate-action discovery or ex-date activation logic owned by QEO-126.
- Do not implement canonical-200 consumer rollout owned by QEO-125.
- Do not merge raw and adjusted rows when adjusted coverage is incomplete.
- Do not infer or synthesize a factor when QEO-124 lineage is missing, blocked or ambiguous.

## 3. Migration identity

The previous implementation plan reserved `20260906165000_qeo129_adjusted_daily_shadow.sql`, but `20260906165000` is now owned by QEO-124.

QEO-129 therefore uses:

`20260906170000_qeo129_adjusted_daily_shadow.sql`

If Supabase applies a different production timestamp, repository-to-production equivalence must be recorded explicitly in `supabase/migration-equivalence.json` and the reviewed production migration ledger before DB Drift can be GREEN.

## 4. Storage model

### 4.1 `market_ohlcv_adjusted_daily`

Derived and recomputable chart-basis rows keyed by one canonical ticker/session identity.

Required fields:

- `ticker`
- `session_date`
- `bar_time`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `raw_bar_time`
- `factor_run_id`
- `factor_version`
- `event_lineage_hash`
- `adjustment_engine_version`
- `rebuilt_at`

Primary key: `(ticker, session_date)`.

`factor_run_id` must reference the exact QEO-124 `market_adjustment_factor_runs.id`. The text factor version and lineage hash remain denormalized audit/readback fields, but row identity must be traceable to the exact persisted factor run rather than only copied hash strings.

Required integrity constraints:

- positive O/H/L/C;
- `high >= greatest(open, close, low)`;
- `low <= least(open, close, high)`;
- non-negative volume;
- canonical session identity is unique;
- lineage hash is a 64-character lowercase hex hash;
- factor version and engine version are non-empty;
- `bar_time` preserves the canonical raw Daily timestamp and `raw_bar_time` records the exact raw row identity used for derivation.

### 4.2 `market_adjusted_daily_rollout`

Per-ticker shadow state:

- `ticker` primary key;
- `status`: `shadow | active | blocked`;
- `factor_run_id` nullable;
- `factor_version` nullable;
- `event_lineage_hash` nullable;
- `verified_from` nullable;
- `verified_through` nullable;
- `verified_at` nullable;
- `activated_at` nullable;
- `blocked_reason` nullable;
- `updated_at`.

New rows default to `shadow`.

QEO-129 may persist `shadow` and `blocked`. It must not move a ticker to `active`; activation ownership remains QEO-126/QEO-125 according to the rollout sequence.

## 5. Security boundary

Both tables are derived server-side state.

- RLS enabled.
- `anon` and `authenticated` receive no direct table privileges.
- Mutations are service-role-only.
- Readback RPC is service-role-only.
- Browser/UI code receives no QEO-129 table access in this issue.

The migration introduces a bounded readback RPC such as:

`qeo_adjusted_daily_readback(p_ticker, p_from, p_to, p_factor_run_id, p_lineage_hash)`

It returns only the persisted session identities and exact lineage fields needed to prove a rebuild. Rebuild success must be derived from this persisted readback, never from an upsert acknowledgment or in-memory candidate count.

## 6. Pure raw-to-adjusted transformation

QEO-129 adds one provider-agnostic pure transformation:

`raw Daily + exact QEO-124 factor run -> adjusted Daily`

### 6.1 Factor-run status contract

A shadow rebuild may consume only a QEO-124 factor run whose persisted status is `candidate` or `active`.

- `candidate` is required for QEO-129 production shadow acceptance because QEO-126 has not activated the lineage yet.
- `active` is accepted by the reusable rebuild API so QEO-126 can later maintain the same adjusted store without inventing a second implementation.
- `blocked` and `superseded` runs are rejected for derivation.
- QEO-129 never mutates the status of `market_adjustment_factor_runs`.

The expected factor run ID, ticker, factor version, engine version and event lineage hash must agree exactly before any adjusted row is persisted.

### 6.2 Transition-to-session factor projection

QEO-124 persists one transition per effective corporate-action session, not one factor row per Daily session. Its cumulative factors are computed newest-to-oldest.

QEO-129 projects those transitions onto raw Daily sessions deterministically:

1. Sort the exact run's transitions by `effective_session` ascending.
2. For a raw session `D`, find the first transition where `effective_session > D`.
3. If such a transition exists, use that transition's `cumulative_price_factor` and `cumulative_volume_factor`.
4. If no later transition exists, use identity `1.0 / 1.0` **as a deterministic consequence of the same exact factor run**, not as an independently fabricated fallback.
5. The comparison is strict `>`: an action effective on session `D` does not re-adjust that session for its own event, although later effective events may still contribute to its backward factor.
6. A valid no-event QEO-124 candidate run with zero transitions therefore projects identity factors to every covered raw session while retaining the exact run/version/lineage provenance.

This projection is the only factor-selection algorithm QEO-129 may use.

### 6.3 Numeric transformation rules

- O/H/L/C multiply by the projected cumulative price factor.
- Volume multiplies by the projected cumulative volume factor; it never reuses the price factor implicitly.
- Session date and raw bar identity are preserved from the canonical raw Daily row.
- Factor run/version/lineage are copied from the exact QEO-124 run used for derivation.
- Missing run coverage, rejected run status, ambiguous lineage or invalid numeric output return an unresolved result; raw passthrough is forbidden.

Identity projection is valid only when attached to a valid exact QEO-124 run. QEO-129 does not create an independent fallback factor lineage.

## 7. Bounded rebuild API

Server-only API:

`rebuildAdjustedDailyRange({ ticker, fromDate, toDate, expectedFactorRunId, expectedLineageHash })`

Flow:

1. Validate ticker/range and expected lineage.
2. Load canonical raw `1D` rows from `market_ohlcv_history` using existing session rules.
3. Load the exact QEO-124 run and all transitions for that run.
4. Require run status `candidate | active` and exact ticker/version/lineage agreement.
5. Project one deterministic price/volume factor pair for every raw session using Section 6.2.
6. Derive every session independently through the pure transformer.
7. Do not persist unresolved sessions as raw fallbacks.
8. Upsert resolved adjusted rows in bounded batches.
9. Invoke `qeo_adjusted_daily_readback` for the requested range and expected factor run/lineage.
10. Compare expected resolved sessions to exact persisted sessions.
11. Only persisted exact matches count as `rebuiltSessions`; all mismatches remain unresolved.
12. Update rollout metadata to `shadow` when the requested verified range is complete; otherwise preserve or set `blocked` with a bounded reason.

No code path in QEO-129 can set `active`.

## 8. Shadow read boundary

Server-only loader:

`loadAdjustedDailyRange(supabase, ticker, fromMs, toMs)`

Return contract includes:

- ordered bars;
- `factorRunId`;
- `factorVersion`;
- `lineageHash`;
- `complete`;
- unresolved/missing session metadata where needed for operations.

Rules:

- one ticker range may expose only one verified factor lineage expected by rollout metadata;
- duplicate canonical session dates fail closed;
- incomplete adjusted coverage returns `complete=false`;
- the loader never fills holes from raw Daily;
- QEO-129 does not wire this loader into current production consumers.

## 9. Production VHM shadow acceptance

QEO-129 terminal gate is VHM-only production shadow acceptance.

Required evidence:

1. Apply and reconcile the QEO-129 migration only after local zero-to-latest replay, schema contracts, generated types and TypeScript are GREEN.
2. Materialize or reuse one verified QEO-124 VHM `candidate` factor run covering the retained Daily history required for the golden test.
3. Rebuild VHM adjusted Daily into `market_ohlcv_adjusted_daily` with rollout status `shadow`.
4. Exact readback proves complete expected session coverage and one expected factor run/lineage.
5. Zero duplicate or shifted VHM sessions.
6. QEO-93 aggregation of 13-17/10/2025 adjusted Daily reproduces the pinned independent benchmark approximately `H=63.31`, `L=55.18` within documented market-data tolerance.
7. Raw VHM `market_ohlcv_history` row count/session identities and a stable value checksum are unchanged before versus after shadow rebuild.
8. No Chart/Wyckoff/AI Council consumer import/query path changes to the adjusted store.
9. Measure adjusted-table row count, table size and incremental database growth before unblocking QEO-126.

## 10. Failure semantics

### Missing factor-run coverage

If the expected factor run cannot be loaded or does not match ticker/version/lineage, mark the requested sessions unresolved. Do not persist raw values as adjusted rows and do not advance verified rollout coverage.

### Blocked, superseded or ambiguous QEO-124 run

Set/retain rollout `blocked` with a bounded reason. Do not derive or persist adjusted sessions from that run.

### Persistence mismatch

If upsert succeeds but exact DB readback is missing a session, has a different factor run, or has a different lineage hash, that session is unresolved and the rebuild does not count as complete.

### Raw Daily mutation during rebuild

The adjusted rebuild does not mutate raw Daily. Production acceptance compares raw evidence before/after; any change invalidates QEO-129 acceptance until explained independently.

## 11. Testing strategy

TDD order:

1. Schema RED: tables, constraints, RLS, grants, `factor_run_id` FK, rollout default and service-role-only readback RPC.
2. Factor projection RED: before-first-event, between-events, exact ex-date, after-last-event and zero-transition identity-run cases.
3. Pure transform RED: price factor, volume factor, rejected run status and invalid-output behavior.
4. Persistence RED: successful write acknowledgment without exact readback must remain unresolved.
5. Shadow read RED: ordered unique sessions, exact lineage, incomplete range returns `complete=false`, no raw merge.
6. VHM fixture/golden regression through QEO-93 aggregation.
7. Consumer-isolation contract proving Chart/Wyckoff/AI Council remain on their pre-QEO-129 boundaries.
8. DB Drift and full Verify after production migration reconciliation.

## 12. Rollout sequence after QEO-129

1. QEO-129: VHM shadow storage/rebuild/readback accepted; no consumer cutover.
2. QEO-126: EOD v4 maintains corporate actions, activates effective factor lineages and calls this rebuild API incrementally.
3. QEO-125: atomically activates verified adjusted Daily for Chart/Wyckoff/AI Council per ticker and stages canonical-200.
4. QEO-98: final production price-basis/data/visual acceptance.

This ordering removes the old QEO-125/QEO-126 dependency cycle while keeping raw evidence and consumer authority explicit.

## 13. Decision summary

Approved decisions:

- dedicated shadow table, not a view and not a rewrite of raw history;
- migration version `20260906170000` because `165000` belongs to QEO-124;
- adjusted rows reference exact QEO-124 `factor_run_id` in addition to text lineage fields;
- QEO-124 transition factors project to sessions using the strict-next-effective-session algorithm in Section 6.2;
- QEO-129 shadow accepts verified `candidate` runs and the reusable API may later accept `active` runs; blocked/superseded runs fail closed;
- exact DB readback is the only success authority;
- incomplete adjusted coverage never merges with raw data;
- rollout remains `shadow` in QEO-129;
- VHM is the only production ticker required for QEO-129 terminal acceptance;
- QEO-126 follows QEO-129, and QEO-125 consumer cutover follows QEO-126.