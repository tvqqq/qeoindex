# QEO-19 KFSP Vault Token Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `public.kfsp_provider_tokens` by moving provider-token caching into Supabase Vault without changing KFSP retry/fetch behavior.

**Architecture:** A compatibility migration exposes service-role-only Vault token-cache RPCs and backfills the existing cached token without logging it. One shared Edge helper reads/writes that Vault cache and performs login/refresh; all three KFSP consumers use it. The legacy table is dropped only after the RPC migration and Edge Functions are live and provider smoke passes.

**Tech Stack:** Supabase PostgreSQL + Vault, Supabase Edge Functions/Deno, TypeScript, Supabase JS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-02-qeo-19-legacy-cutover-design.md`

## Global Constraints

- Never return/log/copy the bearer token in test output, migration comments, Linear comments, or docs.
- Token RPCs are executable by `service_role` only.
- Existing `KFSP_USERNAME` / `KFSP_PASSWORD` Edge secrets remain a supported credential source because production Vault credentials are not configured today.
- Provider requests keep the existing one forced-refresh retry on auth rejection.
- Drop `kfsp_provider_tokens` only after three Edge Functions have zero table references and production provider smoke passes.

---

### Task 1: Add RED token-table consumer regression

**Files:**
- Modify/Create: `tests/qeo-19-legacy-cutover.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: three active Edge Function entrypoints.
- Produces: deterministic zero-consumer guard.

- [ ] **Step 1: Add failing assertions**

```ts
const kfspFunctions = [
  "supabase/functions/kfsp-rating-sync/index.ts",
  "supabase/functions/kfsp-ttai-history-sync/index.ts",
  "supabase/functions/market-insight-eod-sync/index.ts",
]

test("QEO-19 active KFSP runtime has no provider-token table consumer", () => {
  for (const path of kfspFunctions) {
    assert.doesNotMatch(source(path), /kfsp_provider_tokens/)
  }
})
```

- [ ] **Step 2: Run focused test**

Expected: FAIL on all three functions.

---

### Task 2: Add Vault token-cache compatibility RPCs

**Files:**
- Create: `supabase/migrations/<timestamp>_kfsp_vault_token_cache.sql`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

**Interfaces:**
- Produces:
  - `public.qeo_get_kfsp_provider_token_cache() returns jsonb`
  - `public.qeo_set_kfsp_provider_token_cache(p_access_token text, p_expires_at timestamptz) returns void`

- [ ] **Step 1: Add RED migration assertions**

Require both RPC names, `vault.decrypted_secrets`, `vault.create_secret`, `vault.update_secret`, service-role grants, and an internal backfill from the old table. Reject any `raise notice`/logging of token values.

- [ ] **Step 2: Create migration**

Core getter:

```sql
create or replace function public.qeo_get_kfsp_provider_token_cache()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_payload jsonb;
begin
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'kfsp_provider_token_cache'
  limit 1;

  if v_secret is null or btrim(v_secret) = '' then return null; end if;
  begin
    v_payload := v_secret::jsonb;
  exception when others then
    raise exception 'KFSP_VAULT_TOKEN_CACHE_INVALID';
  end;
  return v_payload;
end;
$$;
```

Core setter uses `vault.secrets.id` plus `vault.update_secret(...)` when present and `vault.create_secret(...)` otherwise. It stores exactly:

```sql
jsonb_build_object(
  'access_token', p_access_token,
  'expires_at', p_expires_at
)::text
```

Revoke from `public`, `anon`, `authenticated`; grant only `service_role`.

Backfill inside a `DO` block by selecting the current row from `public.kfsp_provider_tokens` and calling the setter if both token and expiry exist.

- [ ] **Step 3: Run static migration test and drift verifier**

```bash
node --test tests/qeo-19-legacy-cutover.test.ts
pnpm db:drift:verify
```

---

### Task 3: Create shared KFSP provider-auth helper

**Files:**
- Create: `supabase/functions/_shared/kfsp-provider-auth.ts`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

**Interfaces:**

```ts
export interface KfspProviderAuthOptions {
  loginUrl: string
  timeoutMs: number
  tokenExpirySkewMs?: number
  persistLogin?: boolean
}

export async function getKfspProviderToken(
  supabase: SupabaseClient,
  options: KfspProviderAuthOptions,
  forceRefresh?: boolean,
): Promise<{ token: string; refreshed: boolean }>
```

- [ ] **Step 1: Add RED helper assertions**

Require helper source to call `qeo_get_kfsp_provider_token_cache`, `qeo_set_kfsp_provider_token_cache`, and `qeo_get_kfsp_credentials`; forbid `kfsp_provider_tokens`.

- [ ] **Step 2: Implement cache read**

Call the getter RPC. Accept cached token only when:

- token is a non-empty JWT-like string;
- `expires_at` parses;
- expiry minus now exceeds skew.

A getter RPC error fails closed with `KFSP_VAULT_TOKEN_CACHE_READ_FAILED`.

- [ ] **Step 3: Implement credential resolution**

```ts
const envUser = Deno.env.get("KFSP_USERNAME") || ""
const envPass = Deno.env.get("KFSP_PASSWORD") || ""
if (envUser && envPass) return { username: envUser, password: envPass }

const vault = await supabase.rpc("qeo_get_kfsp_credentials")
// validate username/password, otherwise throw KFSP_CREDENTIALS_MISSING
```

- [ ] **Step 4: Implement login + cache write**

POST `{ username, password, persist_login: options.persistLogin ?? false }`, extract token, decode JWT expiry, then call:

```ts
await supabase.rpc("qeo_set_kfsp_provider_token_cache", {
  p_access_token: token,
  p_expires_at: expiresAt.toISOString(),
})
```

Return `{ token, refreshed: true }`. Setter error fails closed with `KFSP_VAULT_TOKEN_CACHE_WRITE_FAILED`.

- [ ] **Step 5: Implement public getter**

If not forced, return valid Vault cache as `{ refreshed: false }`; otherwise login and overwrite Vault cache.

---

### Task 4: Cut over rating sync

**Files:**
- Modify: `supabase/functions/kfsp-rating-sync/index.ts`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

**Interfaces:**
- Consumes: `getKfspProviderToken(...)`.
- Produces: existing filter/supplemental pipeline with unchanged one-refresh retry.

- [ ] **Step 1: Add RED import assertion**

Require import from `../_shared/kfsp-provider-auth.ts` and no local `decodeTokenExpiry`, `extractToken`, `loginAndCacheToken`, or `getProviderToken` definitions.

- [ ] **Step 2: Replace local auth code**

```ts
let auth = await getKfspProviderToken(supabase, {
  loginUrl: LOGIN_URL,
  timeoutMs: PROVIDER_TIMEOUT_MS,
  persistLogin: false,
})
```

On 401/403 call the same helper with `true` as `forceRefresh`.

- [ ] **Step 3: Run static/type regression**

---

### Task 5: Cut over TTAI history sync

**Files:**
- Modify: `supabase/functions/kfsp-ttai-history-sync/index.ts`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

- [ ] **Step 1: Add RED import/no-local-auth assertions**
- [ ] **Step 2: Replace initial token and forced-refresh calls with shared helper**

Initial:

```ts
let auth = await getKfspProviderToken(supabase, {
  loginUrl: LOGIN_URL,
  timeoutMs: PROVIDER_TIMEOUT_MS,
  persistLogin: false,
})
let token = auth.token
```

On 401/403:

```ts
auth = await getKfspProviderToken(supabase, options, true)
token = auth.token
```

Keep concurrency, candidate selection and history normalization unchanged.

---

### Task 6: Cut over Market Insight EOD sync

**Files:**
- Modify: `supabase/functions/market-insight-eod-sync/index.ts`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

- [ ] **Step 1: Add RED import/no-local-auth assertions**
- [ ] **Step 2: Replace local cache/login helper with shared helper**

Use `persistLogin: true` to preserve this function's current login request semantics. Preserve forced refresh on 401/403/423 and all HTTP/socket collection behavior.

---

### Task 7: Compatibility deployment and smoke

**Files:** no source changes.

- [ ] **Step 1: Verify branch CI**

Run/require:

```bash
pnpm test:core
pnpm db:drift:verify
pnpm typecheck
pnpm scan:secrets
```

- [ ] **Step 2: Apply only the Vault compatibility migration**

Verify by metadata only:

```sql
select proname from pg_proc ...;
select name from vault.secrets where name = 'kfsp_provider_token_cache';
```

Never select `decrypted_secret` during acceptance.

- [ ] **Step 3: Deploy three Edge Functions**

Deploy `kfsp-rating-sync`, `kfsp-ttai-history-sync`, and `market-insight-eod-sync` with their existing JWT/custom-auth configuration.

- [ ] **Step 4: Smoke token reuse and forced refresh**

Run safe existing manual/job entrypoints. Acceptance requires successful provider fetch and no reads/writes to `kfsp_provider_tokens`. Inspect only run status/telemetry, never token values.

---

### Task 8: Destructive token-table drop

**Files:**
- Create after compatibility smoke: `supabase/migrations/<timestamp>_drop_kfsp_provider_tokens.sql`
- Test: `tests/qeo-19-legacy-cutover.test.ts`

- [ ] **Step 1: Add drop migration assertion**
- [ ] **Step 2: Create minimal migration**

```sql
begin;

drop table if exists public.kfsp_provider_tokens;

commit;
```

Do not remove the Vault RPCs.

- [ ] **Step 3: Re-run zero-consumer, core, drift and type checks**
- [ ] **Step 4: Apply migration and verify `to_regclass('public.kfsp_provider_tokens') is null`**
- [ ] **Step 5: Repeat rating/TTAI/Market Insight smoke after the physical table is gone**
