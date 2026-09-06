# QEO-132 Raw Daily Basis Implementation Plan

> **Execution rule:** implement this plan with strict TDD. Do not wire a provider into EOD or bulk production ingestion unless its raw semantics and operational/legal suitability are explicitly approved.

**Goal:** add a separate append-only raw Daily evidence boundary plus one-row-per-session canonical raw selection, prove it with VHM StockBiz fixtures, and leave legacy adjusted history/consumers untouched.

**Architecture:** `market_ohlcv_raw_daily_evidence` stores immutable RAW provider observations; `market_ohlcv_raw_daily` selects one exact evidence row per ticker/session. A service-only atomic persistence RPC enforces explicit RAW semantics. A bounded StockBiz parser/fetcher proves raw anchors but is not an automatic EOD provider. QEO-129 later consumes the canonical raw loader.

**Tech stack:** TypeScript/Node test runner, Supabase/Postgres migrations + RLS/RPC, existing GitHub Actions Verify/DB Drift, server-only provider adapters.

---

## Task 1 — Lock raw-domain and StockBiz parser contracts (RED)

**Files:**
- Create: `tests/market-history/qeo132-stockbiz-raw-daily.test.ts`
- Create: `modules/market/providers/stockbiz/raw-daily.ts` only after RED is observed
- Modify: `tests/test-contracts.json`

**Step 1: Write failing tests**

Pin these contracts:

1. StockBiz parser returns raw OHLCV, session date, adjusted close audit value, and `priceBasis: "RAW"` from a frozen table fixture.
2. 2025-10-13..17 VHM raw fixture yields H/L `131.5 / 114.6`.
3. 2026-06-26 raw close is `162.0` while adjusted close is `78.0`.
4. 2026-08-05 raw close is `153.0` while adjusted close is `76.5`.
5. Parser never substitutes adjusted close for raw close.
6. Misaligned/missing semantic columns, invalid OHLC, invalid volume, duplicate ambiguous session rows, and malformed dates fail closed.
7. URL builder accepts only bounded ticker/date input.

**Step 2: Register the test contract**

Add the new test to `tests/test-contracts.json`, owner `market`, bucket `canonical`, suite `fast`.

**Step 3: Run RED**

Execute:

`node --test tests/market-history/qeo132-stockbiz-raw-daily.test.ts`

Expected: FAIL because the StockBiz raw adapter does not exist yet. Capture exact failing workflow/commit evidence.

**Step 4: Commit RED tests only**

Commit message: `test(QEO-132): pin raw Daily StockBiz contracts`

---

## Task 2 — Implement bounded StockBiz raw parser (GREEN)

**Files:**
- Create: `modules/market/providers/stockbiz/raw-daily.ts`
- Test: `tests/market-history/qeo132-stockbiz-raw-daily.test.ts`

**Step 1: Implement minimal parser/domain types**

Add:

- explicit `RawDailyPriceBasis = "RAW"`
- StockBiz parsed row with raw OHLCV + optional adjusted close audit value
- semantic table header mapping rather than positional guesswork where possible
- deterministic `dd/mm/yyyy -> YYYY-MM-DD`
- strict numeric/OHLC/volume validation
- duplicate-session ambiguity rejection
- bounded URL builder and fetch function with timeout/User-Agent/request cap
- server-only boundary for live fetch path

Do not add EOD wiring or canonical-200 refresh.

**Step 2: Run targeted GREEN**

`node --test tests/market-history/qeo132-stockbiz-raw-daily.test.ts`

Expected: PASS.

**Step 3: Run fast suite + typecheck**

`pnpm test:fast`

`pnpm typecheck`

Expected: PASS.

**Step 4: Commit**

Commit message: `feat(QEO-132): add bounded StockBiz raw Daily parser`

---

## Task 3 — Pin database raw evidence/canonical contracts (RED)

**Files:**
- Create: `tests/db/qeo132-raw-daily-schema.test.ts`
- Create: `tests/db/qeo132-raw-daily-persistence.sql`
- Modify: `tests/test-contracts.json`
- Create later: `supabase/migrations/20260906169000_qeo132_raw_daily_basis.sql`

**Step 1: Write schema contract test**

Require migration `20260906169000_qeo132_raw_daily_basis.sql` to define:

- `market_ohlcv_raw_daily_evidence`
- `market_ohlcv_raw_daily`
- evidence FK from canonical row
- explicit RAW-only check
- ticker/session/OHLC/volume checks
- SHA-256 evidence hash check
- RLS enabled
- public/anon/authenticated direct writes revoked
- service-role persistence RPC
- no SQL update/delete path exposed for evidence
- no alteration/update of `market_ohlcv_history`

Register as owner `db`, bucket `deep-safety`, suite `db`.

**Step 2: Write SQL persistence rehearsal**

Test transactionally:

1. exact evidence insert + canonical selection succeeds;
2. exact replay is idempotent;
3. same ticker/session with changed evidence hash creates a second evidence row while canonical selection moves only when explicitly selected;
4. prior evidence remains unchanged;
5. non-RAW basis fails atomically;
6. invalid OHLC/volume/hash/provenance fails atomically;
7. canonical row exactly references selected evidence and mirrors raw OHLCV/hash;
8. authenticated role cannot mutate/read private evidence unless explicitly intended by schema; service role can execute RPC;
9. rollback leaves no fixture rows.

**Step 3: Run RED**

Run schema contract target through Node and DB rehearsal through local Supabase workflow.

Expected: FAIL because migration/tables/RPC do not exist.

**Step 4: Commit RED tests only**

Commit message: `test(QEO-132): pin raw Daily persistence contracts`

---

## Task 4 — Implement raw evidence + canonical schema (GREEN)

**Files:**
- Create: `supabase/migrations/20260906169000_qeo132_raw_daily_basis.sql`
- Modify later: `supabase/migration-equivalence.json`
- Regenerate later: `modules/shared/supabase/database.types.ts`

**Step 1: Create append-only evidence table**

Core fields:

- `id uuid primary key`
- `ticker text not null`
- `session_date date not null`
- `open/high/low/close numeric not null`
- `volume numeric not null`
- `price_basis text not null check (price_basis = 'RAW')`
- `provider text not null`
- `provider_detail text not null`
- `source_url text not null`
- `source_price_unit text not null`
- `normalization_version text not null`
- `raw_evidence_hash text not null`
- `fetched_at timestamptz not null`
- `created_at timestamptz not null default now()`

Use exact-observation uniqueness sufficient for idempotent replay while allowing corrected evidence.

No update/delete grants to service callers; table is append-only.

**Step 2: Create canonical raw table**

One row per `(ticker, session_date)` referencing exact evidence ID and mirroring canonical raw OHLCV/provenance needed for efficient readback.

**Step 3: Implement service-only atomic RPC**

RPC validates input, inserts/reuses exact evidence identity, optionally selects the exact evidence as canonical, and returns identifiers/readback metadata.

Canonical selection is explicit; there is no provider-name auto precedence.

**Step 4: Security**

Enable RLS. Revoke public/anon/authenticated table mutation. Grant only required service-role operations/RPC execution. Evidence direct updates/deletes remain unavailable.

**Step 5: Run DB GREEN**

- local Supabase zero-to-latest replay
- `tests/db/qeo132-raw-daily-persistence.sql`
- DB schema contracts/lint

Expected: PASS.

**Step 6: Commit**

Commit message: `feat(QEO-132): add raw Daily evidence storage`

---

## Task 5 — Add server-side raw store/read boundary (TDD)

**Files:**
- Create: `tests/market-history/qeo132-raw-daily-store.test.ts`
- Create: `modules/market/history/raw-daily-store.ts`
- Modify: `modules/market/history/index.ts`
- Modify: `tests/test-contracts.json`

**Step 1: RED tests**

Require:

1. persistence payload always contains explicit RAW basis and deterministic source hash/provenance;
2. exact persisted readback is authoritative success signal;
3. mismatched returned evidence/canonical IDs or OHLCV rejects success;
4. canonical raw loader reads only `market_ohlcv_raw_daily`;
5. loader returns RAW provenance and deterministic session ordering;
6. no fallback to `market_ohlcv_history`, VCI, TitanLabs, Yahoo, or inferred provider basis;
7. sanitized errors do not leak credentials/provider payloads.

Run target and observe RED before implementation.

**Step 2: Minimal implementation**

Implement store/read functions against QEO-132 RPC/table. Keep module independent from QEO-129 until QEO-132 merges.

**Step 3: GREEN**

Run target, fast suite, typecheck.

**Step 4: Commit**

Commit message: `feat(QEO-132): add canonical raw Daily store`

---

## Task 6 — VHM golden integration contract

**Files:**
- Create: `tests/market-history/qeo132-vhm-raw-golden.test.ts`
- Create: `docs/db/evidence/qeo132-vhm-raw-basis-2026-09-07.md`
- Modify: `tests/test-contracts.json`

**Step 1: Freeze the seven observed VHM rows needed for validation**

The fixture must retain raw and adjusted values separately and cite the bounded StockBiz surface as evidence. It must not synthesize raw from adjusted numbers.

**Step 2: Test parser -> persistence input -> canonical raw semantics**

Assert:

- 5-session golden raw H/L = `131.5 / 114.6`
- 2026-06-26 raw close = `162.0`
- 2026-08-05 raw close = `153.0`
- adjusted audit closes are not persisted into raw OHLC
- stable input yields stable evidence hash/payload

**Step 3: Run GREEN suite**

`pnpm test:fast`

`pnpm test:db`

`pnpm typecheck`

Expected: PASS.

**Step 4: Commit**

Commit message: `test(QEO-132): add VHM raw Daily golden regression`

---

## Task 7 — Generated types, migration ledger, preprod rehearsal

**Files:**
- Modify: `modules/shared/supabase/database.types.ts`
- Modify: `supabase/migration-equivalence.json`
- Modify: `docs/db/evidence/production-migration-ledger-2026-09-06.json` only if production promotion occurs
- Modify: `.github/workflows/qeo123-preprod.yml` or add a narrowly scoped QEO-132 rehearsal step if required

**Step 1: Regenerate types from zero-to-latest local Supabase**

Do not hand-edit generated database types.

**Step 2: Verify migration equivalence/ledger contracts**

Use reviewed production version only when production migration is actually applied.

**Step 3: Preprod exact persistence/readback**

Rehearse QEO-132 RPC with VHM fixture rows in local Supabase and verify rollback cleanup.

**Step 4: Full verification**

- `pnpm test:current`
- `pnpm typecheck`
- zero-to-latest migration replay
- generated types check
- DB contracts
- DB lint
- existing QEO-124 contracts
- EOD v4 contracts

Expected: all PASS.

**Step 5: Commit**

Commit message: `chore(QEO-132): reconcile raw Daily database contracts`

---

## Task 8 — PR review and production gate

**Step 1: Open draft PR early**

PR title: `feat: add auditable raw Daily evidence boundary`

Body must state:

- separate raw evidence/canonical boundary;
- no mutation of `market_ohlcv_history`;
- no chart/EOD cutover;
- StockBiz is bounded technical evidence, not automatically approved bulk production authority;
- `Closes QEO-132` only when full acceptance is genuinely met.

**Step 2: Exact-head CI**

Require Verify, DB Drift Reconciliation, QEO-123 Preprod Rehearsal, and EOD v4 all GREEN at exact head, with no unresolved review threads.

**Step 3: Production schema promotion**

Only after preprod GREEN. Apply migration using the existing reviewed promotion/reconciliation workflow. Confirm RLS/grants/RPC by readback.

**Step 4: Production data pilot decision**

Do not bulk-ingest StockBiz until terms/rate-limit suitability is accepted. If source permission remains unresolved, schema/storage may be production-ready but QEO-132 remains blocked on raw source operational approval.

If a supported raw source is available, persist a bounded VHM pilot and verify exact raw anchors/readback without touching `market_ohlcv_history`.

**Step 5: QEO-129 handoff**

After QEO-132 is merged and raw source acceptance is satisfied:

- rebase QEO-129 on main;
- replace its legacy raw-input assumption with the QEO-132 canonical raw loader;
- rerun VHM shadow terminal gate;
- verify pre/post raw checksum unchanged and adjusted H/L benchmark reproduced.

---

## Stop conditions

Stop and report rather than weakening contracts if any of these occur:

- only adjusted history is available;
- raw source terms/permission do not support intended production ingestion;
- provider raw semantics are ambiguous;
- raw and adjusted columns cannot be distinguished deterministically;
- DB exact readback differs from requested raw observation;
- any implementation path requires mutating legacy `market_ohlcv_history` before QEO-125 cutover.
