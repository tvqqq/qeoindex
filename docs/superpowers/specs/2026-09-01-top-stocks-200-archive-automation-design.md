# Top Stocks 200 Archive, Notion, AI Council & Cron Architecture

Date: 2026-09-01
Status: Approved design, pending written-spec review
Branch: `feat/canonical-200-wyckoff-runtime`

## 1. Goal

Complete the Top Stocks 200 cutover across QeoIndex while keeping Supabase below its 500 MB database limit.

The target architecture is:

- **Supabase = operational hot store** for current/short-retention data needed by UI, EOD, Wyckoff, AI Council and schedulers.
- **Google Drive = raw historical archive** for bulky time-series exports such as OHLCV CSV/Parquet.
- **Notion = long-term analytical/audit system of record** for universe history, EOD summaries, Wyckoff summaries, AI Council conclusions, research decisions and cron run summaries.

The canonical stock universe is always the currently published `vn_top_stocks` run from Supabase, max 200 stocks.

## 2. Current production facts

As of 2026-09-01:

- current universe key: `vn_top_stocks`
- candidates passing selector: 207
- selected: 200
- rank range: 1..200
- detail complete: 200/200
- logo covered: 200/200
- exchange mix: HOSE 153, HNX 27, UPCOM 20
- selector:
  - `average_volume_50_sessions > 250000`
  - `market_cap_billion > 10`
  - sort market cap DESC, Avg50 DESC, ticker ASC
  - max 200

Largest Supabase relations currently include approximately:

- `insights_stock_ratings`: 128 MB, 19,272 rows, only 11 daily snapshots across ~1,752 tickers.
- `market_ohlcv_history`: 101 MB, ~226k rows.
- `market_ohlcv_history` currently holds 1D history back to 2018 and 1H history back to 2026-03.

Therefore retention is a first-class operational requirement, not an optional optimization.

## 3. Source-of-truth hierarchy

### 3.1 Universe membership

Supabase current published `market_universe_runs` + `market_universe_memberships` is authoritative for operational membership.

Every stock-universe-aware function must resolve membership through the canonical current universe read model (`qeo_current_market_universe()` / `getCanonicalUniverse()`).

Notion never decides current membership.

### 3.2 Market/technical data

Supabase holds the working set required by current UI and calculations.

Google Drive stores exported historical raw time-series after they age out of the hot store.

### 3.3 Analytical history

Notion stores compact human-readable/versioned history:

- monthly universe memberships;
- EOD per-stock analytical snapshots;
- EOD run summaries;
- AI Council conclusions;
- Wyckoff summaries;
- thesis / analysis / evidence indexes.

Historical Notion records are append-only for audit semantics. They are not rewritten when a later methodology changes.

## 4. Notion database classification

### 4.1 Keep as canonical research databases

Keep without Top200 migration of their historical contents:

- `Stock Thesis`
- `Analysis Log`
- `Research Sources`

These are ticker/research-history databases and are not universe-membership materializations.

### 4.2 Mark legacy/deprecated

Existing databases/contracts whose semantics are Top50/Top100 or whose operational role is superseded must be renamed with a visible prefix.

Use one of:

- `LEGACY — ...` for historical evidence that must remain queryable.
- `DEPRECATED — ...` for structures no longer written by production.

Known examples:

- `DEPRECATED — Wyckoff Universe Top 100 HOSE`
- `Daily Wyckoff Scan — Legacy`
- old Top100/Top50 operational scan databases or linked views discovered during full Hub audit.

The existing `Wyckoff Unified Data Contract v2` remains as historical documentation but is renamed `LEGACY — Wyckoff Unified Data Contract v2 — Top100` after the v3 contract is created.

### 4.3 Existing generic databases

`Wyckoff Unified Snapshots` and `Wyckoff Unified Scan Runs` have generic schemas and can support multiple exchanges, but their current contract/views contain Top100 assumptions.

They become legacy operational staging after the new archive flow is deployed. They are not the new long-term yearly analytical archive.

Historical rows remain untouched.

## 5. New Notion architecture

### 5.1 `Top Stocks 200 — Universe History`

Purpose: long-term monthly membership history.

Append one row per selected ticker per published monthly universe run.

Required fields:

- Membership (title)
- Universe Run ID
- Universe Key
- Source As Of Date
- Effective From
- Effective To
- Active
- Rank
- Ticker
- Company
- Exchange (`HOSE`, `HNX`, `UPCOM`)
- Sector
- Market Cap Billion
- Avg Volume 50D
- Detail Complete
- Logo Kind
- Logo Path
- Min Market Cap Billion
- Min Avg Volume 50D
- Max Size
- Created At

Views:

- `Current 200`: Active = true, rank ascending.
- `By Run`: grouped by Universe Run ID.
- `Monthly History`: newest Source As Of Date first.

When a new universe is published, previous active rows are closed with `Effective To`; new membership is appended. No historical membership row is rewritten except closing its effective interval.

### 5.2 `Top Stocks 200 — EOD Archive YYYY`

Create one database per calendar year, e.g. `Top Stocks 200 — EOD Archive 2026`.

Purpose: compact analytical archive. One row per ticker per EOD session, not five rows per timeframe.

Required fields:

- Snapshot (title)
- Session Date
- Ticker
- Rank
- Universe Run ID
- Exchange
- Sector
- Price
- Qeo Composite
- Market Cap Billion
- Avg Volume 50D
- 1H Wyckoff Summary
- 4H Wyckoff Summary
- 1D Wyckoff Summary
- 1W Wyckoff Summary
- 1M Wyckoff Summary
- Daily Bias
- Confidence
- Support
- Resistance
- Bull Case
- Base Case
- Bear Case
- AI Council Signal
- AI Council Score
- AI Council Confidence
- AI Council Consensus
- AI Council Risk Status
- AI Council Summary
- LLM Debate Included
- LLM Conclusion
- What Changes Decision
- Evidence Hash
- Model Version
- Policy Version
- Prompt Version
- Archived At
- Raw Archive URL (Google Drive link when relevant)

JSON-heavy details stay in Supabase only for the hot retention window. Notion receives compact summaries, not raw OHLCV arrays or huge evidence payloads.

### 5.3 `Top Stocks 200 — EOD Runs`

One row per EOD workflow run.

Required fields:

- Run (title)
- Workflow Run ID
- System Job Run ID
- Session Date
- Universe Run ID
- Universe Count
- Expected Wyckoff Snapshots
- Completed Wyckoff Snapshots
- Incomplete Wyckoff Snapshots
- AI Council Expected
- AI Council Completed
- LLM Debate Count
- Market Close Attempts
- History Requested
- History Completed
- Archive Count
- Retention Deleted Rows
- Status
- Started At
- Completed At
- Duration Seconds
- Error Code
- Error Summary
- Validation Hash
- Model Version
- Policy Version
- Prompt Version

Views:

- Latest
- Errors / Partial
- Monthly

### 5.4 Automation contract page

Create a new Notion page:

`QeoIndex Automation & Cron Workflow — Top Stocks 200`

This is the canonical human-readable operations document after rollout. It mirrors the repository operations document and lists every active scheduler, exact schedule, owner, endpoint/function, universe dependency, retention policy, retry behavior and downstream outputs.

## 6. Supabase retention policy

Retention is based on operational need, not arbitrary age.

### 6.1 KFSP ratings

Full-market KFSP rows are expensive and do not need long retention in Supabase.

Policy:

- For tickers outside current canonical 200: keep latest successfully published full-market snapshot only.
- For current canonical 200: keep 45 calendar days of rating snapshots to support 7D/30D state changes and UI history.
- Before deleting an EOD canonical snapshot older than retention, verify its compact analytical archive exists in Notion for the corresponding session.
- Do not archive every full-market daily row to Notion.

### 6.2 OHLCV

Supabase keeps enough raw bars to run current technical models reliably.

Target working windows:

- 1H: approximately 90 calendar days, with a minimum completed-bar floor required by current Wyckoff model.
- 1D: approximately 320 completed trading bars for MA200 / 1Y context.
- 4H: derived from 1H, not stored as raw long-term history.
- 1W: compact derived history sufficient for at least 104 completed weeks.
- 1M: compact derived history sufficient for at least 72 completed months.

Before pruning raw 1D/1H bars older than the hot window, export them to Google Drive as compressed CSV or Parquet in deterministic partition paths.

Suggested archive layout:

`VN Stock Research/Market Archive/OHLCV/{timeframe}/{year}/{ticker}-{year}.{parquet|csv.gz}`

An archive manifest is recorded in Notion/Drive index with ticker, timeframe, date range, row count, checksum and Drive URL.

Never store raw bar arrays in Notion pages.

### 6.3 Universe runs

Supabase keeps:

- current published universe run;
- one previous successfully published run for rollback/diagnostics;
- any currently running/failed run needed for operational debugging for up to 30 days.

Long-term membership history is in `Top Stocks 200 — Universe History`.

### 6.4 Wyckoff

Supabase keeps current/fresh operational analysis plus approximately 10 trading sessions of versioned Wyckoff snapshots.

Long-term per-session summary is archived into yearly Notion EOD Archive.

Historical raw OHLCV needed to reproduce older runs is referenced through Google Drive archives.

### 6.5 AI Council

Supabase keeps:

- deterministic runs/votes/outcomes: approximately 30 trading sessions;
- LLM debates/evidence/research contexts: approximately 7-10 trading sessions;
- current calibration/agent stats required by runtime.

Notion EOD Archive stores compact long-term AI Council decisions and model/policy versions.

### 6.6 Orderbook and ephemeral projections

Keep current/latest operational rows only unless an explicit feature requires longer history.

### 6.7 Job telemetry

Keep detailed `system_job_runs` and phase telemetry approximately 30 days in Supabase.

Write one compact EOD run record to Notion for long-term operational audit.

### 6.8 TTAI quarterly history

Keep in Supabase while small and operationally useful. Current footprint is low relative to ratings/OHLCV.

## 7. EOD scheduler contract — MUST remain correct

### 7.1 Scheduler ownership

Canonical scheduler remains Supabase `pg_cron`.

Active EOD job:

- job name: `qeoindex-eod-pipeline-1515-ict`
- UTC cron: `15 8 * * 1-5`
- ICT: 15:15 Monday-Friday
- trigger: `qeo_trigger_eod_pipeline()` → authenticated `/api/qeoindex/eod`
- application runtime: durable Vercel Workflow `qeoindexEodPipeline`

There must not be separate active Wyckoff ingest / AI Council daily EOD point crons after cutover.

### 7.2 Reliability behavior retained

Keep these existing reliability contracts:

- `EOD_READY` retries readiness up to 4 attempts at 5-minute spacing for current-session runs.
- historical backfill uses explicit historical readiness logic and must never impersonate current-day data.
- `MARKET_CLOSE_COLLECT` has up to 3 attempts, 5 minutes apart, only for retryable provider/network/readiness failures.
- auth/secret failures fail immediately.
- history refresh stays bounded in batches of max 10 tickers.
- provider errors cannot be silently converted into valid/incomplete Wyckoff evidence.
- failed/partial runs cannot replace the latest healthy operational read model.

### 7.3 Canonical universe gate

At `EOD_READY`, resolve exactly one published `vn_top_stocks` run.

For the current configuration:

- expected current count is 200 because 207 candidates qualify and max size is 200.
- generic contract allows 1..200 if future thresholds produce fewer than 200.
- `expectedSnapshots = universeCount * 5`.
- all downstream ticker loops use the exact membership set from this run.
- no downstream function may query a Top100/HOSE-only universe or silently add/remove tickers.

EOD summary records the Universe Run ID and exact count used so later analysis is reproducible.

## 8. EOD v3 phase ordering

The new EOD v3 pipeline keeps the same scheduler and reliability semantics but removes Notion from the critical decision path.

Canonical phase order:

1. `EOD_READY`
2. `MARKET_CLOSE_COLLECT`
3. `HISTORY_REFRESH`
4. `NO_TRADE_REPAIR`
5. `WYCKOFF_BUILD`
6. `SUPABASE_VALIDATE`
7. `SUPABASE_PUBLISH`
8. `AI_COUNCIL_DETERMINISTIC`
9. `AI_COUNCIL_LLM`
10. `MARKET_SYNTHESIS`
11. `NOTION_ARCHIVE`
12. `DRIVE_ARCHIVE`
13. `RETENTION_CLEANUP`
14. `COMPLETE`

### 8.1 Critical-path boundary

Phases 1-10 form the market-analysis critical path.

Notion or Google Drive rate limits must not prevent AI Council from producing the current-session market conclusion.

Archive phases are durable/resume-safe. If archive fails:

- operational Supabase publish and AI Council result remain valid;
- run becomes `partial_archive` / equivalent explicit degraded status rather than pretending archive succeeded;
- cleanup MUST NOT delete unarchived data;
- archive retry can resume idempotently.

### 8.2 Supabase validation/publish

Before AI Council starts, verify:

- exact canonical universe membership count;
- one valid 5-timeframe Wyckoff snapshot set per ticker, or explicit genuine incomplete evidence according to model rules;
- no rejected/invalid snapshot is counted as complete;
- deterministic snapshot identity/version fields are present;
- current operational views resolve only the newly published healthy run.

### 8.3 AI Council deterministic

Deterministic Council operates on the exact canonical membership.

No `AI_COUNCIL_EXPECTED_STOCKS = 100` constant survives.

Readiness requires:

- `expectedStocks = currentUniverse.selectedCount`;
- requested tickers exactly equal current canonical ticker set;
- rating date is current EOD session;
- Wyckoff evidence belongs to the same session/published run;
- missing canonical ticker is a hard readiness failure, not silently skipped.

The deterministic Council may process all 200 tickers without invoking an LLM 200 times.

### 8.4 AI Council LLM

LLM debate remains a selected-candidate phase for cost/latency control.

Candidate selection must be drawn only from the exact current canonical universe and may use deterministic Council disagreement, high conviction, risk flags and configured curated tickers.

Configured watchlists must be intersected with current canonical membership.

The LLM max ticker setting remains an operational cost limit, not a universe limit.

### 8.5 Market synthesis

After deterministic + optional LLM phase, calculate market-level summary from all canonical 200 deterministic decisions:

- bullish / neutral / bearish breadth;
- confidence-weighted stance;
- sector breadth;
- high-risk count;
- accumulation/distribution state distribution;
- market regime;
- top opportunities and top risks;
- dissent between deterministic and LLM agents.

This is the market-level assessment consumed by the UI and archived to Notion.

## 9. Other scheduler contracts

Every active scheduled job is classified as either universe-aware or market/global.

### 9.1 `market-universe-monthly-0710-ict`

- schedule: 07:10 ICT on day 1 monthly.
- selects current canonical universe using configured thresholds.
- publishes atomically.
- after publish, mirrors membership into Notion Universe History.
- invalidates runtime universe cache only after successful publish.

### 9.2 `kfsp-rating-daily-7am-ict`

- schedule: 07:00 ICT daily.
- remains a broad-market data collector.
- it does NOT select membership.
- canonical 200 consumers join against current membership downstream.
- retention job prevents broad-market historical accumulation.

### 9.3 `kfsp-ttai-history-daily-0710-ict`

- schedule: 07:10 ICT daily.
- canonical-universe-aware where ticker selection is needed.
- must query `qeo_current_market_universe()` rather than Top100 flags.
- does not duplicate historical quarterly data unnecessarily.

### 9.4 Orderbook jobs

Current active jobs:

- `sync-universe-5m`
- `sync-universe-5m-afternoon`
- `sync-universe-eod-1445`

All operate on exact current canonical membership via `orderbook-sync`.

No static ticker list survives.

### 9.5 `signals.daily` Vercel cron

This is a separate signals/recommendation workflow and remains scheduled at 07:00 ICT Monday-Friday.

Its scan input membership must resolve canonical Top Stocks membership rather than Notion Top100.

Existing open recommendations may continue to be monitored after a ticker leaves the current universe so risk exits are not abandoned. New BUY candidate generation is restricted to current canonical membership.

### 9.6 Deprecated EOD point jobs

Old standalone jobs such as legacy Wyckoff ingest / AI Council daily point schedules remain disabled/absent from effective scheduler catalog.

## 10. Retention cleanup safety gates

Retention deletion is never time-only.

For analytical rows, deletion requires:

1. row is older than retention cutoff;
2. corresponding archive manifest/Notion EOD record is present when archive is required;
3. archive checksum/run identity matches expected session/ticker where applicable;
4. row is not part of current or rollback operational run;
5. no active job references it;
6. deletion count is preflighted and logged.

If Notion/Drive archive is unavailable, cleanup skips protected rows and records a warning. It never deletes first and hopes archive succeeds later.

Bulk cleanup executes in bounded chunks to avoid long locks.

## 11. Google Drive raw archive contract

Create a canonical archive root under the configured VN Stock Research Drive root.

Suggested structure:

- `Market Archive/OHLCV/1H/YYYY/`
- `Market Archive/OHLCV/1D/YYYY/`
- `Market Archive/Manifests/YYYY/`

Each archive partition contains:

- deterministic filename;
- ticker;
- timeframe;
- first/last bar timestamp;
- row count;
- SHA-256 checksum;
- exported-at timestamp;
- source provider summary;
- format/version.

Use Parquet where runtime support is practical; otherwise compressed CSV is acceptable. The manifest contract is more important than format.

## 12. Repository/runtime audit scope

Before merge, active runtime code must have zero semantic dependencies on:

- `AI_COUNCIL_EXPECTED_STOCKS = 100`
- `hose_top100`
- active `Top 100` UI/runtime labels
- exact `Universe Count = 100`
- exact `Snapshot Expected = 500`
- legacy static Top100 ticker arrays
- `is_top100` / `top100_rank`
- `top100:*` cache namespaces
- Notion Top100 universe as runtime membership source

Historical migrations/specs/logs may retain old terms as historical evidence.

Do not replace unrelated values of 100 such as API chunk sizes, percentile/score scales or bounded batch settings.

## 13. Admin control plane

Admin Jobs and settings must expose current semantics:

- `market.universe_size = 200` read-only max cap.
- `wyckoff.required_snapshots` is dynamic (`selectedCount * 5`) rather than fixed 500.
- AI Council readiness count is dynamic.
- manual scanner limit may remain an operational limit independent of canonical size, but labels must make that distinction explicit.
- AI Council LLM max tickers remains independent of universe size.

Admin Jobs must display EOD v3 phase timeline and active production scheduler state, not legacy point jobs.

## 14. Notion Hub cleanup procedure

Perform a full recursive audit of databases/pages under `VN Stock Research Hub`.

For every operational data source:

- identify whether it is current, legacy historical, or superseded;
- rename stale structures with `LEGACY —` or `DEPRECATED —`;
- update descriptions/callouts to point to v3 canonical databases;
- never rewrite historical records merely to make them look Top200-compliant;
- preserve old Top100 analyses as historical evidence.

The Hub landing page is updated so a new operator can distinguish current vs legacy databases without opening each one.

## 15. Migration / rollout order

1. Finish canonical-200 runtime code already in PR #132 and linearize all branch commits.
2. Create new Notion v3 databases/pages.
3. Add code configuration for new Notion data source IDs.
4. Migrate Wyckoff runner / scanner / signals / AI Council to exact canonical membership.
5. Implement EOD v3 publish-before-archive ordering.
6. Implement AI Council dynamic readiness and market synthesis.
7. Implement Drive archive writer + manifest.
8. Implement Notion archive writer.
9. Implement retention cleanup with archive gates.
10. Update Admin catalog/settings/job timeline.
11. Run static audit for all Top100 semantic remnants.
12. Run tests, lint, TypeScript and production build.
13. Deploy any changed Supabase Edge Functions before incompatible DB cleanup.
14. Merge once to `main`; use Git-triggered Vercel production deployment.
15. Verify production deployment READY.
16. Run fresh monthly universe publish if needed and verify 200 current members.
17. Run a full manual EOD workflow for a valid session/backfill-safe date.
18. Verify every EOD v3 phase, archive count and retention safety gate.
19. Verify current Supabase size and expected reduction.
20. Mark old Notion operational databases/contracts legacy/deprecated.
21. Publish final operations documentation.

## 16. Verification criteria

Release is not complete until all are true:

### Universe

- current canonical run published;
- 200 members under current selector;
- exact current ticker set used by Board, Bubbles, Insights, Scanner, Wyckoff, signals candidate generation and AI Council.

### Wyckoff

- run requested count = current canonical count;
- expected snapshots = count * 5;
- no Notion Top100 membership fallback;
- HNX/UPCOM supported.

### AI Council

- deterministic expected count = current canonical count;
- exact membership match;
- deterministic completion coverage verified;
- LLM candidates are a canonical subset;
- market synthesis is produced from all deterministic decisions.

### EOD scheduler

- pg_cron job active at `15 8 * * 1-5` UTC;
- scheduler triggers durable workflow;
- readiness retry behavior preserved;
- market-close retry behavior preserved;
- batch bounds preserved;
- no active legacy EOD point crons;
- full test/manual run succeeds through COMPLETE or reports explicit archive partial state without corrupting operational publish.

### Archive

- Universe History receives monthly rows;
- yearly EOD Archive receives one row per canonical ticker/session;
- EOD Runs receives one summary row;
- Drive archive manifest verifies checksum/row counts;
- cleanup never removes a required row without archive proof.

### Supabase capacity

- retention removes stale broad-market rating snapshots;
- OHLCV hot windows are bounded;
- operational current/rollback data retained;
- database footprint is measured before/after and documented.

## 17. Final documentation deliverables

After rollout create and provide:

1. repository document: `docs/operations/top-stocks-200-cron-workflow.md`
2. Notion page: `QeoIndex Automation & Cron Workflow — Top Stocks 200`

Both documents contain:

- every active cron/workflow/function;
- owner/scheduler;
- UTC + ICT schedule;
- trigger endpoint/function;
- canonical-universe dependency;
- phase sequence;
- retries/timeouts;
- data written/read;
- retention/archive behavior;
- failure semantics;
- manual-run procedure;
- verification checklist.

The repository document is the code-adjacent operational contract. The Notion page is the long-term human operations reference.
