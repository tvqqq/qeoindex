# Market Board Filter Avg50 + Sector Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Filter CP liquidity to canonical 50-session average volume and render/enforce KFSP sector selection through the same six group columns as the market board.

**Architecture:** Keep the filter pure and local. Add `averageVolume50d` to the existing client universe shape, update `filterBoardTickers` to use that value, and reuse `BOARD_SECTOR_GROUPS` + `boardSectorGroupForSector` for both validation and modal layout. Do not alter websocket/reconcile architecture.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.7, Node test runner, existing canonical universe and market-sector helpers.

**Spec:** `docs/superpowers/specs/2026-09-03-market-board-filter-avg50-sector-columns-design.md`

## Global Constraints

- Liquidity predicate uses `CanonicalUniverseStock.averageVolume50d`, never current-session quote volume.
- Price predicate keeps current quote with `lastClose` fallback.
- Sector UI has exactly six columns in `BOARD_SECTOR_GROUPS` order.
- Bank/securities column sectors are mandatory and cannot be unchecked.
- Every non-empty board sector column must retain at least one selected raw KFSP sector.
- Existing `minVolumeShares` persistence key remains backward compatible but now means minimum average 50-session volume.
- No new DB/provider query and no websocket lifecycle change.

---

### Task 1: Update pure filter semantics and invariants

**Files:**
- Modify: `modules/market/board/stock-filter.ts`
- Modify/Test: `tests/market-board-visual-contract.test.ts`

**Interfaces:**
- `FilterableBoardStock` gains `averageVolume50d?: number | null`.
- Add `groupFilterSectorsByBoardColumn(availableSectors)` returning six ordered groups with mapped raw sectors.
- Add `isLockedFilterSector(sector)` for bank/securities groups.
- Add `canUnselectFilterSector(selected, sector, availableSectors)` to preserve at least one selected sector per non-empty group.

- [ ] **Step 1: Write failing tests** asserting a stock passes/fails liquidity based on `averageVolume50d` even when quote volume says the opposite; six ordered groups are produced; bank/securities are locked; and removing the last selected sector in any group is rejected.
- [ ] **Step 2: Run `node --test tests/market-board-visual-contract.test.ts` and confirm RED.**
- [ ] **Step 3: Implement the minimal helpers and switch liquidity predicate from `quotes[ticker].volume` to `stock.averageVolume50d`.**
- [ ] **Step 4: Extend normalization so all locked-group sectors must be selected and each non-empty board group has at least one selected sector; otherwise return `null`.**
- [ ] **Step 5: Re-run the focused test and confirm GREEN.**
- [ ] **Step 6: Commit `test/feat: use avg50 liquidity and sector group invariants`.**

---

### Task 2: Wire canonical average volume and rebuild modal layout

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/market-board/stock-filter-modal.tsx`
- Modify/Test: `tests/market-board-stock-filter-ui.test.ts`

**Interfaces:**
- `app/page.tsx` maps `averageVolume50d: stock.averageVolume50d` into each `FilterBoardUniverseStock`.
- Modal consumes Task 1 grouping/locking helpers.

- [ ] **Step 1: Write failing UI/source contract tests** for `averageVolume50d`, `KLTB 50 phiên`, six-column grid, group headings, disabled mandatory sectors, and last-selection guard.
- [ ] **Step 2: Run `node --test tests/market-board-stock-filter-ui.test.ts` and confirm RED.**
- [ ] **Step 3: Add `averageVolume50d` to page universe mapping.**
- [ ] **Step 4: Replace the flat/two-column KFSP list with `lg:grid-cols-6`, one panel per `BOARD_SECTOR_GROUPS` group, rendering only mapped raw sectors.**
- [ ] **Step 5: Disable bank/securities checkboxes and make `toggleSector` no-op when Task 1 says removal would violate a locked/min-one invariant.**
- [ ] **Step 6: Rename liquidity copy to `KLTB 50 phiên >`, update description/loading copy so it no longer claims current-session liquidity is fetched.**
- [ ] **Step 7: Re-run UI test and focused board test; confirm GREEN.**
- [ ] **Step 8: Commit `feat: align Filter CP sectors with board columns`.**

---

### Task 3: Documentation and release verification

**Files:**
- Modify: `docs/market-board.md`
- Test: existing Verify workflow

**Interfaces:** none.

- [ ] **Step 1: Update docs** to state liquidity is canonical KLTB 50 sessions and document six-column/mandatory-sector invariants.
- [ ] **Step 2: Run focused tests:** `node --test tests/market-board-visual-contract.test.ts tests/market-board-stock-filter-ui.test.ts tests/market-board-stock-filter-api.test.ts`.
- [ ] **Step 3: Run touched lint and TypeScript.**
- [ ] **Step 4: Run production build.**
- [ ] **Step 5: Review diff for N+1/realtime regressions; confirm no new data fetch and no websocket change.**
- [ ] **Step 6: Open PR against `main` and use GitHub Verify as the final release gate.**
