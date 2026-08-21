# QeoIndex Supabase Auth architecture

## Security boundary

`AppAuthGate` is UX only. It must never be treated as authorization.

The authenticated browser session is synchronized to the server through `/api/auth/session`. The server verifies the Supabase access token with `auth.getUser()` before storing it in the `qeoindex_access_token` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production).

Protected server pages and browser-facing API routes must verify that cookie again through `lib/auth/server.ts`.

## RLS data flow

```text
Supabase Auth user
  -> verified server session
  -> auth user id
  -> user-scoped Supabase client (anon key + Bearer JWT)
  -> RLS auth.uid()
  -> profiles / preferences / features / watchlists
```

Never use `getSupabaseServerClient()` / the service-role key for user-owned rows. Service-role access bypasses RLS and is reserved for trusted infrastructure tasks such as canonical market snapshots.

## Per-user tables

- `profiles`: profile fields keyed by `auth.users.id`.
- `user_preferences`: default page, compact board, sound and JSON settings.
- `user_features`: read-only feature entitlements for the signed-in user. End users cannot grant themselves features.
- `watchlists`: user-owned watchlist containers.
- `watchlist_items`: user-owned tickers. The composite `(watchlist_id, user_id)` foreign key prevents attaching an item to another user's watchlist.

A trigger on `auth.users` creates defaults for new users, and the migration backfills existing users.

## Feature gates

Browser-facing routes use server-side feature checks:

- `market_board`: market snapshot/session/index/stream routes.
- `research`: research promotion and scanner diagnostics.
- `signals`: signal health UI route.
- `finhay_live`: Finhay connect/status/quote/disconnect routes.

Machine endpoints keep dedicated bearer secrets (`CRON_SECRET`, `SCANNER_RUN_SECRET`, `SIGNAL_MONITOR_SECRET`) and do not depend on a browser session.

## Signup policy

QeoIndex currently exposes login only. Hosted Supabase Auth must therefore disable public signup in the Supabase Auth settings (`Allow new users to sign up` / email signup). The repository UI alone is not a security control for signup.

## Deployment checklist

1. Apply `supabase/migrations/20260821161500_user_auth_rls.sql` to the production Supabase project.
2. Confirm public/email signup is disabled in hosted Supabase Auth.
3. Test with two separate users: neither can read/update the other's profile, preferences, watchlists or watchlist items.
4. Confirm a disabled `user_features` row returns HTTP 403 from the corresponding API.
5. Confirm anonymous calls to protected browser APIs return HTTP 401.
6. Keep cron/monitor routes working with their existing bearer secrets.
