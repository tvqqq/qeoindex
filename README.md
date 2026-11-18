# QeoIndex

**Đọc thị trường. Giữ kỷ luật.**

QeoIndex is a Vietnamese market board and research workspace built with Next.js 16, React 19, Supabase, DNSE, KFSP, Yahoo Finance, TradingView, and optional Upstash Redis.

Official domain: <https://qeoindex.qeoqeo.com>.

## Start here

Agents and maintainers should read these files in order:

0. [`CLAUDE.md`](./CLAUDE.md) — Claude Cowork / Claude Code entry point (open its linked files explicitly).
1. [`AGENTS.md`](./AGENTS.md) — repository invariants and Next.js version warning.
2. [`docs/README.md`](./docs/README.md) — documentation map, source-of-truth hierarchy, and lifecycle rules.
3. [`docs/HANDOVER.md`](./docs/HANDOVER.md) — canonical active production architecture and release/operations contract.
4. [`docs/market-board.md`](./docs/market-board.md) — realtime/EOD market-board data flow and performance invariants.
5. [`docs/security.md`](./docs/security.md) and [`docs/auth.md`](./docs/auth.md) — security, auth, and RLS boundaries.

Current work status belongs in Linear. Historical implementation context belongs in Git history and the explicitly historical `docs/superpowers/specs` / `docs/superpowers/plans` records, not in competing next-agent handoff files.

For the complete onboarding sequence, engineering handoff roles, code map, configuration, troubleshooting and evidence requirements, read **Claude Cowork: start here** in [`docs/HANDOVER.md`](./docs/HANDOVER.md).

## Local setup

The commands below describe developer setup; agents follow the inline-only execution policy in `AGENTS.md` and do not run shell/build/test commands by default. Do not copy existing secret-bearing environment files into a handoff.


```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Missing required persistent-data configuration must fail closed or render an explicit unavailable state; do not silently replace production data with fixtures.

## Required validation

For a normal source/docs release, run the repository PR gate and production build:

```bash
pnpm verify:pr
pnpm build
git diff --check
```

Use the more specific test suites documented in the touched domain. Database-changing work additionally requires the DB gates from `docs/HANDOVER.md`.

## Production deployment

The latest approved cutover evidence in [QEO-45](https://linear.app/qeoindex/issue/QEO-45) records Firebase App Hosting production on 2026-11-05: project `qeoindex-vn`, backend `qeoindex-web`, Singapore. The official domain remains <https://qeoindex.qeoqeo.com>. Vercel `tvqqq/stockos` is the preserved former frontend, with Cron Jobs disabled in that acceptance record.

Read the canonical [handover](./docs/HANDOVER.md#hosting-evidence-and-ownership) and [hosting runbook](./docs/hosting-firebase.md) before release work. Older AGENTS/provider-specific prose still needs reconciliation with the actual active provider; do not infer today's deployment or scheduler state from a historical document.

The routine release contract remains feature branch → reviewed PR → exact-head required GitHub Actions/reviews green → squash merge to `main` → one configured Git rollout → verify serving SHA and runtime smoke. Never bypass protections or manually redeploy the same release to verify it. Realtime and EOD worker images are independently deployed; a frontend merge does not update them.
