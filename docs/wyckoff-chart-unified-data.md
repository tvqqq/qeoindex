# Wyckoff chart and unified data plan

Last updated: 2026-08-23.

## Shipped MVP contract

- Route: `/insights/wyckoff?ticker=FPT&timeframe=1D`.
- Supported timeframe values: `1H`, `4H`, `1D`, `1W`, `1M`.
- The right rail uses the canonical Notion Top 100 universe and latest Daily Wyckoff Scan.
- The selected chart reads completed 1H and long-window 1D OHLCV from the existing bounded DNSE → Yahoo fallback path. `4H`, `1W`, and `1M` are deterministic aggregates.
- The Daily chart is aligned to the canonical Daily scan date so chart bars and stored indicators do not mix timestamps.
- Projection paths are deterministic scenarios derived from the current phase, ATR, support/resistance, and stored probabilities. They are not future prices.

Supabase unified storage is now the primary published read model. The page falls back to Notion/provider reads only while a ticker has not yet been backfilled or if the unified read is unavailable.

## Current split and why it cannot be the final model

| Concern | Current source | Limitation |
| --- | --- | --- |
| Top 100 membership and rank | Notion Wyckoff Universe | Good human-editable catalog, but no relational uniqueness or transactional publish. |
| Latest Daily scan | Notion Daily Wyckoff Scan | Daily-only projection; no unique `(ticker, timeframe, bar close, model)` key. |
| 1H/1D OHLCV | DNSE with Yahoo fallback | Correct provider boundary, but results are not persisted with the analysis snapshot. |
| MTF analysis | Runtime TypeScript rule-engine | Recomputed per page; no durable historical audit for 1H/4H/1W/1M. |
| Canonical thesis and review log | Notion | Must remain the human-reviewed research layer; it should not be overwritten by an automated scan. |

## Target Supabase model

Use append-only facts and publish a latest read view. Avoid one wide mutable “current stock” row.

### Implemented production tables

- `id uuid primary key`
- `ticker text not null`
- `exchange text not null`
- `company_name text`
- `sector text`
- unique `(exchange, ticker)`

### `wyckoff_universe_memberships`

- `instrument_id uuid references market_instruments`
- `universe_key text` (`hose_top100`)
- `effective_from date`
- `effective_to date null`
- `rank smallint`
- `market_cap_billion numeric`
- `source text` (`notion` during compatibility phase)
- unique `(universe_key, instrument_id, effective_from)`

Notion remains canonical until cutover. Sync its exact 100 active rows into this table and reject publish unless count, uniqueness, rank range, and ticker membership all pass.

Raw source bars are intentionally not retained indefinitely in the first production version. `wyckoff_chart_series` stores a bounded latest 260-bar read model per ticker/timeframe, keeping free-tier storage predictable while immutable analyses remain auditable.

### `wyckoff_chart_series`

- `instrument_id uuid`
- `timeframe text check in ('1H','1D')`
- `bar_open_at timestamptz`
- `bar_closed_at timestamptz`
- `open/high/low/close numeric`
- `volume bigint`
- `provider text`
- `provider_payload_hash text`
- `is_complete boolean not null`
- primary key `(instrument_id, timeframe, bar_open_at, provider)`

Persist source bars only. Derive `4H`, `1W`, and `1M` with the same versioned aggregation code used by the scanner. Never mix an incomplete live bar into a completed-bar analysis.

### `wyckoff_scan_runs`

- `id uuid primary key`
- `requested_at`, `started_at`, `finished_at`
- `universe_key`, `universe_effective_from`
- `model_version`, `aggregation_version`
- `status` (`running`, `published`, `partial`, `failed`)
- `requested_count`, `completed_count`, `incomplete_count`, `error_count`
- `source` and bounded diagnostics JSON

### `wyckoff_analysis_snapshots`

- `id uuid primary key`
- `run_id uuid references wyckoff_scan_runs`
- `instrument_id uuid references market_instruments`
- `timeframe text check in ('1H','4H','1D','1W','1M')`
- `bar_closed_at timestamptz`
- `model_version text`
- `aggregation_version text`
- `history_bar_count integer`
- `history_status` (`complete`, `incomplete`, `rejected`)
- `phase_family` (`accumulation`, `distribution`, `markup`, `markdown`, `range`)
- `phase_code` (`A`–`E` or null)
- `event_code` (`SPRING`, `UTAD`, `SOS`, `SOW`, `TEST`, `LPS`, `LPSY`, or null)
- `is_candidate boolean`
- `bias`, `confidence`
- `bull_probability`, `base_probability`, `bear_probability` with a sum-to-100 check
- numeric `support_levels` and `resistance_levels`
- `confirmation`, `invalidation`, `what_changed`
- `technical jsonb` for versioned metrics
- `evidence jsonb` containing exact bar range, provider, payload hash, and triggered rules
- `scenario_paths jsonb` containing Bull/Base/Bear points and assumptions
- `published_at timestamptz`
- unique `(instrument_id, timeframe, bar_closed_at, model_version, aggregation_version)`

All prose is interpretation. Numeric levels, triggered rules, source timestamps, and model versions are evidence and must remain queryable separately.

### `wyckoff_event_markers`

- `analysis_snapshot_id uuid references wyckoff_analysis_snapshots`
- `event_at timestamptz`
- `event_code`, `price`, `tone`, `evidence jsonb`
- unique `(analysis_snapshot_id, event_at, event_code)`

### Published views

- `wyckoff_latest_by_timeframe`: latest published row per `(instrument_id, timeframe)`.
- `wyckoff_top100_latest`: exact current Top 100 membership joined to the five latest timeframe rows.
- `wyckoff_chart_payload`: instrument metadata, bounded completed bars, five analyses, event markers, and scenarios for one ticker.

The page should eventually read one server-side RPC/view payload rather than independently joining browser data.

## Publish and validation rules

1. Fetch the exact canonical universe and freeze its effective version for the run.
2. Fetch completed source bars with bounded concurrency and provider provenance.
3. Aggregate `4H/1W/1M` deterministically; store aggregation version.
4. Run the same model version for all five timeframes.
5. Stage all 100 × 5 results under one `run_id`.
6. Reject a published run if universe count is not 100, any ticker is duplicated, probabilities do not sum to 100, bar timestamps are incomplete, or provider payloads contain zero/invalid OHLC.
7. Publish atomically. A partial run remains auditable but never replaces the latest complete view.
8. Keep Notion Stock Thesis and Analysis Log as the human-reviewed layer. Automation may create candidates; only explicit review promotes a canonical thesis.

## Security and retention

- Authenticated users receive read-only published views through RLS.
- Only service-role or a narrow machine function can stage/publish scans.
- Provider credentials and scanner bearer secrets stay server-side.
- Retain analysis snapshots indefinitely for backtesting; retain raw intraday bars according to an explicit cost policy.
- Store bounded diagnostic text, never raw secrets or full upstream error bodies.

## Migration and compatibility phases

1. Create schema/RLS/views and backfill the exact Top 100 from Notion into Supabase.
2. `/api/wyckoff/run` publishes all five timeframes and bounded chart series; `/insights/wyckoff` reads Supabase first.
3. Keep Notion as the editable universe and human-review layer during compatibility; the old Daily scanner remains available until operational acceptance.
4. Stop using Notion as the operational scan database only after explicit acceptance and several successful scheduled runs.
5. Add backtest/review metrics before treating scenario probabilities as calibrated probabilities.

## Methodology notes

- Wyckoff phases describe evidence and conditional paths, not deterministic forecasts.
- Spring/UTAD are not mandatory events in every range.
- Phase D requires confirmation behavior such as hold/test/follow-through; a breakout candle alone is not enough.
- Lightweight Charts v5 series markers are a separate primitive. Projection paths are line series; complex future zones can later move to a custom series primitive.

References: [TradingView Lightweight Charts 5.2 API](https://tradingview.github.io/lightweight-charts/docs/api), [series primitives](https://tradingview.github.io/lightweight-charts/docs/plugins/series-primitives), and [StockCharts Wyckoff tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial).
