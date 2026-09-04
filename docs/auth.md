# QeoIndex Supabase Auth architecture

Last updated: 2026-08-21

## Security boundary

`AppAuthGate` is UX only. It must never be treated as authorization.

The authenticated browser session is synchronized to the server through `/api/auth/session`. The server verifies the Supabase access token with `auth.getUser()` before storing it in the `qeoindex_access_token` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production).

Protected server pages and browser-facing API routes verify that server session through `modules/auth/server.ts` before loading protected data.

## RLS data flow

```text
Supabase Auth user
  -> verified server session
  -> auth user id
  -> user-scoped Supabase client (anon/publishable key + Bearer JWT)
  -> RLS auth.uid()
  -> profiles / preferences / features / watchlists
```

Never use `getSupabaseServerClient()` / the service-role key for user-owned rows. Service-role access bypasses RLS and is reserved for trusted infrastructure tasks such as canonical market snapshots. The infrastructure client now fails closed if `SUPABASE_SERVICE_ROLE_KEY` is missing; it does not fall back to a public anon key.

## Per-user tables

- `profiles`: profile fields keyed by `auth.users.id`.
- `user_preferences`: default page, compact board, sound and JSON settings.
- `user_features`: read-only feature entitlements for the signed-in user. End users cannot grant themselves features.
- `watchlists`: user-owned watchlist containers.
- `watchlist_items`: user-owned tickers. The composite `(watchlist_id, user_id)` foreign key prevents attaching an item to another user's watchlist.

A trigger on `auth.users` creates defaults for new users, and the auth migration backfilled existing users. The trigger function cannot be invoked by `anon` or `authenticated` through PostgREST RPC.

## Feature gates

Browser-facing routes use server-side feature checks:

- `market_board`: market snapshot/session/index/stream routes.
- `research`: research promotion and scanner diagnostics.
- `signals`: signal health UI route.
- `finhay_live`: Finhay connect/status/quote/disconnect and OAuth callback routes.

Machine endpoints use dedicated bearer-secret authorization through `modules/auth/machine.ts` and do not depend on a browser session. Current secrets are `CRON_SECRET`, `SCANNER_RUN_SECRET`, `SIGNAL_MONITOR_SECRET`, `MARKET_SYNC_SECRET`, and `MARKET_CACHE_ADMIN_SECRET`.

## Market snapshot access

`stock_orderbook_snapshots` is infrastructure data rather than per-user data, but direct Supabase Data API access is no longer anonymous. The final RLS state grants SELECT only to `authenticated`; ingestion remains service-role only.

This prevents an unauthenticated client from bypassing QeoIndex API gates by querying the Supabase table directly with the public project key.

## Applied production migrations

The following auth/security migrations have been applied to the production `qeoindex` Supabase project:

1. `20260821094252_user_auth_rls.sql`
2. `20260821094322_revoke_bootstrap_rpc_execute.sql`
3. `20260821103811_harden_orderbook_rls_and_indexes.sql`

After the third migration, Supabase database security/performance warnings related to the orderbook RLS and the composite watchlist foreign key were cleared. Newly created indexes may still appear as `unused_index` INFO until traffic exercises them; do not remove them solely on that early signal.

## Signup and password policy

QeoIndex exposes login only. Hosted Supabase Auth should therefore keep public signup disabled (`Allow new users to sign up` / email signup). The absence of a register UI is not a signup security control.

Supabase Security Advisor currently reports **Leaked Password Protection Disabled**. Enable leaked-password protection in hosted Auth settings before broadening access. This is an Auth configuration setting and cannot be fixed by RLS SQL.

## Verification checklist

1. Anonymous calls to protected browser APIs return HTTP 401.
2. A user without the matching `user_features` entitlement receives HTTP 403.
3. Two separate users cannot read or modify each other's profile, preferences, watchlists, or watchlist items.
4. Anonymous direct reads of `stock_orderbook_snapshots` are rejected by Supabase RLS/privileges.
5. Market sync/cache maintenance routes reject requests without their bearer secret and accept POST only.
6. Machine cron/scanner/monitor routes remain operational with their configured secrets.
7. Hosted Auth public signup is disabled.
8. Enable leaked-password protection and rerun Supabase Security Advisor.
