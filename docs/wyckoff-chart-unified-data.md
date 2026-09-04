# Wyckoff operational data contract

Last updated: 2026-09-04.

This document describes the current Supabase-first Wyckoff storage/read contract. `HANDOVER.md` is the repo-wide architecture authority; historical five-timeframe/Notion-universe designs in Git or `docs/superpowers/` are not active runtime contracts.

## Active product contract

- Canonical universe: latest published `vn_top_stocks`, maximum 200 tickers.
- Operational analysis timeframes: exactly `1D` and `1W`, using completed bars only.
- Persistent raw OHLCV: `1D` only in `market_ohlcv_history`.
- Weekly bars: deterministic aggregation from canonical Daily history.
- Expected healthy EOD snapshot count: `universeCount × 2`.
- Supabase is the operational read/write store for the EOD/Wyckoff graph.

`1H`, `4H`, and `1M` are retired from the active Wyckoff persistence contract. Do not re-add them to active snapshots, UI timeframe tabs, watchlist columns, expected-count logic, or persistent raw-history requirements without a new approved architecture change.

## Universe identity

Count equality is not sufficient. A run freezes the exact published universe identity/membership and downstream phases verify the same ticker set. No runtime path may fall back to a hard-coded Top 100 or a legacy Notion universe and still call the result canonical.

## Raw history lifecycle

`market_ohlcv_history` stores completed `1D` bars. A normal ticker uses the bounded bootstrap path, then moves to Daily delta refresh. `market_ohlcv_bootstrap_state` prevents genuinely short-history/new-listing tickers from repeating an expensive full-history bootstrap every EOD once a valid bootstrap has completed.

Retry splitting is for transient network/timeout/408/425/429/5xx failures only; explicit auth/permission/non-transient 4xx failures must fail rather than recursively fan out.

Canonical Daily history is not age-pruned merely to reduce storage while Weekly remains derived from Daily and no independently verified cold-history restore path exists.

## EOD build/publish path

Relevant v4 phases are:

```text
KFSP_RATING_REFRESH
  -> TTAI_REFRESH + MARKET_CLOSE_COLLECT
  -> EOD_READY
  -> HISTORY_REFRESH
  -> verified no-trade repair when required
  -> WYCKOFF_BUILD
  -> SUPABASE_VALIDATE
  -> SUPABASE_PUBLISH
  -> downstream Council/synthesis/retention/summary
```

Key invariants:

1. `EOD_READY` verifies exact frozen membership and same-session prerequisites.
2. `HISTORY_REFRESH` accounts for every requested ticker and writes Daily only.
3. `WYCKOFF_BUILD` produces two operational snapshots per healthy canonical ticker: `1D` + `1W`.
4. Allowed ticker isolation must be explicit in phase telemetry; missing work cannot be hidden as success.
5. `SUPABASE_VALIDATE` and `SUPABASE_PUBLISH` must agree on validation hash and exact ticker set before the read model is considered published.
6. Historical backfills use persistent historical evidence and never substitute today's provider market data for a past session.

## Evidence and interpretation

Keep machine evidence queryable separately from analytical prose. At minimum preserve the run/session identity, ticker/timeframe, completed-bar cutoff, model/build version, provider/provenance where applicable, validation state, scenario probabilities and structural levels needed by downstream consumers.

Wyckoff labels are analytical outputs, not certainty. A breakout/event candidate still requires the engine's configured evidence/confirmation logic; storage must not imply that a phase/event label is a verified future outcome.

## Read-model/UI rules

- UI reads published Supabase operational data; it must not join a legacy operational Notion universe into an otherwise Supabase result.
- `1W` is derived from canonical Daily data with the versioned aggregation logic used by the build path.
- Incomplete/unavailable evidence renders explicitly; do not synthesize missing bars/timeframes.
- If a chart exposes a projection/scenario, present it as a conditional analytical path rather than future price truth.
- Any selected ticker must belong to the intended current dataset; “canonical” means exact current published universe membership.

## Notion and historical documents

Notion is not the active operational scan database or per-ticker EOD archive in v4. The EOD graph may emit a compact downstream analytical/audit summary after operational publication; that downstream write cannot become readiness/publish authority.

Older documents may describe:

- `hose_top100` / exact 100-row publish;
- 1H/4H/1D/1W/1M scanner persistence;
- bounded `wyckoff_chart_series` as the primary raw store;
- Notion as operational universe/scan persistence;
- Google Drive archive/ledger authority.

Those are historical designs. Do not revive them by copying old plan text into active code/docs.

## Verification

For changes touching the active Wyckoff contract, run the repository PR gate plus relevant Wyckoff/EOD tests and build:

```bash
pnpm verify:pr
pnpm test:eod
pnpm test:wyckoff-ui
pnpm build
```

Database changes additionally require the DB verification gates from `HANDOVER.md` (`db:drift:verify`, `db:replay:verify`, `db:types:verify`, plus destructive recovery rehearsal when applicable).

Operational acceptance verifies:

- exact current universe identity;
- Daily-only persistent raw history;
- `universeCount × 2` published Wyckoff snapshots;
- explicit ticker failure accounting;
- matching validation/publish evidence;
- real downstream phase status rather than inferred success from scheduler dispatch.
