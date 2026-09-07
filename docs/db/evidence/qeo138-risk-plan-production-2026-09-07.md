# QEO-138 Risk Profile, Discipline Profile and Money Management Plan — production evidence — 2026-09-07

## Verified production migrations

- Supabase project: `qeoindex` / `glwhhrmejlonhyorvtzm`.
- Repository and production use the same canonical versions:
  - `20260907124742 qeo138_risk_plan`;
  - `20260907124940 qeo138_profile_user_fk_indexes`.
- The second migration is index-only and was added after the Supabase performance advisor reported direct `user_id -> auth.users` foreign keys without leading-column covering indexes.

## Additive / no fabricated portfolio history

Fresh production readback after both migrations showed:

- `portfolio_risk_profile_attempts`: 0 rows;
- `portfolio_discipline_profile_attempts`: 0 rows;
- `portfolio_money_management_plans`: 0 rows;
- `portfolio_trades` rows with `money_management_plan_id IS NOT NULL`: 0.

Therefore no existing portfolio received a fabricated profile, default Money Management Plan, or entry-time plan provenance. The product creates these records only after an explicit authenticated user action.

## Immutable history and ownership boundary

Production metadata confirms RLS is enabled on all three QEO-138 history tables. Authenticated access is limited to SELECT and INSERT. Fresh privilege readback confirms authenticated UPDATE and DELETE are false for:

- `portfolio_risk_profile_attempts`;
- `portfolio_discipline_profile_attempts`;
- `portfolio_money_management_plans`.

Each row is portfolio/user scoped through composite ownership foreign keys. Saved profile attempts and Money Management Plan versions are therefore append-only at the authenticated database boundary.

## Money Management Plan version allocator

Production contains `public.qeo_create_portfolio_money_management_plan(uuid, jsonb)` with:

- `SECURITY INVOKER` (`prosecdef = false`);
- fixed empty `search_path`;
- EXECUTE granted to `authenticated` only;
- no EXECUTE grant for `anon` or `public`.

The reviewed function takes a transaction-scoped advisory lock keyed by portfolio before allocating `max(version) + 1` and inserting the new immutable version in the same transaction. Normal RLS remains authoritative because the function is security-invoker.

## Foreign-key index readback

Production contains the three advisor-driven direct-owner indexes:

- `portfolio_risk_profile_attempts_user_id_idx (user_id)`;
- `portfolio_discipline_profile_attempts_user_id_idx (user_id)`;
- `portfolio_money_management_plans_user_id_idx (user_id)`.

A fresh performance-advisor read after the index migration no longer reports QEO-138 `unindexed_foreign_keys` findings. Newly created indexes may appear as `unused_index` while the QEO-138 tables remain empty; that is expected immediately after rollout and is not evidence to remove FK coverage.

A fresh security-advisor read reports no QEO-138 table-specific RLS finding. Existing findings on unrelated tables or Auth configuration remain outside QEO-138 scope.

## Product/source boundary

QEO-138 persists McDowell-aligned Risk Profile and Discipline Profile attempts plus a versioned Money Management Plan. Deterministic product rules keep book examples configurable rather than silently persisting them as defaults. Win Ratio and Payoff Ratio evidence is based on closed logical Trades; missing canonical history stays `Insufficient History` rather than being inferred.

QEO-138 does not replace the legacy capital-allocation calculator or sizing formula; QEO-139 owns that cutover. It does not implement the Active Risk engine (QEO-141) and introduces no AI behavior.
