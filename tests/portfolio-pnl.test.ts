import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { computePortfolioPositions, calculatePositionSizing, type RawTransaction } from '../lib/portfolio/pnl.ts'

test('AVCO P&L Engine: Single Buy transaction', () => {
  const txs: RawTransaction[] = [
    {
      id: '1',
      ticker: 'VCB',
      action: 'buy',
      quantity: 1000,
      price: 85.0,
      fee: 10.0,
      transaction_date: '2026-08-01',
      note: 'Initial buy',
      tags: ['Tạo nền'],
      target_price_1: 95.0,
      stop_loss_1: 80.0,
    },
  ]

  const summary = computePortfolioPositions(txs)
  assert.equal(summary.positions.length, 1)
  const pos = summary.positions[0]
  assert.equal(pos.ticker, 'VCB')
  assert.equal(pos.openQty, 1000)
  assert.equal(pos.avgCost, 85.01)
  assert.equal(pos.realizedPnl, 0)
  assert.equal(pos.targetPrice, 95.0)
  assert.equal(pos.stopLoss, 80.0)
  assert.equal(pos.targetPrice, pos.targetPrice1)
  assert.equal(pos.stopLoss, pos.stopLoss1)

  const { totalUnrealizedPnl, totalMarketValue, positionDetails } = summary.calcUnrealizedPnl({ VCB: 90.0 })
  assert.equal(totalMarketValue, 90_000)
  assert.equal(totalUnrealizedPnl, 1000 * (90 - 85.01))
  assert.equal(positionDetails[0].currentPrice, 90.0)
  assert.ok(positionDetails[0].unrealizedPnlPct > 5.8)
})

test('AVCO P&L Engine: Multiple Buys with Average Cost update', () => {
  const txs: RawTransaction[] = [
    { id: '1', ticker: 'FPT', action: 'buy', quantity: 1000, price: 100.0, fee: 0, transaction_date: '2026-08-01', note: null, tags: [] },
    { id: '2', ticker: 'FPT', action: 'buy', quantity: 500, price: 130.0, fee: 0, transaction_date: '2026-08-10', note: null, tags: [] },
  ]
  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1500)
  assert.equal(pos.avgCost, 110.0)
})

test('AVCO P&L Engine: Partial Sell with Realized P&L', () => {
  const txs: RawTransaction[] = [
    { id: '1', ticker: 'HPG', action: 'buy', quantity: 2000, price: 25.0, fee: 0, transaction_date: '2026-08-01', note: null, tags: [] },
    { id: '2', ticker: 'HPG', action: 'sell', quantity: 1000, price: 30.0, fee: 50.0, transaction_date: '2026-08-15', note: 'Take profit 50%', tags: [] },
  ]
  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1000)
  assert.equal(pos.avgCost, 25.0)
  assert.equal(pos.realizedPnl, 4950)
  assert.equal(summary.totalRealizedPnl, 4950)
})

test('AVCO P&L Engine: Cash Dividend reduces cost basis', () => {
  const txs: RawTransaction[] = [
    { id: '1', ticker: 'VNM', action: 'buy', quantity: 1000, price: 70.0, fee: 0, transaction_date: '2026-08-01', note: null, tags: [] },
    { id: '2', ticker: 'VNM', action: 'dividend_cash', quantity: 1000, price: 2.0, fee: 100.0, transaction_date: '2026-08-15', note: 'Cash dividend 20%', tags: [] },
  ]
  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1000)
  assert.equal(pos.avgCost, 68.1)
})

test('AVCO P&L Engine: Stock Dividend increases shares and dilutes avg cost', () => {
  const txs: RawTransaction[] = [
    { id: '1', ticker: 'MBB', action: 'buy', quantity: 1000, price: 24.0, fee: 0, transaction_date: '2026-08-01', note: null, tags: [] },
    { id: '2', ticker: 'MBB', action: 'dividend_stock', quantity: 200, price: 0, fee: 0, transaction_date: '2026-08-15', note: 'Stock dividend 20%', tags: [] },
  ]
  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1200)
  assert.equal(pos.avgCost, 20.0)
})

test('AVCO P&L Engine: Multi-target, multi-stoploss and Setup/Mistake tags', () => {
  const txs: RawTransaction[] = [
    {
      id: '1', ticker: 'SSI', action: 'buy', quantity: 1000, price: 32.0, fee: 15.0,
      transaction_date: '2026-08-01', note: 'Breakout vượt nền', tags: [],
      setup_tags: ['Breakout KL lớn', 'Mô hình VCP'], mistake_tags: [],
      target_price_1: 38.0, target_price_2: 42.0, target_price_3: 45.0,
      stop_loss_1: 29.5, stop_loss_2: 28.0,
    },
  ]
  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.targetPrice1, 38.0)
  assert.equal(pos.targetPrice2, 42.0)
  assert.equal(pos.targetPrice3, 45.0)
  assert.equal(pos.stopLoss1, 29.5)
  assert.equal(pos.stopLoss2, 28.0)
  assert.equal(pos.targetPrice, 38.0)
  assert.equal(pos.stopLoss, 29.5)
  assert.deepEqual(pos.setupTags, ['Breakout KL lớn', 'Mô hình VCP'])
})

test('Position Sizing Engine: Fixed Fractional Account Risk calculation', () => {
  const sizing = calculatePositionSizing({ initialCapital: 1_000_000_000, accountRiskPct: 1.5, tradeStopLossPct: 7.5, entryPrice: 25.0 })
  assert.equal(sizing.maxRiskAmount, 15_000_000)
  assert.equal(sizing.allocatedCapital, 200_000_000)
  assert.equal(sizing.allocationPctOfNav, 20.0)
  assert.equal(sizing.maxShares, 8000)
})

test('QEO-20 active runtime stops depending on legacy compatibility DB columns', () => {
  const transactions = readFileSync(resolve('app/api/portfolio/[id]/transactions/route.ts'), 'utf8')
  const transaction = readFileSync(resolve('app/api/portfolio/[id]/transactions/[txId]/route.ts'), 'utf8')
  const benchmark = readFileSync(resolve('app/api/portfolio/[id]/benchmark/route.ts'), 'utf8')
  const pnl = readFileSync(resolve('lib/portfolio/pnl.ts'), 'utf8')

  assert.doesNotMatch(transactions, /,target_price,stop_loss,/)
  assert.doesNotMatch(transactions, /\btarget_price:\s*target_price_1\b/)
  assert.doesNotMatch(transactions, /\bstop_loss:\s*stop_loss_1\b/)
  assert.doesNotMatch(transaction, /updates\.target_price\b/)
  assert.doesNotMatch(transaction, /updates\.stop_loss\b/)
  assert.doesNotMatch(transaction, /,target_price,stop_loss,/)
  assert.doesNotMatch(benchmark, /,target_price,stop_loss/)
  assert.doesNotMatch(pnl, /tx\.target_price\b/)
  assert.doesNotMatch(pnl, /tx\.stop_loss\b/)
  assert.match(transactions, /canonicalOrLegacy\(body, "target_price_1", "target_price"\)/)
  assert.match(transaction, /setCanonicalNumber\(updates, body, "target_price_1", "target_price"\)/)
})

test('QEO-20 migration is fail-closed, rewrites lease RPCs, and drops exactly approved compatibility columns', () => {
  const filename = '20260902134500_qeo20_compatibility_columns_cleanup.sql'
  const candidates = [
    resolve('supabase/migrations', filename),
    resolve('supabase/pending-migrations', filename),
  ].filter((path) => existsSync(path))
  assert.equal(candidates.length, 1, 'expected exactly one QEO-20 compatibility cleanup migration')
  const sql = readFileSync(candidates[0], 'utf8')

  assert.match(sql, /target_price_1\s*=\s*target_price/i)
  assert.match(sql, /stop_loss_1\s*=\s*stop_loss/i)
  assert.match(sql, /lease_expires_at\s*=\s*lease_until/i)
  assert.match(sql, /raise exception[^;]*target_price/i)
  assert.match(sql, /raise exception[^;]*stop_loss/i)
  assert.match(sql, /raise exception[^;]*lease/i)
  assert.match(sql, /drop column if exists target_price/i)
  assert.match(sql, /drop column if exists stop_loss/i)
  assert.match(sql, /drop column if exists lease_until/i)
  assert.doesNotMatch(sql, /drop column if exists tags/i)

  const claim = sql.match(/create or replace function public\.claim_market_ai_conclusion[\s\S]*?revoke all on function public\.claim_market_ai_conclusion/i)?.[0] ?? ''
  const complete = sql.match(/create or replace function public\.complete_market_ai_conclusion[\s\S]*?revoke all on function public\.complete_market_ai_conclusion/i)?.[0] ?? ''
  assert.ok(claim.length > 0)
  assert.ok(complete.length > 0)
  assert.doesNotMatch(claim, /lease_until/i)
  assert.doesNotMatch(complete, /lease_until/i)
  assert.match(claim, /lease_expires_at/i)
  assert.match(complete, /lease_expires_at/i)
  assert.match(claim, /where market_ai_conclusions\.id = v\.id/i)
})

test('QEO-20 keeps the destructive recovery rehearsal reusable after legacy columns are dropped', () => {
  const seed = readFileSync(resolve('scripts/db/recovery/seed.sql'), 'utf8')
  const destructive = readFileSync(resolve('scripts/db/recovery/destructive.sql'), 'utf8')
  const restored = readFileSync(resolve('scripts/db/recovery/assert-restored.sql'), 'utf8')

  assert.match(seed, /qeo_recovery_legacy_target/i)
  assert.match(destructive, /drop column if exists qeo_recovery_legacy_target/i)
  assert.match(restored, /qeo_recovery_legacy_target/i)
  assert.doesNotMatch(destructive, /drop column if exists target_price\s*;/i)
})
