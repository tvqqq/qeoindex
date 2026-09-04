# QEO-19 Legacy Bridge / Secret Cutover Design

## Goal

Remove the two remaining physical legacy stores owned by QEO-19 without weakening current production contracts:

1. `public.wyckoff_universe_memberships` → canonical published `public.market_universe_runs` + `public.market_universe_memberships` / `qeo_current_market_universe()`.
2. `public.kfsp_provider_tokens` → Supabase Vault-backed token cache, while retaining existing Edge Function credential secrets as the login fallback until Vault credentials are explicitly configured.

The two lanes are independently releasable. A destructive DROP is allowed only after the corresponding runtime has cut over, smoke tests pass, and active source contains zero runtime consumers of the legacy object.

## Verified starting state — 2026-09-02

- QEO-17, QEO-25 and QEO-26 are Done.
- Production canonical `vn_top_stocks` currently has 200 memberships.
- `wyckoff_universe_memberships` and `kfsp_provider_tokens` both still exist.
- Active Wyckoff runtime still references the legacy membership table in:
  - `modules/wyckoff/unified-data.ts`
  - `modules/wyckoff/unified-runner.ts`
  - `modules/wyckoff/supabase-publish.ts`
  - `modules/wyckoff/notion-ingest.ts`
- Active KFSP Edge Functions still read/write `kfsp_provider_tokens` in:
  - `supabase/functions/kfsp-rating-sync/index.ts`
  - `supabase/functions/kfsp-ttai-history-sync/index.ts`
  - `supabase/functions/market-insight-eod-sync/index.ts`
- Production Vault does not currently contain `kfsp_username` or `kfsp_password`; therefore a credentials-only Vault cutover would cause a production login outage.
- Production Vault provides `vault.create_secret(...)` and `vault.update_secret(...)`.

## Lane A — Wyckoff canonical universe cutover

### Source of truth

All operational Wyckoff membership resolves from the latest published `vn_top_stocks` canonical universe. No Wyckoff-specific membership copy is written.

### Runtime changes

- `runUnifiedWyckoff()` already loads `getCanonicalUniverse()`; remove the write-through copy into `wyckoff_universe_memberships`.
- `publishWyckoffV2SnapshotsDirect()` already loads and validates the canonical universe; remove its legacy membership upsert.
- `publishIngestingWyckoffV2Run()` must validate its payload against the canonical universe before publication and must not write the legacy table.
- `getUnifiedWyckoffData()` loads the canonical universe and builds UI stock rows from canonical ticker/rank/sector directly.
- Keep `wyckoff_scan_runs.universe_effective_date` as provenance; it is not a replacement membership store.

### Parity contract

A publish path must fail closed if any of these differ from canonical:

- ticker set;
- ticker count;
- rank per ticker.

The canonical run ID is recorded in run diagnostics where the path already supports diagnostics.

### Drop gate

`wyckoff_universe_memberships` may be dropped only after active runtime files contain no references and Wyckoff/EOD regressions prove exact canonical membership and `N × 2` snapshot acceptance.

## Lane B — KFSP token cache cutover

### Why token cache moves to Vault

The legacy table stores a bearer token in a normal application table. The replacement keeps the token encrypted at rest in Supabase Vault and exposes only service-role-only RPCs.

### Compatibility migration

Create service-role-only functions:

- `public.qeo_get_kfsp_provider_token_cache()` → returns `{access_token, expires_at}` or `null` from one Vault secret named `kfsp_provider_token_cache`.
- `public.qeo_set_kfsp_provider_token_cache(text, timestamptz)` → create/update that Vault secret.

Backfill the current `kfsp_provider_tokens` row into Vault inside SQL without returning or logging the token.

Do not drop the legacy table in this compatibility migration.

### Shared Edge helper

Create `supabase/functions/_shared/kfsp-provider-auth.ts` to own:

- JWT expiry decoding;
- token extraction from KFSP login payloads;
- cached token read through `qeo_get_kfsp_provider_token_cache`;
- provider login;
- Vault cache write through `qeo_set_kfsp_provider_token_cache`;
- forced refresh on 401/403 (and 423 where the existing market-insight path uses it).

Credential resolution order for login:

1. existing Edge Function secrets `KFSP_USERNAME` / `KFSP_PASSWORD` when both are present;
2. `qeo_get_kfsp_credentials()` Vault RPC when those Vault credential secrets are later configured;
3. fail closed with `KFSP_CREDENTIALS_MISSING`.

This order preserves production today while allowing a future credentials-to-Vault migration without reintroducing a token table.

### Edge Function changes

All three KFSP consumers call the shared helper and stop querying/upserting `kfsp_provider_tokens`. Existing provider-fetch retry behavior remains unchanged.

### Drop gate

After the compatibility RPC exists in production, all three functions are deployed, and token refresh/fetch smoke passes, a second migration drops `public.kfsp_provider_tokens`.

## Recovery and CI

QEO-26 destructive-recovery rehearsal currently depends on `wyckoff_universe_memberships` as its representative table-drop fixture. QEO-19 must update the rehearsal to use a local synthetic table fixture so the recovery gate remains runnable after the real legacy table is gone.

Add a QEO-19 regression test that fails if active runtime files mention either dropped legacy object, while explicitly allowing historical migrations/docs and the destructive recovery documentation where relevant.

## Rollout order

1. Add RED regression tests.
2. Add Vault token compatibility RPC/backfill migration.
3. Cut over Wyckoff runtime and KFSP Edge Functions.
4. Verify branch CI.
5. Apply compatibility migration and deploy three Edge Functions; run provider smoke.
6. Merge compatibility/runtime release to `main`; verify Git-triggered Vercel production is healthy.
7. Re-check zero active consumers.
8. Add/drop migration for both legacy objects (or one at a time if one lane has not passed its smoke gate).
9. Apply destructive migration, run schema drift/replay checks and production smoke.
10. Mark QEO-19 Done only after both physical tables are absent and the final smoke evidence is attached.

## Non-goals

- Do not change raw OHLCV retention.
- Do not alter KFSP rating schema or TTAI history semantics.
- Do not drop staging/sync-state/checkpoint tables.
- Do not add unrelated index optimization.
