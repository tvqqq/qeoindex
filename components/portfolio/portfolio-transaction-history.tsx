"use client"

import React, { useState, useMemo } from "react"
import Link from "next/link"
import { Check, Pencil, Trash2, X } from "lucide-react"

import { RawTransaction, TransactionAction } from "@/lib/portfolio/pnl"
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
        <span className="inline-flex items-center rounded bg-[var(--color-up-dim)] px-1.5 py-0.5 font-ticker text-[10px] font-semibold text-[var(--color-up)]">
          Mua
        </span>
      )
    case "sell":
      return (
        <span className="inline-flex items-center rounded bg-[var(--color-down-dim)] px-1.5 py-0.5 font-ticker text-[10px] font-semibold text-[var(--color-down)]">
          Bán
        </span>
      )
    case "dividend_cash":
      return (
        <span className="inline-flex items-center rounded bg-[var(--color-ref-dim)] px-1.5 py-0.5 font-ticker text-[10px] font-semibold text-[var(--color-ref)]">
          Cổ tức tiền
        </span>
      )
    case "dividend_stock":
      return (
        <span className="inline-flex items-center rounded bg-[var(--color-floor-dim)] px-1.5 py-0.5 font-ticker text-[10px] font-semibold text-[var(--color-floor)]">
          Cổ tức CP
        </span>
      )
    case "rights":
      return (
        <span className="inline-flex items-center rounded bg-[var(--color-ceiling-dim)] px-1.5 py-0.5 font-ticker text-[10px] font-semibold text-[var(--color-ceiling)]">
          Quyền mua
        </span>
      )
  }
}

export function PortfolioTransactionHistory({
  transactions,
  onDelete,
  onEdit,
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
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#343748] bg-[#0d0f17] py-8 text-center">
        <p className="text-xs text-[var(--color-muted-2)]">Chưa có lịch sử giao dịch nào.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Ticker filter pills */}
      {tickers.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedTicker("all")}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              selectedTicker === "all"
                ? "border-[#7c5cff]/40 bg-[#7c5cff]/15 text-[#a997ff]"
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
                  "font-ticker rounded-full border px-2.5 py-1 text-xs font-medium uppercase transition-colors",
                  selectedTicker === t
                    ? "border-[#7c5cff]/40 bg-[#7c5cff]/15 text-[#a997ff]"
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
            <TableRow className="h-8 border-b border-[var(--color-border)] hover:bg-transparent">
              <TableHead className="py-0 pl-3 pr-2 text-left text-[11px] text-[var(--color-muted-2)]">
                Ngày GD
              </TableHead>
              <TableHead className="py-0 px-2 text-left text-[11px] text-[var(--color-muted-2)]">
                Mã
              </TableHead>
              <TableHead className="py-0 px-2 text-left text-[11px] text-[var(--color-muted-2)]">
                Loại
              </TableHead>
              <TableHead className="py-0 px-2 text-right text-[11px] text-[var(--color-muted-2)]">
                Khối lượng
              </TableHead>
              <TableHead className="py-0 px-2 text-right text-[11px] text-[var(--color-muted-2)]">
                Giá (k₫)
              </TableHead>
              <TableHead className="py-0 px-2 text-right text-[11px] text-[var(--color-muted-2)]">
                Phí (k₫)
              </TableHead>
              <TableHead className="py-0 px-2 text-left text-[11px] text-[var(--color-muted-2)]">
                Ghi chú / Tags
              </TableHead>
              <TableHead className="py-0 pl-2 pr-3 text-right text-[11px] text-[var(--color-muted-2)]">
                &nbsp;
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.map((tx) => {
              const isConfirming = deleteConfirmId === tx.id
              const isDeleting = deletingId === tx.id

              return (
                <TableRow
                  key={tx.id}
                  className="liquid-glass-row h-10 border-b border-[var(--color-border)] last:border-b-0"
                >
                  {/* Ngày */}
                  <TableCell className="py-0 pl-3 pr-2">
                    <span className="font-ticker text-xs text-[var(--color-muted-2)] tabular-nums">
                      {tx.transaction_date}
                    </span>
                  </TableCell>

                  {/* Mã */}
                  <TableCell className="py-0 px-2">
                    <Link
                      href={`/insights/wyckoff?ticker=${tx.ticker}`}
                      prefetch={false}
                      className="font-ticker font-bold uppercase tracking-wide text-foreground hover:text-[var(--color-up)]"
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
                    <span className="font-ticker text-xs font-medium text-foreground tabular-nums">
                      {tx.quantity.toLocaleString("vi-VN")}
                    </span>
                  </TableCell>

                  {/* Giá */}
                  <TableCell className="py-0 px-2 text-right">
                    <span className="font-ticker text-xs text-foreground tabular-nums">
                      {tx.action === "dividend_stock" ? "–" : tx.price.toFixed(1)}
                    </span>
                  </TableCell>

                  {/* Phí */}
                  <TableCell className="py-0 px-2 text-right">
                    <span className="font-ticker text-xs text-[var(--color-muted-2)] tabular-nums">
                      {tx.fee > 0 ? tx.fee.toFixed(1) : "0"}
                    </span>
                  </TableCell>

                  {/* Ghi chú / Tags */}
                  <TableCell className="py-0 px-2 max-w-xs truncate">
                    <div className="flex flex-wrap items-center gap-1">
                      {tx.tags && tx.tags.length > 0 && tx.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded bg-white/5 px-1 py-0.2 text-[10px] text-[var(--color-muted-2)]"
                        >
                          #{tag}
                        </span>
                      ))}
                      {tx.note && (
                        <span className="truncate text-xs text-[var(--color-muted-2)]" title={tx.note}>
                          {tx.note}
                        </span>
                      )}
                      {!tx.note && (!tx.tags || tx.tags.length === 0) && (
                        <span className="text-xs text-[var(--color-border)]">–</span>
                      )}
                    </div>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="py-0 pl-2 pr-3 text-right">
                    {isConfirming ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="destructive"
                          size="icon-xs"
                          onClick={() => handleDelete(tx.id)}
                          disabled={isDeleting}
                          className="h-6 w-6"
                          title="Xác nhận xóa"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setDeleteConfirmId(null)}
                          disabled={isDeleting}
                          className="h-6 w-6 text-[var(--color-muted-2)]"
                          title="Hủy"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon-xs" onClick={() => onEdit(tx)} className="h-7 w-7 text-slate-400 hover:bg-[#7c5cff]/10 hover:text-[#9b87ff]" title="Chỉnh sửa giao dịch" aria-label={`Chỉnh sửa giao dịch ${tx.ticker}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => setDeleteConfirmId(tx.id)} className="h-7 w-7 text-slate-400 hover:text-[var(--color-down)]" title="Xóa giao dịch" aria-label={`Xóa giao dịch ${tx.ticker}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
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
