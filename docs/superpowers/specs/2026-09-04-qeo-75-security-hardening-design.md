# QEO-75 Security Hardening Design

## Goal

Close the residual security gaps from the 2026-09-04 audit without relying on obscurity or broad history rewrites.

## Scope

1. Require machine authorization for every non-OPTIONS request to `supabase/functions/market-session/index.ts` before service-role client construction or database access.
2. Keep `OPTIONS` available for CORS preflight and reject unsupported methods with `405`.
3. Preserve the existing `MARKET_SYNC_SECRET` / `CRON_SECRET` contract through the shared constant-time `isMachineRequestAuthorized` helper.
4. Expand the tracked-tree scanner with project-specific secret classes while continuing to print filenames only.
5. Add an independent full-history Gitleaks gate in the canonical `Verify` workflow using full checkout history.
6. Make `.env.example` architecture-neutral and remove concrete production IDs/domains that are not required by the example contract. Public Supabase URLs/project refs are not treated as credentials; historical migrations are not rewritten merely to hide them.
7. Reconcile `docs/security.md` with the enforced controls.
8. Supabase leaked-password protection remains a hosted Auth setting. If it cannot be changed through the available project connector, record it as a manual setting blocker rather than claiming completion.

## Security boundaries

- Browser/UI gating is not authorization.
- A Supabase service-role client must never be constructed before machine authorization on machine-only Edge Functions.
- Secret scans must not echo secret values into CI logs.
- Historical findings are remediated by credential rotation/revocation first. A reviewed historical fingerprint may be allowlisted only after rotation; rules must not be disabled globally.
- Do not issue production requests that can cause writes to prove an authorization flaw.

## CI design

The existing `Verify / verify` job remains the required status check. It continues the fast tracked-tree scan and adds a Gitleaks history scan after `actions/checkout` with `fetch-depth: 0`. Use `gitleaks/gitleaks-action@v3` because the action is Node 24 based; disable PR comments/artifact upload so the repository does not need broader workflow permissions and findings stay in the job log.

## Testing

TDD sequence:

1. Change the existing static contract test so it requires the `market-session` authorization gate to precede all service-role access for GET and POST, not only POST.
2. Add a security-workflow contract test that requires full-history checkout and the Gitleaks v3 step.
3. Add scanner contract coverage for the project-specific secret variable names/pattern classes.
4. Run the canonical `Verify` workflow on the PR. The test-only revision must fail before production code is changed; the implementation revision must pass.

## Non-goals

- Rewriting Git history solely to remove public project identifiers.
- Treating public domains, Supabase project URLs or anon/publishable keys as secrets.
- Adding a guessed CSP as part of this task.
- Refactoring unrelated authentication code.
