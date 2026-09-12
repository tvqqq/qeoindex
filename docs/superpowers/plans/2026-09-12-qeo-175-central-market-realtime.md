# QEO-175 Central Market Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize the canonical Market Board DNSE feed behind one Laravel worker and fan out bounded 1 Hz batches through Supabase Realtime.

**Architecture:** A stateless Railway Laravel command owns DNSE connections, coalesces latest tick/index frames, and upserts one bounded bus row. The browser subscribes through the existing Supabase client and keeps the existing quote/history reducers. Detailed popup orderbook remains explicitly out of this phase.

**Tech Stack:** Laravel 12, Ratchet Pawl/ReactPHP, Supabase Postgres + Realtime, Next.js 16/React 19, Railway Nixpacks.

**Spec:** `docs/superpowers/specs/2026-09-12-qeo-175-central-market-realtime-design.md`

## Global Constraints

- Maximum stock membership per canonical DNSE socket: 200.
- Default Postgres publish cadence: 1000 ms; clamp 250–5000 ms.
- Realtime JSON payload database cap: 524288 bytes.
- Railway worker is stateless and has no volume dependency.
- Preserve Market Board 250 ms UI commit and 1 s ordering cadence.
- Do not centralize popup orderbook in this phase.

---

### Task 1: Lock acceptance contracts

**Files:**
- Modify: `tests/dnse-request-windows.test.ts`

- [x] Add failing source contracts for the bus migration, Supabase client transport, Laravel worker, and stateless Railway config.
- [x] Open a draft PR so CI records the RED state before implementation.

### Task 2: Add bounded Supabase realtime bus

**Files:**
- Create: `supabase/migrations/20260912074500_qeo175_market_realtime_bus.sql`

- [x] Create the one-row-per-stream table with authenticated-read/service-write RLS.
- [x] Add the table to `supabase_realtime` idempotently and cap frame JSON at 512 KiB.

### Task 3: Add Laravel DNSE ingestion worker

**Files:**
- Create: `services/market-realtime-worker/**`

- [x] Fetch the canonical Top 200 from `qeo_current_market_universe` using service role.
- [x] Authenticate DNSE with the same HMAC contract as the Next.js backend.
- [x] Run stock-tick and market-index sockets with reconnect/ping behavior.
- [x] Coalesce latest frames and publish a monotonic batch every 1 second.
- [x] Refresh canonical membership every five minutes.

### Task 4: Cut Market Board over to Supabase Realtime

**Files:**
- Modify: `modules/market/providers/dnse/market-stream.ts`
- Modify: `components/live-market-board.tsx`

- [x] Build singleton Supabase `postgres_changes` transport with initial-row bootstrap and sequence dedupe.
- [x] Preserve tick-to-OHLC compatibility frames.
- [ ] Replace the Market Board's direct DNSE auth/socket effect with frame/state subscriptions.
- [ ] Preserve existing reducers, session filtering and UI cadence.

### Task 5: Verify and ship safely

- [ ] Run focused QEO-175/board tests and `pnpm verify:pr` in CI.
- [ ] Apply the Supabase migration to project `qeoindex` and verify publication/RLS.
- [ ] Deploy Railway worker with the required secrets after Railway is connected.
- [ ] Smoke test one browser and confirm no canonical Market Board DNSE provider socket remains.
- [ ] Mark PR ready and move QEO-175 to In Review only when evidence is green.
