import test from 'node:test'
import assert from 'node:assert/strict'

import { computePortfolioPositions, calculatePositionSizing, type RawTransaction } from '../lib/portfolio/pnl.ts'

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
  assert.equal(pos.avgCost, 25.0) // avgCost unchanged for remaining shares
  // Realized PnL = (30.0 - 25.0) * 1000 - 50 = 5000 - 50 = 4950 k₫
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
      price: 2.0, // 2.0 k₫/CP dividend = 2,000 VND/share
      fee: 100.0, // 5% withholding tax = 100 k₫
      transaction_date: '2026-08-15',
      note: 'Cash dividend 20%',
      tags: [],
      target_price: null,
      stop_loss: null,
    },
  ]

  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1000)
  // Net dividend = 1000 * 2.0 - 100 = 1900 k₫
  // New total cost = 70000 - 1900 = 68100 k₫
  // New avg cost = 68.1 k₫
  assert.equal(pos.avgCost, 68.1)
})

test('AVCO P&L Engine: Stock Dividend increases shares and dilutes avg cost', () => {
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
      transaction_date: '2026-08-15',
      note: 'Stock dividend 20%',
      tags: [],
      target_price: null,
      stop_loss: null,
    },
  ]

  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.openQty, 1200)
  // Total cost remains 24,000 k₫, new avg cost = 24000 / 1200 = 20.0 k₫
  assert.equal(pos.avgCost, 20.0)
})

test('AVCO P&L Engine: Multi-target, multi-stoploss and Setup/Mistake tags', () => {
  const txs: RawTransaction[] = [
    {
      id: '1',
      ticker: 'SSI',
      action: 'buy',
      quantity: 1000,
      price: 32.0,
      fee: 15.0,
      transaction_date: '2026-08-01',
      note: 'Breakout vượt nền',
      tags: [],
      setup_tags: ['Breakout KL lớn', 'Mô hình VCP'],
      mistake_tags: [],
      target_price_1: 38.0,
      target_price_2: 42.0,
      target_price_3: 45.0,
      stop_loss_1: 29.5,
      stop_loss_2: 28.0,
    },
  ]

  const summary = computePortfolioPositions(txs)
  const pos = summary.positions[0]
  assert.equal(pos.targetPrice1, 38.0)
  assert.equal(pos.targetPrice2, 42.0)
  assert.equal(pos.targetPrice3, 45.0)
  assert.equal(pos.stopLoss1, 29.5)
  assert.equal(pos.stopLoss2, 28.0)
  assert.deepEqual(pos.setupTags, ['Breakout KL lớn', 'Mô hình VCP'])
})

test('Position Sizing Engine: Fixed Fractional Account Risk calculation', () => {
  // Account = 1 tỷ (1,000,000,000 VND), max risk = 1.5% NAV (= 15,000,000 VND), stoploss = 7.5%, price = 25.0 k₫
  const sizing = calculatePositionSizing({
    initialCapital: 1_000_000_000,
    accountRiskPct: 1.5,
    tradeStopLossPct: 7.5,
    entryPrice: 25.0,
  })

  assert.equal(sizing.maxRiskAmount, 15_000_000)
  assert.equal(sizing.allocatedCapital, 200_000_000) // 15,000,000 / 0.075 = 200 tr
  assert.equal(sizing.allocationPctOfNav, 20.0) // 20% NAV
  assert.equal(sizing.maxShares, 8000) // 200,000,000 / (25 * 1000) = 8,000 shares
})
