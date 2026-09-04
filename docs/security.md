# Security

Last audited: 2026-09-04

## Security boundary

QeoIndex treats browser UI gates as UX only. The authorization chain for user-facing data is:

```text
Supabase Auth
  -> verified HttpOnly server session
  -> server user.id
  -> feature entitlement check
  -> user-scoped Supabase client + JWT
  -> RLS auth.uid()
```

`AppAuthGate` must never be used as the security boundary for an API route or server data loader.

Public identifiers are not credentials. Repository-visible domains, provider endpoints, Supabase project URLs/refs, and publishable/anon keys may identify infrastructure, but authorization, RLS, server-only secrets, and least-privilege service access are the security boundary. Do not rely on hiding a hostname or project ref as a substitute for access control.

## Repository merge controls

The canonical merge contract for `main` is:

- changes reach `main` through a pull request under GitHub branch protection or an equivalent repository ruleset;
- the required GitHub Actions status check is `Verify / verify`;
- the protected branch must reject force-pushes and branch deletion;
- `.github/workflows/security.yml` runs on every pull request and again on every push to `main`;
- the pull-request run is the pre-merge gate; the `push: main` run is defense-in-depth and must not be treated as a substitute for branch protection;
- feature branches may be deleted automatically after merge once `delete_branch_on_merge` is enabled. This must never weaken protection for `main`.

The `Verify / verify` job executes both the fast project-aware tracked-source secret scan and a full-history Gitleaks scan, followed by current contract tests, touched lint, Market Board regression lint, TypeScript validation, and the production Next.js build. Keep this job name stable while it is configured as a required status check.

Emergency changes must still preserve an auditable pull request and successful verification unless a deliberately documented repository-admin break-glass procedure is used.

## Browser-facing API rules

- Protected market routes require the `market_board` feature.
- Research/scanner UI routes require `research`.
- Signal UI routes require `signals`.
- Finhay browser/OAuth routes require `finhay_live`, including the OAuth callback.
- `/api/me` and `/api/watchlist` derive the user ID from the verified server session. They never accept a client-provided `user_id`.
- Internal database/provider errors are logged server-side and should not be returned verbatim to clients.
- JSON preference settings are capped to 16 KiB; watchlist sort order is normalized server-side.

## Machine-only API rules

Next.js machine endpoints use `modules/auth/machine.ts`, which compares bearer secrets with a constant-time digest comparison.

| Endpoint | Required secret |
| --- | --- |
| `/api/signals/daily` | `CRON_SECRET` |
| `/api/signals/monitor` | `SIGNAL_MONITOR_SECRET` or `CRON_SECRET` |
| `/api/scanner/run` | `SCANNER_RUN_SECRET` or `CRON_SECRET` |
| `/api/market/sync-universe` | `MARKET_SYNC_SECRET` or `CRON_SECRET` |
| `/api/market/cache/invalidate` | `MARKET_CACHE_ADMIN_SECRET` or `CRON_SECRET` |

The destructive market maintenance endpoints are POST-only. They must not expose unauthenticated GET aliases.

Supabase Edge machine functions use `supabase/functions/_shared/machine-auth.ts`. Authentication must occur before service-role client construction, provider calls, or database access.

| Edge Function | Required machine authorization |
| --- | --- |
| `orderbook-sync` | dedicated/fallback machine secret accepted by the shared helper |
| `market-session` | `MARKET_SYNC_SECRET` or `CRON_SECRET` for every GET/POST |

`OPTIONS` may remain unauthenticated for CORS preflight. Unsupported methods fail with `405`; unauthenticated GET/POST requests fail with `401`. Browser-facing reads must go through authenticated application APIs rather than directly consuming service-role Edge reads.

## Supabase and RLS

User-owned tables are protected by RLS and ownership is derived from `auth.uid()`:

- `profiles`
- `user_preferences`
- `user_features`
- `watchlists`
- `watchlist_items`

`user_features` remains read-only to normal authenticated users so clients cannot self-enable entitlements.

`stock_orderbook_snapshots` no longer has anonymous Data API read access. Direct table reads are limited to the `authenticated` role; trusted ingestion uses the service-role server client.

`modules/shared/supabase/server.ts` is infrastructure-only and intentionally fails closed unless `SUPABASE_SERVICE_ROLE_KEY` is configured. It must never fall back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` for writes or trusted snapshot operations.

Relevant migrations:

- `20260821094252_user_auth_rls.sql`
- `20260821094322_revoke_bootstrap_rpc_execute.sql`
- `20260821103811_harden_orderbook_rls_and_indexes.sql`

The 2026-08-21 database audit also added a covering `(watchlist_id, user_id)` index for the composite ownership foreign key.

## HTTP response hardening

`next.config.mjs` applies these baseline headers globally:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-DNS-Prefetch-Control: off`

A strict CSP is intentionally not enabled yet. QeoIndex has WebSocket and external market-provider integrations, so CSP should be introduced only after an explicit `connect-src`, script/style nonce, and production smoke-test plan is defined. Do not ship a guessed CSP that silently breaks realtime data.

## Secret handling

- Keep DNSE, Notion, Finhay OAuth, scheduler, market-admin, Supabase service-role, Redis, QStash, KFSP, and infrastructure credentials in server-side environment variables.
- Never add a `NEXT_PUBLIC_` prefix to a credential. The only Supabase browser credential is the publishable/anon key.
- Commit only empty/environment-neutral examples such as `.env.example`.
- Run `pnpm scan:secrets` before committing. This fast scanner detects project-specific credential assignments and reports filenames only so an accidental credential is not copied into CI logs.
- CI additionally checks the reachable Git history with Gitleaks after a full-history checkout. Pull-request comments and secret-report artifacts are disabled for this gate.
- A historical secret finding is not remediated by deleting the current file or disabling its detection rule. Revoke/rotate the credential first. Only after that remediation may a reviewed historical fingerprint be allowlisted when retaining shared history is operationally required.
- Never copy a detected secret value into an issue, PR comment, CI summary, screenshot, or audit document. Evidence should use provider/rule class, path, commit/fingerprint metadata, and remediation state only.

## Remaining security action

Supabase Security Advisor currently reports one hosted-Auth warning: **Leaked Password Protection Disabled**. This is an Auth project setting, not a SQL/RLS issue. Enable Supabase leaked-password protection in the hosted Auth settings before broadening access beyond the current controlled user set.

Remediation reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

After enabling it, rerun the Supabase Security Advisor and expect no remaining database/Auth warnings relevant to this audit. If the setting cannot be changed through the current automation connector, track it explicitly as a hosted-setting follow-up rather than claiming source code fixed it.

## Credential rotation

Any credential that was ever committed to Git history must be treated as compromised:

1. Revoke or rotate the old credential at its provider.
2. Update the replacement only in the server/deployment secret store.
3. Redeploy every runtime that consumes the credential.
4. Confirm the old credential is rejected and the authorized application path still works.
5. Do not rewrite shared Git history until collaborators and deployment owners agree on the operational plan; rotation is required even if history is later rewritten.
