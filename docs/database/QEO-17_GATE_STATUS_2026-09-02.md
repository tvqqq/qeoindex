# QEO-17 — Gate Status Update — 2026-09-02

This file supersedes only the **status** portions of `QEO-17_DB_REFACTOR_SAFETY_GATE.md`; the deletion manifest and historical drift mapping remain valid.

## QEO-24 — SECURITY DEFINER exposure

Production hardening migration applied:

- migration name: `restrict_orderbook_prune_trigger_execute`
- production version: `20260902011846`

Verified effective privileges:

| Role | EXECUTE |
|---|---|
| `anon` | false |
| `authenticated` | false |
| `service_role` | true |

Structural verification:

- `trg_qeo_prune_orderbook_after_universe_publish` remains enabled;
- trigger remains attached to `market_universe_runs`;
- trigger still executes `qeo_prune_orderbook_after_universe_publish()`;
- Supabase security advisor no longer reports the SECURITY DEFINER executable warnings for this function.

Source fix is in QEO-24 PR #151 and has a successful GitHub Actions `Verify` run (`33578732543`). Until source integration lands on `main`, production is intentionally ahead by this one migration.

## QEO-25 — Migration drift

`clean_rebuild_market_snapshot_trigger` has been reconciled to production:

- production version: `20260902011529`;
- `public.qeo_trigger_market_snapshot_bootstrap()` exists;
- `anon` EXECUTE = false;
- `authenticated` EXECUTE = false;
- `service_role` EXECUTE = true.

A full logical-name comparison between `main/supabase/migrations` and the production migration ledger now shows:

- every migration logical name on `main` has a production counterpart;
- historical timestamp-prefix differences remain documented equivalence mappings, not unexplained migrations;
- the only current production-ahead logical migration is `restrict_orderbook_prune_trigger_execute`, explained by in-flight QEO-24 PR #151.

## QEO-26 — Recovery rehearsal

Current production project has zero Supabase development branches.

The recovery runbook is prepared in `QEO-26_RECOVERY_REHEARSAL.md`, but an actual rehearsal is still pending because creating a Supabase development branch is billable and requires explicit organization/cost authorization.

No destructive rollback rehearsal has been run on production.

## Current gate

| Gate | State |
|---|---|
| Consumer/dependency map | PASS for current deletion manifest |
| Deletion manifest | PASS / reviewable |
| SECURITY DEFINER production boundary | PASS; source PR integration pending |
| Migration logical-name reconciliation | PASS with one explained in-flight QEO-24 delta |
| Recovery runbook | PASS |
| Non-production backup/restore rehearsal | **BLOCKED / PENDING USER COST AUTHORIZATION** |
| Destructive DROP during QEO-17 | PASS — none executed |

QEO-17 must remain `In Progress` until QEO-24 source integration and QEO-26 non-production rehearsal are complete.
