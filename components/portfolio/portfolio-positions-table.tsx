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
  if (abs >= 1_000) return `${(kVND / 1_000).toFixed(1)} tr`
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
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-ticker text-xs font-bold tabular-nums',
        bg,
        text,
      )}
    >
      {isUp ? (
        <ArrowUpIcon className="size-3 shrink-0" />
      ) : isDown ? (
        <ArrowDownIcon className="size-3 shrink-0" />
      ) : (
        <MinusIcon className="size-3 shrink-0" />
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
  const prefix = isUp ? '▲ +' : isDown ? '▼ ' : '– '

  return (
    <span className={cn('font-ticker text-xs sm:text-sm font-bold tabular-nums', color)}>
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
    ? 'text-[var(--color-up)] font-bold'
    : isDown
    ? 'text-[var(--color-down)] font-bold'
    : 'text-[var(--color-ref)] font-semibold'

  return (
    <span className={cn('font-ticker text-xs sm:text-sm tabular-nums', color)}>
      {currentPrice.toFixed(1)}
    </span>
  )
})

interface PositionRowComponentProps {
  row: PositionRow
  onAddTransaction: (ticker?: string) => void
}

const PositionRowComponent = memo(
  function PositionRowComponent({ row, onAddTransaction }: PositionRowComponentProps) {
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
      <TableRow className="h-11 border-b border-[var(--color-border)] hover:bg-white/[0.04] transition-colors">
        {/* Mã CK */}
        <TableCell className="py-0 pl-3 pr-2">
          <Link
            href={`/insights/wyckoff?ticker=${ticker}`}
            prefetch={false}
            className="font-ticker text-sm font-extrabold uppercase tracking-wider text-purple-300 hover:text-purple-200 transition-colors focus-visible:outline-none"
          >
            {ticker}
          </Link>
        </TableCell>

        {/* KL */}
        <TableCell className="py-0 px-2 text-right">
          <span className="font-ticker text-xs sm:text-sm font-semibold text-slate-300 tabular-nums">
            {formatQty(openQty)}
          </span>
        </TableCell>

        {/* Giá vốn TB */}
        <TableCell className="py-0 px-2 text-right">
          <span className="font-ticker text-xs sm:text-sm font-semibold text-[var(--color-muted-2)] tabular-nums">
            {avgCost.toFixed(1)}
          </span>
        </TableCell>

        {/* Giá TT */}
        <TableCell className="py-0 px-2 text-right">
          <PriceCell currentPrice={currentPrice} avgCost={avgCost} />
        </TableCell>

        {/* Giá trị TT */}
        <TableCell className="py-0 px-2 text-right">
          <span className="font-ticker text-xs sm:text-sm font-bold tabular-nums text-slate-200">
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
          <div className="flex items-center gap-1.5">
            {targetPrice != null && (
              <TooltipProvider delay={200}>
                <Tooltip>
                  <TooltipTrigger>
                    <span className="inline-flex items-center rounded-md border border-[var(--color-up)]/30 bg-[var(--color-up-dim)] px-1.5 py-0.5 font-ticker text-[10px] font-bold text-[var(--color-up)] tabular-nums">
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
                    <span className="inline-flex items-center rounded-md border border-[var(--color-down)]/30 bg-[var(--color-down-dim)] px-1.5 py-0.5 font-ticker text-[10px] font-bold text-[var(--color-down)] tabular-nums">
                      SL {stopLoss.toFixed(1)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Stop-loss: {stopLoss.toFixed(2)} k₫</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {targetPrice == null && stopLoss == null && (
              <span className="text-xs text-[var(--color-muted-2)]">–</span>
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
            className="text-[var(--color-muted-2)] hover:text-white hover:bg-white/10 rounded-full"
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
    <TableRow className="h-11 border-b border-[var(--color-border)]">
      {Array.from({ length: 9 }).map((_, i) => (
        <TableCell key={i} className="py-0 px-2">
          <div className="h-3.5 animate-pulse rounded bg-white/10" />
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
        'cursor-pointer select-none py-0 font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)] hover:text-white transition-colors',
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
// Main component props
// ---------------------------------------------------------------------------

export interface PortfolioPositionsTableProps {
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  loading: boolean
  onAddTransaction: (ticker?: string) => void
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const PortfolioPositionsTable = memo(function PortfolioPositionsTable({
  positions,
  currentPrices,
  loading,
  onAddTransaction,
}: PortfolioPositionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('marketValue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // Derive rows with current prices and computed P&L
  const rows: PositionRow[] = useMemo(() => {
    return positions.map((pos) => {
      const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
      const marketValue = currentPrice * pos.openQty
      const unrealizedPnl = (currentPrice - pos.avgCost) * pos.openQty
      const unrealizedPnlPct =
        pos.avgCost > 0 ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100 : 0

      return {
        ...pos,
        currentPrice,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
      }
    })
  }, [positions, currentPrices])

  // Sort rows client-side
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      let valA: number | string = a[sortKey]
      let valB: number | string = b[sortKey]

      if (typeof valA === 'string') {
        valA = (valA as string).toLowerCase()
        valB = (valB as string).toLowerCase()
        return sortDir === 'asc'
          ? (valA as string).localeCompare(valB as string)
          : (valB as string).localeCompare(valA as string)
      }

      return sortDir === 'asc'
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number)
    })
  }, [rows, sortKey, sortDir])

  if (!loading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="font-ticker text-sm font-semibold text-slate-300">Chưa có vị thế nào</p>
        <p className="mt-1 font-ticker text-xs text-[var(--color-muted-2)]">
          Bấm &ldquo;Thêm giao dịch&rdquo; để ghi nhận lệnh mua đầu tiên vào danh mục.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="h-9 border-b border-[var(--color-border)] hover:bg-transparent">
            <SortableHead
              label="Mã"
              colKey="ticker"
              active={sortKey === 'ticker'}
              dir={sortDir}
              onSort={handleSort}
              className="pl-3 pr-2"
            />
            <TableHead className="py-0 px-2 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
              KL
            </TableHead>
            <TableHead className="py-0 px-2 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
              Giá vốn
            </TableHead>
            <TableHead className="py-0 px-2 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
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
            <TableHead className="py-0 px-2 font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
              Target / SL
            </TableHead>
            <TableHead className="py-0 pl-2 pr-3 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            sortedRows.map((row) => (
              <PositionRowComponent
                key={row.ticker}
                row={row}
                onAddTransaction={onAddTransaction}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
})
