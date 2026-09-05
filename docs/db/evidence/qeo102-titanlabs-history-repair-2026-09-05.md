# QEO-102 TitanLabs historical Daily repair — 2026-09-05

## Policy

- Completed Daily provider order remains: `VCI -> DNSE -> Yahoo/Fallback -> VNDirect -> TitanLabs`.
- TitanLabs is a Daily historical last-resort only.
- TitanLabs is not used for realtime/current-session candles and is not an EOD v4 dependency.
- From the 2026-09-07 session onward, EOD v4 remains the authority for newly completed Daily bars.

## Production migration

- Project: `glwhhrmejlonhyorvtzm`
- Migration: `20260905131125_qeo102_titanlabs_history_fallback_precedence`
- Valid lower-priority historical evidence may replace a provably invalid stored Daily row.
- Invalid incoming evidence can never replace a valid stored Daily row.
- TitanLabs ranks below VNDirect and therefore cannot overwrite a valid higher-priority Daily row.

## Historical repair acceptance

Fresh production audit after bounded repair:

- TitanLabs repaired rows: **97**
- Distinct repaired tickers: **92**
- Repair session range: **2021-11-02 02:00 UTC -> 2025-06-05 02:00 UTC**
- Invalid TitanLabs rows remaining: **0**
- Invalid Daily rows across `market_ohlcv_history`: **0**
- Canonical universe: **200**
- Canonical completed session `2026-09-04 02:00 UTC`: **200/200**
- Daily rows dated on or after `2026-09-07`: **0** at acceptance time, so the historical repair did not touch the future EOD v4 authority boundary.

## Provider evidence

- VIC TitanLabs probe returned 2,908 Daily bars from 2015-01-05 through 2026-09-04.
- VIC 2021-11-02 normalized to O/H/L/C `47.85 / 48.00 / 47.45 / 47.90`, volume `1,647,800`, matching the verified VCI/Finhay bar used to activate the bounded fallback.
- A 20-ticker coverage probe returned HTTP 200 / `s=ok` for all sampled tickers, with history through 2026-09-04.

## Repair execution rule

Each batch was dry-run before write. A row was repaired only when:

1. the stored Daily row was provably invalid;
2. TitanLabs contained the same ticker and exact Vietnam trading session;
3. TitanLabs OHLCV passed positive/range/volume validation; and
4. the DB precedence trigger allowed the valid repair.

No valid Daily row was bulk-replaced.
