"use client"

import React, { useState, useMemo } from "react"
import Link from "next/link"
import { Check, Trash2, X } from "lucide-react"

import { RawTransaction, TransactionAction } from "@/modules/portfolio/pnl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface PortfolioTransactionHistoryProps {
  transactions: RawTransaction[]
  onDelete: (id: string) => Promise<void>
  onEdit: (transaction: RawTransaction) => void
  loading?: boolean
}

function ActionBadge({ action }: { action: TransactionAction }) {
  switch (action) {
    case "buy":
      return (
        <span className="inline-flex items-center rounded-md bg-[var(--color-up-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-up)] border border-[var(--color-up)]/30">
          Mua
        </span>
      )
    case "sell":
      return (
        <span className="inline-flex items-center rounded-md bg-[var(--color-down-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-down)] border border-[var(--color-down)]/30">
          Bán
        </span>
      )
    case "dividend_cash":
      return (
        <span className="inline-flex items-center rounded-md bg-[var(--color-ref-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-ref)] border border-[var(--color-ref)]/30">
          Cổ tức tiền
        </span>
      )
    case "dividend_stock":
      return (
        <span className="inline-flex items-center rounded-md bg-[var(--color-floor-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-floor)] border border-[var(--color-floor)]/30">
          Cổ tức CP
        </span>
      )
    case "rights":
      return (
        <span className="inline-flex items-center rounded-md bg-[var(--color-ceiling-dim)] px-2 py-0.5 font-ticker text-[11px] font-bold text-[var(--color-ceiling)] border border-[var(--color-ceiling)]/30">
          Quyền mua
        </span>
      )
  }
}

export function PortfolioTransactionHistory({
  transactions,
  onDelete,
  loading = false,
}: PortfolioTransactionHistoryProps) {
  const [selectedTicker, setSelectedTicker] = useState<string>("all")
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Unique tickers list for quick filtering
  const tickers = useMemo(() => {
    const set = new Set<string>()
    for (const t of transactions) set.add(t.ticker)
    return Array.from(set).sort()
  }, [transactions])

  const filteredTransactions = useMemo(() => {
    const list = selectedTicker === "all"
      ? transactions
      : transactions.filter((t) => t.ticker === selectedTicker)
    // Sort descending by date
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
      {/* Ticker filter pills */}
      {tickers.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)] mr-1">
            Lọc mã:
          </span>
          <button
            type="button"
            onClick={() => setSelectedTicker("all")}
            className={cn(
              "font-ticker rounded-full border px-3 py-1 text-xs font-bold uppercase transition-colors cursor-pointer",
              selectedTicker === "all"
                ? "border-purple-500/50 bg-purple-500/20 text-purple-300"
                : "border-[var(--color-border)] text-[var(--color-muted-2)] hover:border-white/20 hover:text-white",
            )}
          >
            Tất cả ({transactions.length})
          </button>
          {tickers.map((t) => {
            const count = transactions.filter((tx) => tx.ticker === t).length
            return (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedTicker(t)}
                className={cn(
                  "font-ticker rounded-full border px-3 py-1 text-xs font-bold uppercase transition-colors cursor-pointer",
                  selectedTicker === t
                    ? "border-purple-500/50 bg-purple-500/20 text-purple-300"
                    : "border-[var(--color-border)] text-[var(--color-muted-2)] hover:border-white/20 hover:text-white",
                )}
              >
                {t} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Transactions table */}
      <div className="overflow-x-auto rounded-2xl border border-[#252837] bg-[#0d0f17]">
        <Table>
          <TableHeader>
            <TableRow className="h-9 border-b border-[var(--color-border)] hover:bg-transparent">
              <TableHead className="py-0 pl-3 pr-2 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                Ngày GD
              </TableHead>
              <TableHead className="py-0 px-2 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                Mã
              </TableHead>
              <TableHead className="py-0 px-2 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                Loại
              </TableHead>
              <TableHead className="py-0 px-2 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                Khối lượng
              </TableHead>
              <TableHead className="py-0 px-2 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                Giá (k₫)
              </TableHead>
              <TableHead className="py-0 px-2 text-right font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                Phí (k₫)
              </TableHead>
              <TableHead className="py-0 px-2 text-left font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                Ghi chú & Thẻ Tags
              </TableHead>
              <TableHead className="py-0 pl-2 pr-3 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.map((tx) => {
              const isConfirming = deleteConfirmId === tx.id
              const isDeleting = deletingId === tx.id

              return (
                <TableRow
                  key={tx.id}
                  className="h-11 border-b border-[var(--color-border)] last:border-b-0 hover:bg-white/[0.04] transition-colors"
                >
                  {/* Ngày */}
                  <TableCell className="py-0 pl-3 pr-2">
                    <span className="font-ticker text-xs sm:text-sm font-semibold text-[var(--color-muted-2)] tabular-nums">
                      {tx.transaction_date}
                    </span>
                  </TableCell>

                  {/* Mã */}
                  <TableCell className="py-0 px-2">
                    <Link
                      href={`/insights/wyckoff?ticker=${tx.ticker}`}
                      prefetch={false}
                      className="font-ticker text-sm font-black uppercase tracking-wider text-purple-300 hover:text-purple-200 transition-colors"
                    >
                      {tx.ticker}
                    </Link>
                  </TableCell>

                  {/* Loại */}
                  <TableCell className="py-0 px-2">
                    <ActionBadge action={tx.action} />
                  </TableCell>

                  {/* Khối lượng */}
                  <TableCell className="py-0 px-2 text-right">
                    <span className="font-ticker text-xs sm:text-sm font-bold text-white tabular-nums">
                      {tx.quantity.toLocaleString("vi-VN")}
                    </span>
                  </TableCell>

                  {/* Giá */}
                  <TableCell className="py-0 px-2 text-right">
                    <span className="font-ticker text-xs sm:text-sm font-bold text-white tabular-nums">
                      {tx.action === "dividend_stock" ? "–" : tx.price.toFixed(1)}
                    </span>
                  </TableCell>

                  {/* Phí */}
                  <TableCell className="py-0 px-2 text-right">
                    <span className="font-ticker text-xs font-medium text-[var(--color-muted-2)] tabular-nums">
                      {tx.fee > 0 ? tx.fee.toFixed(1) : "0"}
                    </span>
                  </TableCell>

                  {/* Ghi chú & Tags */}
                  <TableCell className="py-0 px-2">
                    <div className="flex flex-col gap-1 max-w-[280px]">
                      {tx.note && (
                        <span className="font-ticker text-xs text-slate-300 truncate italic">
                          &ldquo;{tx.note}&rdquo;
                        </span>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {tx.setup_tags &&
                          tx.setup_tags.map((st) => (
                            <span
                              key={st}
                              className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/30"
                            >
                              {st}
                            </span>
                          ))}
                        {tx.mistake_tags &&
                          tx.mistake_tags.map((mt) => (
                            <span
                              key={mt}
                              className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 border border-rose-500/30"
                            >
                              {mt}
                            </span>
                          ))}
                      </div>
                    </div>
                  </TableCell>

                  {/* Actions (Delete with inline confirm) */}
                  <TableCell className="py-0 pl-2 pr-3 text-right">
                    {isConfirming ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-xs"
                          variant="destructive"
                          aria-label="Xác nhận xóa"
                          disabled={isDeleting}
                          onClick={() => handleDelete(tx.id)}
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
                        onClick={() => setDeleteConfirmId(tx.id)}
                        className="h-7 w-7 rounded-full text-[var(--color-muted-2)] hover:text-[var(--color-down)] hover:bg-[var(--color-down)]/10"
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
    </div>
  )
}
