import test from 'node:test'
import assert from 'node:assert/strict'

import { computePortfolioPositions, type RawTransaction } from '../lib/portfolio/pnl.ts'

test('AVCO P&L Engine: Single Buy transaction', () => {
  const txs: RawTransaction[] = [
    {
      id: '1',
      ticker: 'VCB',
      action: 'buy',
      quantity: 1000,
      price: 85.0, // 85 k₫
      fee: 10.0,   // 10 k₫
      transaction_date: '2026-08-01',
      note: 'Initial buy',
      tags: ['Tạo nền'],
      target_price: 95.0,
      stop_loss: 80.0,
    },
  ]

  const summary = computePortfolioPositions(txs)
  assert.equal(summary.positions.length, 1)
  const pos = summary.positions[0]
  assert.equal(pos.ticker, 'VCB')
  assert.equal(pos.openQty, 1000)
  // Avg cost = (1000 * 85 + 10) / 1000 = 85.01 k₫
  assert.equal(pos.avgCost, 85.01)
  assert.equal(pos.realizedPnl, 0)
  assert.equal(pos.targetPrice, 95.0)
  assert.equal(pos.stopLoss, 80.0)

  // Test unrealized P&L calculation with current market price 90 k₫
  const { totalUnrealizedPnl, totalMarketValue, positionDetails } = summary.calcUnrealizedPnl({ VCB: 90.0 })
  assert.equal(totalMarketValue, 90_000) // 1000 * 90
  assert.equal(totalUnrealizedPnl, 1000 * (90 - 85.01))
  assert.equal(positionDetails[0].currentPrice, 90.0)
  assert.ok(positionDetails[0].unrealizedPnlPct > 5.8)
})

test('AVCO P&L Engine: Multiple Buys with Average Cost update', () => {
  const txs: RawTransaction[] = [
    {
      id: '1',
      ticker: 'FPT',
      action: 'buy',
      quantity: 1000,
      price: 100.0,
      fee: 0,
      transaction_date: '2026-08-01',
      note: null,
      tags: [],
      target_price: null,
      stop_loss: null,
    },
    {
      id: '2',
      ticker: 'FPT',
      action: 'buy',
      quantity: 500,
      price: 130.0,
      fee: 0,
      transaction_date: '2026-08-10',
      note: null,
      tags: [],
      target_price: null,
      stop_loss: null,
    },
  ]

  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1500)
  // Avg cost = (1000 * 100 + 500 * 130) / 1500 = (100000 + 65000) / 1500 = 110.0 k₫
  assert.equal(pos.avgCost, 110.0)
})

test('AVCO P&L Engine: Partial Sell with Realized P&L', () => {
  const txs: RawTransaction[] = [
    {
      id: '1',
      ticker: 'HPG',
      action: 'buy',
      quantity: 2000,
      price: 25.0,
      fee: 0,
      transaction_date: '2026-08-01',
      note: null,
      tags: [],
      target_price: null,
      stop_loss: null,
    },
    {
      id: '2',
      ticker: 'HPG',
      action: 'sell',
      quantity: 1000,
      price: 30.0,
      fee: 50.0, // 50 k₫ fee + tax
      transaction_date: '2026-08-15',
      note: 'Take profit 50%',
      tags: [],
      target_price: null,
      stop_loss: null,
    },
  ]

  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1000)
  assert.equal(pos.avgCost, 25.0)
  // Realized PnL = (30 - 25) * 1000 - 50 = 5000 - 50 = 4950 k₫
  assert.equal(pos.realizedPnl, 4950)
  assert.equal(summary.totalRealizedPnl, 4950)
})

test('AVCO P&L Engine: Cash Dividend reduces cost basis', () => {
  const txs: RawTransaction[] = [
    {
      id: '1',
      ticker: 'VNM',
      action: 'buy',
      quantity: 1000,
      price: 70.0,
      fee: 0,
      transaction_date: '2026-08-01',
      note: null,
      tags: [],
      target_price: null,
      stop_loss: null,
    },
    {
      id: '2',
      ticker: 'VNM',
      action: 'dividend_cash',
      quantity: 1000,
      price: 2.0, // 2.0 k₫ / share dividend
      fee: 0,
      transaction_date: '2026-08-20',
      note: 'Cash dividend 20%',
      tags: [],
      target_price: null,
      stop_loss: null,
    },
  ]

  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1000)
  // New total cost = 70,000 - 2,000 = 68,000 k₫ -> avg_cost = 68.0 k₫
  assert.equal(pos.avgCost, 68.0)
})

test('AVCO P&L Engine: Stock Dividend increases shares with zero cost', () => {
  const txs: RawTransaction[] = [
    {
      id: '1',
      ticker: 'MBB',
      action: 'buy',
      quantity: 1000,
      price: 24.0,
      fee: 0,
      transaction_date: '2026-08-01',
      note: null,
      tags: [],
      target_price: null,
      stop_loss: null,
    },
    {
      id: '2',
      ticker: 'MBB',
      action: 'dividend_stock',
      quantity: 200, // 20% bonus shares
      price: 0,
      fee: 0,
      transaction_date: '2026-08-20',
      note: 'Stock dividend 20%',
      tags: [],
      target_price: null,
      stop_loss: null,
    },
  ]

  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1200)
  // Total cost = 24,000 k₫ -> new avg_cost = 24,000 / 1200 = 20.0 k₫
  assert.equal(pos.avgCost, 20.0)
})
