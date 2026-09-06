# QEO-123 Canonical Corporate-Action Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auditable canonical corporate-action storage and a production-grade free-source ingestion adapter after QEO-122 returns GO.

**Architecture:** Keep source-specific parsing isolated under `modules/market/corporate-actions/providers/`; normalize into a provider-agnostic contract and persist immutable raw notice evidence plus one-or-more normalized action components per source notice. UI and adjustment-engine consumers read only normalized contracts.

**Tech Stack:** TypeScript, Supabase/PostgreSQL, Next.js server runtime, existing Database types/test conventions.

**Spec:** `docs/superpowers/specs/2026-09-06-corporate-actions-adjusted-chart-design.md`

## Global Constraints

- Start only after QEO-122 GO.
- Raw source notice evidence and normalized action components are separate.
- One source notice may contain multiple actions (for example VHM 2021 cash + stock dividend); do not force one notice = one normalized row.
- No chart-facing Daily rewrite in this issue.
- Missing/ambiguous `ex_date` remains explicit and cannot activate factors.
- All mutations are service-role/server-only; authenticated users receive read-only normalized data.

---

### Task 1: Add canonical database schema

**Files:**
- Create: `supabase/migrations/20260906163000_qeo123_corporate_actions.sql`
- Modify: `supabase/migration-equivalence.json`
- Modify: `docs/db/evidence/production-migration-ledger-2026-09-06.json`
- Modify: `lib/supabase/database.types.ts`
- Test: `tests/market-data-contract.test.ts`

**Interfaces:**
- Produces tables `corporate_action_source_evidence` and `corporate_actions`.

- [ ] **Step 1: Write RED schema contract assertions**

Assert the migration contains service-role-only mutation policy, immutable source-notice evidence, one-to-many normalized action components, explicit nullable `ex_date`, status/action checks, provenance hashes and normalization version.

- [ ] **Step 2: Run targeted contract RED**

```bash
pnpm exec tsx --test tests/market-data-contract.test.ts
```

Expected: FAIL because the migration/schema does not exist.

- [ ] **Step 3: Implement migration**

Use this logical core:

```sql
create table public.corporate_action_source_evidence (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_event_id text not null,
  source_url text not null,
  raw_payload jsonb not null,
  raw_evidence_hash text not null,
  source_published_at timestamptz,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (source, source_event_id, raw_evidence_hash)
);

create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  isin text,
  exchange text not null,
  action_type text not null,
  source_component_key text not null,
  announcement_date date,
  ex_date date,
  record_date date,
  payment_date date,
  effective_date date,
  cash_per_share numeric,
  stock_ratio_numerator numeric,
  stock_ratio_denominator numeric,
  rights_ratio_numerator numeric,
  rights_ratio_denominator numeric,
  rights_subscription_price numeric,
  status text not null,
  source text not null,
  source_event_id text not null,
  source_url text not null,
  raw_evidence_hash text not null,
  normalization_version text not null,
  ex_date_derivation_method text,
  trading_calendar_version text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_event_id, source_component_key)
);
```

`source_component_key` is deterministic within one notice, for example `cash_dividend:0`, `stock_dividend:0`, `rights_issue:0`. A notice amendment preserves the logical component identity and updates its evidence lineage rather than inventing a second action.

Add checks for supported status/action values and indexes on `(ticker, ex_date)`, `(ticker, record_date)` and `(source, source_event_id)`.

- [ ] **Step 4: Regenerate Database types and add migration-equivalence entry**

Repository version is exactly `20260906163000`. If production applies under a different Supabase timestamp, map it explicitly in `supabase/migration-equivalence.json`; never rename an already-applied production migration to fake parity.

- [ ] **Step 5: Run DB Drift locally/CI**

Expected: reviewed ledger passes, migrations replay from zero, generated types and DB contracts pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260906163000_qeo123_corporate_actions.sql supabase/migration-equivalence.json docs/db/evidence/production-migration-ledger-2026-09-06.json lib/supabase/database.types.ts tests/market-data-contract.test.ts
git commit -m "feat(QEO-123): add canonical corporate action storage"
```

### Task 2: Create provider-agnostic contracts

**Files:**
- Create: `modules/market/corporate-actions/contract.ts`
- Create: `modules/market/corporate-actions/normalize.ts`
- Test: `tests/qeo-123-corporate-actions.test.ts`

**Interfaces:**

```ts
export type CorporateActionStatus = "announced" | "effective" | "completed" | "ambiguous" | "canceled"
export type CorporateActionType = "cash_dividend" | "stock_dividend" | "split" | "rights_issue" | "other"

export type NormalizedCorporateAction = {
  ticker: string
  isin: string | null
  exchange: "HOSE" | "HNX" | "UPCOM" | "UNKNOWN"
  actionType: CorporateActionType
  sourceComponentKey: string
  announcementDate: string | null
  exDate: string | null
  recordDate: string | null
  paymentDate: string | null
  effectiveDate: string | null
  cashPerShare: number | null
  stockRatioNumerator: number | null
  stockRatioDenominator: number | null
  rightsRatioNumerator: number | null
  rightsRatioDenominator: number | null
  rightsSubscriptionPrice: number | null
  status: CorporateActionStatus
  source: string
  sourceEventId: string
  sourceUrl: string
  rawEvidenceHash: string
  normalizationVersion: string
  exDateDerivationMethod: string | null
  tradingCalendarVersion: string | null
}
```

- [ ] **Step 1: RED normalization fixtures**

Include a combined VHM notice that yields exactly two normalized rows with the same `sourceEventId` and different deterministic `sourceComponentKey` values.

- [ ] **Step 2: Implement fail-closed normalization** — incomplete rights terms or unproven ex-date become `ambiguous`.
- [ ] **Step 3: GREEN targeted tests**
- [ ] **Step 4: Commit**

### Task 3: Promote the approved free-source adapter from spike to production module

**Files:**
- Create: `modules/market/corporate-actions/providers/vsdc.ts`
- Create: `modules/market/corporate-actions/providers/index.ts`
- Create: `tests/fixtures/corporate-actions/vsdc/`
- Modify: `tests/qeo-123-corporate-actions.test.ts`

**Interfaces:**
- Produces `fetchCorporateActionsForTicker(ticker, options): Promise<NormalizedCorporateAction[]>`.

- [ ] **Step 1: Copy only behavior proven by QEO-122 fixtures; do not import the probe module**
- [ ] **Step 2: Add combined-action, amendment and duplicate-notice regression fixtures**
- [ ] **Step 3: Implement bounded timeout, source identity and sanitized errors**
- [ ] **Step 4: Run targeted tests and TypeScript**
- [ ] **Step 5: Commit**

### Task 4: Add idempotent repository/persistence layer

**Files:**
- Create: `modules/market/corporate-actions/store.ts`
- Modify: `tests/qeo-123-corporate-actions.test.ts`

**Interfaces:**

```ts
export async function upsertCorporateActionEvidence(
  supabase: SupabaseClient,
  action: NormalizedCorporateAction,
  rawPayload: unknown,
): Promise<{ actionId: string; change: "new" | "amended" | "unchanged" }>
```

- [ ] **Step 1: RED idempotency test** — same component/evidence twice returns `unchanged`.
- [ ] **Step 2: RED amendment test** — same `(source, sourceEventId, sourceComponentKey)` + changed hash returns `amended` while retaining source evidence lineage.
- [ ] **Step 3: RED combined notice test** — cash and stock components coexist without uniqueness conflict.
- [ ] **Step 4: Implement transactional/idempotent persistence via RPC or bounded table writes**
- [ ] **Step 5: Verify exact readback matches normalized row before returning success**
- [ ] **Step 6: Commit**

### Task 5: Add normalized read API

**Files:**
- Create: `app/api/market/corporate-actions/route.ts`
- Create: `modules/market/corporate-actions/read-model.ts`
- Test: `tests/qeo-123-corporate-actions-api.test.ts`

**Interfaces:**

```ts
export type CorporateActionView = {
  id: string
  ticker: string
  actionType: CorporateActionType
  status: "upcoming" | "effective" | "completed" | "ambiguous" | "canceled"
  exDate: string | null
  recordDate: string | null
  paymentDate: string | null
  cashPerShare: number | null
  stockRatio: string | null
  rightsRatio: string | null
  subscriptionPrice: number | null
  sourceLabel: string
  sourceUrl: string | null
  verificationStatus: string
}
```

- [ ] **Step 1: RED API contract for ticker + optional date range**
- [ ] **Step 2: Implement authenticated read-only route**
- [ ] **Step 3: Verify ambiguous event exposes `exDate=null` and is not silently canonicalized**
- [ ] **Step 4: Verify two components from one source notice return as two event rows sharing source provenance**
- [ ] **Step 5: Run API tests/build**
- [ ] **Step 6: Commit**

### Task 6: Production verification and Linear handoff

- [ ] Apply migration only after DB Drift/Verify green.
- [ ] Record the exact production migration version in the reviewed ledger/equivalence mapping.
- [ ] Ingest VHM golden events and read them back with exact provenance, including combined cash+stock notice behavior.
- [ ] Verify browser roles cannot mutate source/action tables.
- [ ] Verify QEO-123 has no write to `market_ohlcv_history` or adjusted chart tables.
- [ ] Update QEO-123 with migration, fixture, VHM and RLS evidence; only then mark Done and unblock QEO-124/QEO-126.
