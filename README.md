# StockOS / qeoindex

StockOS is a Vietnamese market board and Wyckoff research workspace built with Next.js 16, React 19, Notion, DNSE, Yahoo Finance, TradingView, and optional Upstash Redis. Production: <https://stockos-beryl.vercel.app>.

## Start here

Agents and new maintainers should read these files in order:

1. [`AGENTS.md`](./AGENTS.md) — repository rules and Next.js version warning.
2. [`docs/HANDOVER.md`](./docs/HANDOVER.md) — architecture, source-of-truth boundaries, operating procedures, and known failure modes.
3. [`docs/market-board.md`](./docs/market-board.md) — detailed market-board data flow and UI invariants.
4. [`docs/security.md`](./docs/security.md) — credential and secret-handling requirements.
5. [`docs/finhay-live-adapter.md`](./docs/finhay-live-adapter.md) — optional Finhay OAuth/live integration.

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

The Vercel project is `tvqqq/stockos`; the stable production alias is <https://stockos-beryl.vercel.app>.

```bash
pnpm exec vercel --prod --yes
```

After deployment, verify the page and the APIs touched by the change. Deployment success alone is not a production smoke test.
