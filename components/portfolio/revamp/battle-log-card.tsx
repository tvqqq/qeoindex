"use client"

import Link from "next/link"
import { Check, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { RawTransaction, TransactionAction } from "@/modules/portfolio/pnl"
import { cn } from "@/modules/shared/ui/cn"

export interface BattleLogCardProps {
  transaction: RawTransaction
  isConfirming: boolean
  isDeleting: boolean
  onRequestDelete: (id: string) => void
  onCancelDelete: () => void
  onDelete: (id: string) => Promise<void>
}

function actionLabel(action: TransactionAction) {
  switch (action) {
    case "buy": return "Mua"
    case "sell": return "Bán"
    case "dividend_cash": return "Cổ tức tiền"
    case "dividend_stock": return "Cổ tức CP"
    case "rights": return "Quyền mua"
  }
}

function actionClasses(action: TransactionAction) {
  switch (action) {
    case "buy": return "border-[var(--color-up)]/30 bg-[var(--color-up-dim)] text-[var(--color-up)]"
    case "sell": return "border-[var(--color-down)]/30 bg-[var(--color-down-dim)] text-[var(--color-down)]"
    case "dividend_cash": return "border-[var(--color-ref)]/30 bg-[var(--color-ref-dim)] text-[var(--color-ref)]"
    case "dividend_stock": return "border-[var(--color-floor)]/30 bg-[var(--color-floor-dim)] text-[var(--color-floor)]"
    case "rights": return "border-[var(--color-ceiling)]/30 bg-[var(--color-ceiling-dim)] text-[var(--color-ceiling)]"
  }
}

function formatLegacyStatus(transaction: RawTransaction) {
  if (transaction.record_origin !== "legacy_pre_trade_domain") return null
  const migrationStatus = transaction.legacy_migration_status
  if (migrationStatus === "deterministic_grouped" || migrationStatus === "manually_reviewed") {
    return "Legacy · đã nhóm"
  }
  return "Legacy · chưa nhóm Trade"
}

export function BattleLogCard({
  transaction,
  isConfirming,
  isDeleting,
  onRequestDelete,
  onCancelDelete,
  onDelete,
}: BattleLogCardProps) {
  const legacyLabel = formatLegacyStatus(transaction)
  const tags = [...(transaction.setup_tags ?? []), ...(transaction.mistake_tags ?? [])]

  return (
    <article className="rounded-3xl border border-white/[0.08] bg-[#0d1017] p-4 shadow-[0_16px_45px_rgba(0,0,0,0.2)] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/insights/wyckoff?ticker=${transaction.ticker}`}
              prefetch={false}
              className="font-ticker text-lg font-black uppercase tracking-wide text-purple-200 hover:text-purple-100"
            >
              {transaction.ticker}
            </Link>
            <span className={cn("rounded-full border px-2.5 py-1 text-xs font-black", actionClasses(transaction.action))}>
              {actionLabel(transaction.action)}
            </span>
            {legacyLabel ? (
              <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-200">
                {legacyLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">{transaction.transaction_date}</p>
        </div>

        {isConfirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-xs"
              variant="destructive"
              aria-label={`Xác nhận xóa giao dịch ${transaction.ticker}`}
              disabled={isDeleting}
              onClick={() => void onDelete(transaction.id)}
              className="h-10 w-10"
            >
              <Check className="size-4" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Hủy xóa"
              disabled={isDeleting}
              onClick={onCancelDelete}
              className="h-10 w-10 text-slate-400 hover:text-white"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Xóa giao dịch ${transaction.ticker}`}
            onClick={() => onRequestDelete(transaction.id)}
            className="h-10 w-10 shrink-0 rounded-full text-slate-500 hover:bg-[var(--color-down)]/10 hover:text-[var(--color-down)]"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Fact label="Khối lượng" value={transaction.quantity.toLocaleString("vi-VN")} />
        <Fact
          label="Giá"
          value={transaction.action === "dividend_stock" ? "–" : `${transaction.price.toFixed(1)} k₫`}
        />
        <Fact label="Phí" value={`${transaction.fee > 0 ? transaction.fee.toFixed(1) : "0"} k₫`} />
      </div>

      {transaction.note ? (
        <p className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-sm italic leading-6 text-slate-300">
          “{transaction.note}”
        </p>
      ) : null}

      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(transaction.setup_tags ?? []).map((tag) => (
            <span key={`setup-${tag}`} className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2.5 py-1 text-xs font-bold text-purple-200">
              {tag}
            </span>
          ))}
          {(transaction.mistake_tags ?? []).map((tag) => (
            <span key={`mistake-${tag}`} className="rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-200">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {transaction.record_origin === "legacy_pre_trade_domain" ? (
        <p className="mt-3 text-xs leading-5 text-amber-100/70">
          Provenance: {transaction.record_origin} · {transaction.legacy_migration_status ?? "unknown"}
        </p>
      ) : null}
    </article>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/20 px-3 py-3">
      <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="mt-1 block text-sm font-black tabular-nums text-white">{value}</span>
    </div>
  )
}
