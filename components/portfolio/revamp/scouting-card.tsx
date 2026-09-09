"use client"

import Link from "next/link"
import { Bell, ExternalLink, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PortfolioCardMotion } from "@/components/portfolio/revamp/portfolio-motion"

export interface ScoutingCardItem {
  id: string
  ticker: string
  note: string | null
  alert_price_above: number | null
  alert_price_below: number | null
  tags: string[]
}

export interface ScoutingQuote {
  price: number | null
  reference: number | null
  change: number | null
  changePercent: number | null
}

export interface ScoutingCardProps {
  item: ScoutingCardItem
  quote?: ScoutingQuote
  onRemove: (id: string) => void | Promise<void>
}

export function ScoutingCard({ item, quote, onRemove }: ScoutingCardProps) {
  const changePct = quote?.changePercent ?? null
  const isUp = changePct != null && changePct > 0
  const isDown = changePct != null && changePct < 0
  const changeLabel = changePct == null
    ? "Chưa có biến động phiên"
    : `${isUp ? "+" : ""}${changePct.toFixed(2)}% trong phiên`

  return (
    <PortfolioCardMotion>
      <article className="h-full rounded-3xl border border-white/[0.08] bg-[#0d1017] p-4 shadow-[0_16px_45px_rgba(0,0,0,0.2)] transition-[border-color,box-shadow] duration-200 hover:border-purple-400/20 hover:shadow-[0_22px_64px_rgba(75,45,125,0.18)] sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/insights/wyckoff?ticker=${item.ticker}`}
                prefetch={false}
                className="font-ticker text-xl font-black uppercase tracking-wide text-purple-200 hover:text-purple-100"
              >
                {item.ticker}
              </Link>
              <ExternalLink className="h-3.5 w-3.5 text-slate-600" />
            </div>
            <p className="mt-1 text-sm text-slate-500">{item.note ?? "Chưa có ghi chú theo dõi"}</p>
          </div>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`Xóa ${item.ticker} khỏi danh sách theo dõi`}
            onClick={() => void onRemove(item.id)}
            className="h-10 w-10 shrink-0 rounded-full text-slate-500 transition-[background-color,color,transform] duration-150 hover:scale-105 hover:bg-[var(--color-down)]/10 hover:text-[var(--color-down)]"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Fact label="Giá hiện tại" value={quote?.price == null ? "N/A" : `${quote.price.toFixed(1)} k₫`} />
          <Fact
            label="Biến động"
            value={changeLabel}
            tone={isUp ? "up" : isDown ? "down" : "ref"}
          />
        </div>

        {(item.alert_price_above != null || item.alert_price_below != null) && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-purple-500/20 bg-purple-500/[0.06] px-3 py-2.5 text-sm text-purple-100/80">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" />
            <span>
              Cảnh báo giá
              {item.alert_price_above != null ? ` > ${item.alert_price_above}` : ""}
              {item.alert_price_below != null ? ` < ${item.alert_price_below}` : ""}
              {" k₫"}
            </span>
          </div>
        )}

        {item.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-xs font-bold text-slate-300">
                {tag}
              </span>
            ))}
          </div>
        )}
      </article>
    </PortfolioCardMotion>
  )
}

function Fact({ label, value, tone = "ref" }: { label: string; value: string; tone?: "up" | "down" | "ref" }) {
  const valueClass = tone === "up"
    ? "text-[var(--color-up)]"
    : tone === "down"
      ? "text-[var(--color-down)]"
      : "text-white"

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/20 px-3 py-3">
      <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className={`mt-1 block text-sm font-black tabular-nums ${valueClass}`}>{value}</span>
    </div>
  )
}
