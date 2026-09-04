# QeoIndex

**Đọc thị trường. Giữ kỷ luật.**

QeoIndex is a Vietnamese market board and research workspace built with Next.js 16, React 19, Supabase, DNSE, KFSP, Yahoo Finance, TradingView, and optional Upstash Redis.

Official domain: <https://qeoindex.qeoqeo.com>.

## Start here

Agents and maintainers should read these files in order:

1. [`AGENTS.md`](./AGENTS.md) — repository invariants and Next.js version warning.
2. [`docs/README.md`](./docs/README.md) — documentation map, source-of-truth hierarchy, and lifecycle rules.
3. [`docs/HANDOVER.md`](./docs/HANDOVER.md) — canonical active production architecture and release/operations contract.
4. [`docs/market-board.md`](./docs/market-board.md) — realtime/EOD market-board data flow and performance invariants.
5. [`docs/security.md`](./docs/security.md) and [`docs/auth.md`](./docs/auth.md) — security, auth, and RLS boundaries.

Current work status belongs in Linear. Historical implementation context belongs in Git history and the explicitly historical `docs/superpowers/specs` / `docs/superpowers/plans` records, not in competing next-agent handoff files.

## Local setup

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

The product is **QeoIndex**. The existing Vercel infrastructure project remains `tvqqq/stockos` as a legacy deployment identifier; do not treat that slug as the product brand. The official public domain is <https://qeoindex.qeoqeo.com>. The `stockos-beryl.vercel.app` alias is retained only as an infrastructure fallback until explicitly retired.

Production uses a **single deployment path**:

```text
feature/work branch
  -> validate + commit + push
  -> merge/squash once to main
  -> Vercel Git Integration auto-deploys main
  -> verify READY + smoke production
```

`main` is the only deployment-enabled Git branch. Do **not** run `vercel --prod`, `vercel deploy --prod`, or a Deploy Hook after pushing/merging the same release to `main`; doing so creates duplicate production deployments.

Use Vercel tooling only to inspect deployment status/logs and production health. A manual production deployment is an exceptional recovery path and requires explicit authorization plus confirmation that Git auto-deploy will not also run for that release.

After the Git-triggered deployment, verify the official domain, the fallback Vercel alias when retained, and the APIs touched by the change. Deployment success alone is not a production smoke test.
