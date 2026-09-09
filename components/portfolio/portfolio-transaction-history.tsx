"use client"

import React, { useMemo, useState } from "react"
import Link from "next/link"
import { Check, Trash2, X } from "lucide-react"

import { BattleLogCard } from "@/components/portfolio/revamp/battle-log-card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { RawTransaction, TransactionAction } from "@/modules/portfolio/pnl"
import { cn } from "@/modules/shared/ui/cn"

interface PortfolioTransactionHistoryProps {
  transactions: RawTransaction[]
  onDelete: (id: string) => Promise<void>
  onEdit: (transaction: RawTransaction) => void
  loading?: boolean
}

function ActionBadge({ action }: { action: TransactionAction }) {
  switch (action) {
    case "buy":
      return <span className="inline-flex items-center rounded-md border border-[var(--color-up)]/30 bg-[var(--color-up-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-up)]">Mua</span>
    case "sell":
      return <span className="inline-flex items-center rounded-md border border-[var(--color-down)]/30 bg-[var(--color-down-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-down)]">Bán</span>
    case "dividend_cash":
      return <span className="inline-flex items-center rounded-md border border-[var(--color-ref)]/30 bg-[var(--color-ref-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-ref)]">Cổ tức tiền</span>
    case "dividend_stock":
      return <span className="inline-flex items-center rounded-md border border-[var(--color-floor)]/30 bg-[var(--color-floor-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-floor)]">Cổ tức CP</span>
    case "rights":
      return <span className="inline-flex items-center rounded-md border border-[var(--color-ceiling)]/30 bg-[var(--color-ceiling-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-ceiling)]">Quyền mua</span>
  }
}

function LegacyMigrationBadge({ transaction }: { transaction: RawTransaction }) {
  if (transaction.record_origin !== "legacy_pre_trade_domain") return null
  const grouped = transaction.legacy_migration_status === "deterministic_grouped"
    || transaction.legacy_migration_status === "manually_reviewed"

  return (
    <span className="inline-flex items-center rounded-md border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
      {grouped ? "Legacy · đã nhóm" : "Legacy · chưa nhóm Trade"}
    </span>
  )
}

export function PortfolioTransactionHistory({
  transactions,
  onDelete,
  loading = false,
}: PortfolioTransactionHistoryProps) {
  const [selectedTicker, setSelectedTicker] = useState<string>("all")
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const tickers = useMemo(() => {
    const set = new Set<string>()
    for (const transaction of transactions) set.add(transaction.ticker)
    return Array.from(set).sort()
  }, [transactions])

  const hasUngroupedLegacy = useMemo(
    () => transactions.some((transaction) => (
      transaction.record_origin === "legacy_pre_trade_domain"
      && transaction.legacy_migration_status === "legacy_ungrouped"
    )),
    [transactions],
  )

  const filteredTransactions = useMemo(() => {
    const list = selectedTicker === "all"
      ? transactions
      : transactions.filter((transaction) => transaction.ticker === selectedTicker)
    return [...list].sort((a, b) => {
      if (a.transaction_date > b.transaction_date) return -1
      if (a.transaction_date < b.transaction_date) return 1
      return 0
    })
  }, [transactions, selectedTicker])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await onDelete(id)
    } finally {
      setDeletingId(null)
      setDeleteConfirmId(null)
    }
  }

  if (!loading && transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="font-ticker text-sm font-semibold text-slate-300">Chưa có giao dịch nào</p>
        <p className="mt-1 font-ticker text-xs text-[var(--color-muted-2)]">
          Ghi nhận lệnh mua/bán đầu tiên để bắt đầu lưu trữ nhật ký giao dịch.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 font-ticker">
      {tickers.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Lọc mã:</span>
          <button
            type="button"
            onClick={() => setSelectedTicker("all")}
            className={cn(
              "min-h-10 cursor-pointer rounded-full border px-3 py-1 text-xs font-bold uppercase transition-colors",
              selectedTicker === "all"
                ? "border-purple-500/50 bg-purple-500/20 text-purple-300"
                : "border-[var(--color-border)] text-[var(--color-muted-2)] hover:border-white/20 hover:text-white",
            )}
          >
            Tất cả ({transactions.length})
          </button>
          {tickers.map((ticker) => {
            const count = transactions.filter((transaction) => transaction.ticker === ticker).length
            return (
              <button
                key={ticker}
                type="button"
                onClick={() => setSelectedTicker(ticker)}
                className={cn(
                  "min-h-10 cursor-pointer rounded-full border px-3 py-1 text-xs font-bold uppercase transition-colors",
                  selectedTicker === ticker
                    ? "border-purple-500/50 bg-purple-500/20 text-purple-300"
                    : "border-[var(--color-border)] text-[var(--color-muted-2)] hover:border-white/20 hover:text-white",
                )}
              >
                {ticker} ({count})
              </button>
            )
          })}
        </div>
      )}

      {hasUngroupedLegacy && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100/80">
          Giao dịch legacy chưa nhóm vẫn được tính P&L nhưng không được đưa vào Scorecard theo Trade.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredTransactions.map((transaction) => (
          <BattleLogCard
            key={transaction.id}
            transaction={transaction}
            isConfirming={deleteConfirmId === transaction.id}
            isDeleting={deletingId === transaction.id}
            onRequestDelete={setDeleteConfirmId}
            onCancelDelete={() => setDeleteConfirmId(null)}
            onDelete={handleDelete}
          />
        ))}
      </div>

      <details className="rounded-2xl border border-[#252837] bg-[#0d0f17]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-extrabold text-slate-200">
          Chi tiết giao dịch dạng bảng
        </summary>
        <div className="overflow-x-auto border-t border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow className="h-9 border-b border-[var(--color-border)] hover:bg-transparent">
                <TableHead className="py-0 pl-3 pr-2 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Ngày GD</TableHead>
                <TableHead className="px-2 py-0 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Mã</TableHead>
                <TableHead className="px-2 py-0 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Loại</TableHead>
                <TableHead className="px-2 py-0 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Khối lượng</TableHead>
                <TableHead className="px-2 py-0 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Giá (k₫)</TableHead>
                <TableHead className="px-2 py-0 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Phí (k₫)</TableHead>
                <TableHead className="px-2 py-0 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">Ghi chú &amp; Thẻ Tags</TableHead>
                <TableHead className="py-0 pl-2 pr-3 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.map((transaction) => {
                const isConfirming = deleteConfirmId === transaction.id
                const isDeleting = deletingId === transaction.id

                return (
                  <TableRow key={transaction.id} className="h-11 border-b border-[var(--color-border)] last:border-b-0 hover:bg-white/[0.04]">
                    <TableCell className="py-0 pl-3 pr-2">
                      <span className="text-xs font-semibold tabular-nums text-[var(--color-muted-2)] sm:text-sm">{transaction.transaction_date}</span>
                    </TableCell>
                    <TableCell className="px-2 py-0">
                      <Link
                        href={`/insights/wyckoff?ticker=${transaction.ticker}`}
                        prefetch={false}
                        className="text-sm font-black uppercase tracking-wider text-purple-300 hover:text-purple-200"
                      >
                        {transaction.ticker}
                      </Link>
                    </TableCell>
                    <TableCell className="px-2 py-0">
                      <div className="flex flex-col items-start gap-1">
                        <ActionBadge action={transaction.action} />
                        <LegacyMigrationBadge transaction={transaction} />
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-0 text-right">
                      <span className="text-xs font-bold tabular-nums text-white sm:text-sm">{transaction.quantity.toLocaleString("vi-VN")}</span>
                    </TableCell>
                    <TableCell className="px-2 py-0 text-right">
                      <span className="text-xs font-bold tabular-nums text-white sm:text-sm">
                        {transaction.action === "dividend_stock" ? "–" : transaction.price.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-0 text-right">
                      <span className="text-xs font-medium tabular-nums text-[var(--color-muted-2)]">{transaction.fee > 0 ? transaction.fee.toFixed(1) : "0"}</span>
                    </TableCell>
                    <TableCell className="px-2 py-0">
                      <div className="flex max-w-[280px] flex-col gap-1">
                        {transaction.note && <span className="truncate text-xs italic text-slate-300">“{transaction.note}”</span>}
                        <div className="flex flex-wrap gap-1">
                          {(transaction.setup_tags ?? []).map((tag) => (
                            <span key={tag} className="rounded border border-purple-500/30 bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-300">{tag}</span>
                          ))}
                          {(transaction.mistake_tags ?? []).map((tag) => (
                            <span key={tag} className="rounded border border-rose-500/30 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-0 pl-2 pr-3 text-right">
                      {isConfirming ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon-xs"
                            variant="destructive"
                            aria-label="Xác nhận xóa"
                            disabled={isDeleting}
                            onClick={() => void handleDelete(transaction.id)}
                            className="h-6 w-6"
                          >
                            <Check className="size-3" />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Hủy xóa"
                            disabled={isDeleting}
                            onClick={() => setDeleteConfirmId(null)}
                            className="h-6 w-6 text-[var(--color-muted-2)] hover:text-foreground"
                          >
                            <X className="size-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Xóa giao dịch"
                          onClick={() => setDeleteConfirmId(transaction.id)}
                          className="h-7 w-7 rounded-full text-[var(--color-muted-2)] hover:bg-[var(--color-down)]/10 hover:text-[var(--color-down)]"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  )
}
