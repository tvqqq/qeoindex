'use client'

import React, { memo, useMemo, useState } from 'react'
import Link from 'next/link'
import { PlusIcon, ArrowUpIcon, ArrowDownIcon, MinusIcon } from 'lucide-react'

import { PortfolioPosition } from '@/lib/portfolio/pnl'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatVND(kVND: number): string {
  const abs = Math.abs(kVND)
  if (abs >= 1_000_000) return `${(kVND / 1_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000) return `${(kVND / 1_000).toFixed(1)} triệu`
  return `${kVND.toFixed(0)} k₫`
}

function formatQty(qty: number): string {
  return qty.toLocaleString('vi-VN')
}

type SortKey = 'marketValue' | 'unrealizedPnl' | 'unrealizedPnlPct' | 'ticker'
type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Row data (derived)
// ---------------------------------------------------------------------------

interface PositionRow extends PortfolioPosition {
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PnlChipProps {
  value: number
}

const PnlChip = memo(function PnlChip({ value }: PnlChipProps) {
  const isUp = value > 0
  const isDown = value < 0
  const bg = isUp
    ? 'bg-[var(--color-up-dim)]'
    : isDown
    ? 'bg-[var(--color-down-dim)]'
    : 'bg-white/5'
  const text = isUp
    ? 'text-[var(--color-up)]'
    : isDown
    ? 'text-[var(--color-down)]'
    : 'text-[var(--color-muted-2)]'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-ticker text-xs',
        bg,
        text,
      )}
    >
      {isUp ? (
        <ArrowUpIcon className="size-2.5 shrink-0" />
      ) : isDown ? (
        <ArrowDownIcon className="size-2.5 shrink-0" />
      ) : (
        <MinusIcon className="size-2.5 shrink-0" />
      )}
      {formatVND(value)}
    </span>
  )
})

interface PctCellProps {
  pct: number
}

const PctCell = memo(function PctCell({ pct }: PctCellProps) {
  const isUp = pct > 0
  const isDown = pct < 0
  const color = isUp
    ? 'text-[var(--color-up)]'
    : isDown
    ? 'text-[var(--color-down)]'
    : 'text-[var(--color-muted-2)]'
  const prefix = isUp ? '▲' : isDown ? '▼' : '–'

  return (
    <span className={cn('font-ticker text-xs', color)}>
      {prefix}
      {Math.abs(pct).toFixed(2)}%
    </span>
  )
})

interface PriceCellProps {
  currentPrice: number
  avgCost: number
}

const PriceCell = memo(function PriceCell({ currentPrice, avgCost }: PriceCellProps) {
  const isUp = currentPrice > avgCost
  const isDown = currentPrice < avgCost
  const color = isUp
    ? 'text-[var(--color-up)]'
    : isDown
    ? 'text-[var(--color-down)]'
    : 'text-foreground'

  return (
    <span className={cn('font-ticker text-xs tabular-nums', color)}>
      {currentPrice.toFixed(1)}
    </span>
  )
})

// ---------------------------------------------------------------------------
// Position row (memoized — re-renders only when derived values change)
// ---------------------------------------------------------------------------

interface PositionRowProps {
  row: PositionRow
  onAddTransaction: (ticker: string) => void
}

const PositionTableRow = memo(
  function PositionTableRow({ row, onAddTransaction }: PositionRowProps) {
    const {
      ticker,
      openQty,
      avgCost,
      currentPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      targetPrice,
      stopLoss,
    } = row

    return (
      <TableRow className="liquid-glass-row h-10 border-b border-[var(--color-border)]">
        {/* Mã */}
        <TableCell className="py-0 pl-3 pr-2">
          <Link
            href={`/insights/wyckoff?ticker=${ticker}`}
            prefetch={false}
            className="font-bold uppercase tracking-wide text-foreground hover:text-[var(--color-up)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {ticker}
          </Link>
        </TableCell>

        {/* KL */}
        <TableCell className="py-0 px-2 text-right">
          <span className="font-ticker text-xs text-[var(--color-muted-2)] tabular-nums">
            {formatQty(openQty)}
          </span>
        </TableCell>

        {/* Giá vốn TB */}
        <TableCell className="py-0 px-2 text-right">
          <span className="font-ticker text-xs text-[var(--color-muted-2)] tabular-nums">
            {avgCost.toFixed(1)}
          </span>
        </TableCell>

        {/* Giá TT */}
        <TableCell className="py-0 px-2 text-right">
          <PriceCell currentPrice={currentPrice} avgCost={avgCost} />
        </TableCell>

        {/* Giá trị TT */}
        <TableCell className="py-0 px-2 text-right">
          <span className="font-ticker text-xs tabular-nums text-[var(--color-muted-2)]">
            {formatVND(marketValue)}
          </span>
        </TableCell>

        {/* Lãi/Lỗ */}
        <TableCell className="py-0 px-2 text-right">
          <PnlChip value={unrealizedPnl} />
        </TableCell>

        {/* % */}
        <TableCell className="py-0 px-2 text-right">
          <PctCell pct={unrealizedPnlPct} />
        </TableCell>

        {/* Target / SL */}
        <TableCell className="py-0 px-2">
          <div className="flex items-center gap-1">
            {targetPrice != null && (
              <TooltipProvider delay={200}>
                <Tooltip>
                  <TooltipTrigger>
                    <span className="inline-flex items-center rounded border border-[var(--color-up)]/30 bg-[var(--color-up-dim)] px-1 py-0 font-ticker text-[10px] text-[var(--color-up)] tabular-nums">
                      T {targetPrice.toFixed(1)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Giá mục tiêu: {targetPrice.toFixed(2)} k₫</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {stopLoss != null && (
              <TooltipProvider delay={200}>
                <Tooltip>
                  <TooltipTrigger>
                    <span className="inline-flex items-center rounded border border-[var(--color-down)]/30 bg-[var(--color-down-dim)] px-1 py-0 font-ticker text-[10px] text-[var(--color-down)] tabular-nums">
                      SL {stopLoss.toFixed(1)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Stop-loss: {stopLoss.toFixed(2)} k₫</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {targetPrice == null && stopLoss == null && (
              <span className="text-[10px] text-[var(--color-muted-2)]">–</span>
            )}
          </div>
        </TableCell>

        {/* Actions */}
        <TableCell className="py-0 pl-2 pr-3 text-right">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Thêm giao dịch ${ticker}`}
            onClick={() => onAddTransaction(ticker)}
            className="text-[var(--color-muted-2)] hover:text-foreground"
          >
            <PlusIcon />
          </Button>
        </TableCell>
      </TableRow>
    )
  },
  (prev, next) =>
    prev.row.ticker === next.row.ticker &&
    prev.row.currentPrice === next.row.currentPrice &&
    prev.row.openQty === next.row.openQty &&
    prev.row.avgCost === next.row.avgCost &&
    prev.row.unrealizedPnl === next.row.unrealizedPnl &&
    prev.row.targetPrice === next.row.targetPrice &&
    prev.row.stopLoss === next.row.stopLoss &&
    prev.onAddTransaction === next.onAddTransaction,
)

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <TableRow className="h-10 border-b border-[var(--color-border)]">
      {Array.from({ length: 9 }).map((_, i) => (
        <TableCell key={i} className="py-0 px-2">
          <div className="h-3 animate-pulse rounded bg-white/10" />
        </TableCell>
      ))}
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// Sort icon
// ---------------------------------------------------------------------------

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-0.5 text-[var(--color-muted-2)] opacity-40">↕</span>
  return (
    <span className="ml-0.5 text-[var(--color-muted-2)]">{dir === 'asc' ? '↑' : '↓'}</span>
  )
}

interface SortableHeadProps {
  label: string
  colKey: SortKey
  active: boolean
  dir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}

function SortableHead({
  label,
  colKey,
  active,
  dir,
  onSort,
  className,
}: SortableHeadProps) {
  return (
    <TableHead
      className={cn(
        'cursor-pointer select-none py-0 text-[11px] text-[var(--color-muted-2)] hover:text-foreground',
        className,
      )}
      onClick={() => onSort(colKey)}
    >
      {label}
      <SortIcon active={active} dir={dir} />
    </TableHead>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface PortfolioPositionsTableProps {
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  loading: boolean
  onAddTransaction: (ticker?: string) => void
}

export function PortfolioPositionsTable({
  positions,
  currentPrices,
  loading,
  onAddTransaction,
}: PortfolioPositionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('marketValue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Derive rows with computed metrics
  const rows = useMemo<PositionRow[]>(() => {
    return positions.map((pos) => {
      const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
      const marketValue = currentPrice * pos.openQty
      const unrealizedPnl = (currentPrice - pos.avgCost) * pos.openQty
      const unrealizedPnlPct =
        pos.avgCost > 0 ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100 : 0
      return { ...pos, currentPrice, marketValue, unrealizedPnl, unrealizedPnlPct }
    })
  }, [positions, currentPrices])

  // Sorted rows
  const sorted = useMemo<PositionRow[]>(() => {
    const mult = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'ticker':
          return mult * a.ticker.localeCompare(b.ticker)
        case 'unrealizedPnl':
          return mult * (a.unrealizedPnl - b.unrealizedPnl)
        case 'unrealizedPnlPct':
          return mult * (a.unrealizedPnlPct - b.unrealizedPnlPct)
        case 'marketValue':
        default:
          return mult * (a.marketValue - b.marketValue)
      }
    })
  }, [rows, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // Empty state
  if (!loading && positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[#0b0f13] py-12 text-center">
        <p className="text-sm text-[var(--color-muted-2)]">Chưa có vị thế nào đang mở.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAddTransaction()}
          className="gap-1.5"
        >
          <PlusIcon className="size-3.5" />
          Thêm giao dịch đầu tiên
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[#0b0f13] overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="h-8 border-b border-[var(--color-border)] hover:bg-transparent">
            <SortableHead
              label="Mã"
              colKey="ticker"
              active={sortKey === 'ticker'}
              dir={sortDir}
              onSort={handleSort}
              className="pl-3 pr-2 text-left"
            />
            <TableHead className="py-0 px-2 text-right text-[11px] text-[var(--color-muted-2)]">
              KL
            </TableHead>
            <TableHead className="py-0 px-2 text-right text-[11px] text-[var(--color-muted-2)]">
              Giá vốn TB
            </TableHead>
            <TableHead className="py-0 px-2 text-right text-[11px] text-[var(--color-muted-2)]">
              Giá TT
            </TableHead>
            <SortableHead
              label="Giá trị TT"
              colKey="marketValue"
              active={sortKey === 'marketValue'}
              dir={sortDir}
              onSort={handleSort}
              className="px-2 text-right"
            />
            <SortableHead
              label="Lãi/Lỗ"
              colKey="unrealizedPnl"
              active={sortKey === 'unrealizedPnl'}
              dir={sortDir}
              onSort={handleSort}
              className="px-2 text-right"
            />
            <SortableHead
              label="%"
              colKey="unrealizedPnlPct"
              active={sortKey === 'unrealizedPnlPct'}
              dir={sortDir}
              onSort={handleSort}
              className="px-2 text-right"
            />
            <TableHead className="py-0 px-2 text-[11px] text-[var(--color-muted-2)]">
              Target/SL
            </TableHead>
            <TableHead className="py-0 pl-2 pr-3 text-right text-[11px] text-[var(--color-muted-2)]">
              &nbsp;
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            : sorted.map((row) => (
                <PositionTableRow
                  key={row.ticker}
                  row={row}
                  onAddTransaction={onAddTransaction}
                />
              ))}
        </TableBody>
      </Table>
    </div>
  )
}
