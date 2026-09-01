# QeoIndex Wyckoff → Notion staging — canonical Top Stocks contract

> **Status: legacy ChatGPT Work scanner retired.**
>
> Do not run the former external task that queried the historical Notion Universe database. The QeoIndex EOD workflow now owns universe selection, OHLCV refresh, Wyckoff build, Notion staging, validation, Supabase publish and downstream AI Council sequencing.

## Source of truth

- Canonical membership: Supabase `qeo_current_market_universe()`.
- Universe Key: `vn_top_stocks`.
- Maximum Universe Count = 200.
- Membership may include HOSE, HNX and UPCOM.
- Notion is staging/audit only; it is never a runtime membership source.
- The historical Notion Universe data source is retained only for parser compatibility and audit history.

## Active Notion staging data sources

- Runs: `collection://4efe8131-196a-4b4e-8a9c-dea48c51a554`
- Snapshots: `collection://f9d84b24-965a-4008-a339-5a62db409ecf`
- Contract page: `https://app.notion.com/p/3c52172825508193a861e662379530db`

`Wyckoff Unified Snapshots.Exchange` must support `HOSE`, `HNX`, and `UPCOM`.

## Current EOD contract

The authenticated QeoIndex EOD workflow:

1. Reads the current published canonical Supabase universe and freezes that membership for the run.
2. Uses bounded batches of at most 10 tickers for history refresh and staging writes.
3. Builds five completed-bar timeframes per ticker: `1H`, `4H`, `1D`, `1W`, `1M`.
4. Creates/updates the Notion Run manifest with `Universe Key = vn_top_stocks` and the actual current universe count.
5. Stages exactly `universeCount × 5` snapshot keys.
6. Validates the deterministic snapshot set and SHA-256 validation hash.
7. Claims the Ready run, publishes the validated facts to Supabase, then runs deterministic AI Council and the optional LLM debate.

For a full 200-stock universe:

```text
Universe Count = 200
Snapshot Expected = 1000
```

If fewer than 200 stocks qualify for the monthly canonical selector, use the actual published `selectedCount`; never pad membership and never reconstruct a separate Notion universe.

## Manual recovery

Use the authorized QeoIndex EOD/admin job path. Do not create a parallel ChatGPT scanner or write a separate universe into Notion. A recovery run must still read the current canonical Supabase membership first and preserve the same `vn_top_stocks` contract.

## Historical records

Old Runs/Snapshots from the previous 100-stock era remain historical evidence. Do not reinterpret or rewrite their original universe metadata. New operational runs must use `vn_top_stocks` and dynamic `universeCount × 5` expectations.
