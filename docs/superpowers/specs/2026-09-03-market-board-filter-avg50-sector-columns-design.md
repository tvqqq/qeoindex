# Market Board Filter Avg50 + Sector Columns Design

Date: 2026-09-03
Status: User-approved amendment
Branch: `fix/market-board-filter-avg50-sector-columns`

## Goal

Refine `Filter CP` so liquidity is based on canonical 50-session average volume and KFSP sector selection mirrors the six market-board columns.

## Required behavior

1. `Thanh khoản` means **KLTB 50 phiên** (shares/session), sourced from `CanonicalUniverseStock.averageVolume50d`.
2. Current-session `LiveStockQuote.volume` must not participate in the liquidity predicate.
3. Preserve current-price filtering from the latest quote with `lastClose` fallback.
4. Render sector controls in exactly six columns matching `BOARD_SECTOR_GROUPS` order and labels.
5. Each raw KFSP sector is placed in the column returned by `boardSectorGroupForSector(rawSector)`.
6. The `Ngân hàng` and `Chứng khoán` board columns are locked selected: their sector checkboxes cannot be unchecked.
7. Every non-empty board column must retain at least one selected raw sector. The UI must prevent removing the last selected sector in a column.
8. Default criteria still select all available sectors, while bank/securities remain visibly locked.
9. Existing persisted criteria that violate the new per-column invariant are treated as invalid and fall back to defaults when loaded.
10. Filter evaluation remains local O(N) over the canonical Top 200 universe and adds no database/provider queries.
11. Existing daily ticker-cache identity remains user + Vietnam day + universe run + filter hash; changing normalized sector selection or liquidity threshold changes the hash.
12. Existing filtered DNSE WebSocket scoping and full-board quote reconciliation remain unchanged.

## Data model adjustment

Extend the client filterable stock shape with:

```ts
averageVolume50d: number
```

The existing persisted `minVolumeShares` key remains for backward compatibility, but its product meaning becomes `minAverageVolume50dShares`. Code comments/UI/docs must state the new semantics explicitly.

## UI

The liquidity field label becomes `KLTB 50 phiên >` with unit `cp`.

The sector area uses a six-column grid at desktop width. Each column has the same heading as the corresponding board column (`Ngân hàng`, `Chứng khoán`, `Bán lẻ`, `Bất động sản`, `Công nghiệp`, `Còn lại`) and contains only mapped raw KFSP sectors.

Locked bank/securities rows use disabled checkboxes and a compact `Bắt buộc` indicator. For the other four columns, the last remaining checked item cannot be unchecked.

## Acceptance

- A stock with current-session volume below the threshold can still pass when `averageVolume50d` exceeds the threshold.
- A stock with current-session volume above the threshold fails when `averageVolume50d` is below the threshold.
- All six sector columns render in board order.
- Bank and securities selections cannot be removed.
- No column can reach zero selected sectors.
- TypeScript, touched lint, core regression, market-board filter tests, and production build pass.
