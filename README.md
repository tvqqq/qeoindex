# QeoIndex

**Đọc thị trường. Giữ kỷ luật.**

QeoIndex is a Vietnamese market board and Wyckoff research workspace built with Next.js 16, React 19, Notion, DNSE, Yahoo Finance, TradingView, and optional Upstash Redis.

Official domain: <https://qeoindex.qeoqeo.com>.

## Start here

Agents and new maintainers should read these files in order:

1. [`AGENTS.md`](./AGENTS.md) — repository rules and Next.js version warning.
2. [`docs/HANDOVER.md`](./docs/HANDOVER.md) — architecture, source-of-truth boundaries, operating procedures, and known failure modes.
3. [`docs/NEXT_AGENT_HANDOFF.md`](./docs/NEXT_AGENT_HANDOFF.md) — copy-ready task brief for the next agent.
4. [`docs/market-board.md`](./docs/market-board.md) — detailed market-board data flow and UI invariants.
5. [`docs/security.md`](./docs/security.md) — credential and secret-handling requirements.
6. [`docs/finhay-live-adapter.md`](./docs/finhay-live-adapter.md) — optional Finhay OAuth/live integration.

## Local setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The home page requires Notion configuration. Missing Notion credentials intentionally render an unavailable state instead of replacing persistent data with fixtures.

## Required validation

Run the checks relevant to the changed area, then typecheck and build:

```bash
pnpm test:universe
pnpm test:intraday
pnpm test:indexes
pnpm test:signal-core
pnpm test:scanner-core
pnpm exec eslint <changed-files>
pnpm typecheck
pnpm build --webpack
pnpm scan:secrets
```

Full-repository lint currently includes pre-existing failures in unrelated/generated code. Do not hide this: report targeted lint separately from the full lint baseline.

## Production deployment

The product is **QeoIndex**. The existing Vercel infrastructure project remains `tvqqq/stockos` as a legacy deployment identifier; do not treat that slug as the product brand. The official public domain is <https://qeoindex.qeoqeo.com>. The `stockos-beryl.vercel.app` alias is retained only as an infrastructure fallback until it is explicitly retired.

```bash
pnpm exec vercel --prod --yes
```

After deployment, verify the official domain, the fallback Vercel alias, and the APIs touched by the change. Deployment success alone is not a production smoke test.
