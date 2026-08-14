"use client"

import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { Sparkline } from "@/components/sparkline"
import {
  marketToneFromChange,
  marketToneFromPrice,
  marketToneHex,
  marketToneText,
} from "@/lib/market-tone"

export interface LiveBoardStock {
  ticker: string
  rank: number
  sector: string
  marketCapT: number
  lastClose?: number | null
  lastCloseDate?: string
}

export interface LiveStockQuote {
  symbol: string
  price: number
  reference?: number
  ceiling?: number
  floor?: number
  change?: number
  changePercent: number
  volume?: number
  updatedAt: string
}

export function formatBoardPrice(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)
}

export function formatBoardVolume(value?: number) {
  if (!value || value <= 0) return "—"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}tr`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return value.toLocaleString("vi-VN")
}

export function boardPctClass(value?: number) {
  return marketToneText(marketToneFromChange(value))
}

function quoteTone(quote?: LiveStockQuote) {
  return marketToneFromPrice({
    price: quote?.price,
    reference: quote?.reference,
    ceiling: quote?.ceiling,
    floor: quote?.floor,
  })
}

function formatChangePercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function sparkData(history: number[], quote?: LiveStockQuote) {
  const clean = history.filter((value) => Number.isFinite(value) && value > 0).slice(-89)
  if (!quote?.price || !Number.isFinite(quote.price) || quote.price <= 0) return clean
  if (!clean.length) return [quote.price]
  if (clean.at(-1) === quote.price) return clean
  return [...clean, quote.price]
}

export function LiveStockRow({ stock, quote, history, onOpen }: { stock: LiveBoardStock; quote?: LiveStockQuote; history: number[]; onOpen: () => void }) {
  const tone = quoteTone(quote)
  const text = quote ? marketToneText(tone) : "text-muted-2"
  const chart = sparkData(history, quote)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen() }
      }}
      className="group relative grid min-h-[62px] cursor-pointer grid-cols-[46px_minmax(54px,1fr)_70px] items-center gap-2 rounded-lg border border-border/70 bg-cell/75 px-2 py-2 transition-all hover:border-border-strong hover:bg-panel-2 focus:outline-none focus:ring-1 focus:ring-brand"
      title={`Mở sổ lệnh ${stock.ticker}`}
    >
      <div className="min-w-0">
        <div className="font-mono text-[14px] font-black leading-none tracking-[0.02em] text-foreground">{stock.ticker}</div>
        <div className="mt-1.5 font-mono text-[10px] leading-none text-muted-2">{formatBoardVolume(quote?.volume)}</div>
        <div className="mt-1 text-[9px] leading-none text-muted">#{stock.rank}</div>
      </div>

      <div className="flex min-w-0 items-center justify-center overflow-hidden">
        <Sparkline data={chart} refValue={quote?.reference ?? undefined} color={marketToneHex(tone)} width={66} height={32} strokeWidth={1.9} showDot />
      </div>

      <div className="flex min-w-0 flex-col items-end gap-1.5">
        <div className={`max-w-full truncate font-mono text-[13px] font-bold leading-none ${text}`}>{formatBoardPrice(quote?.price)}</div>
        {quote ? <MarketChangePill value={quote.changePercent} tone={tone} compact title="% thay đổi so với giá mở cửa phiên" /> : <span className="text-[10px] text-muted">Chờ giá</span>}
      </div>

      <Link
        href={`/research/${stock.ticker.toLowerCase()}`}
        onClick={(event) => event.stopPropagation()}
        className="absolute right-1 top-1 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-panel hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        aria-label={`Mở phân tích ${stock.ticker}`}
      >
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  )
}

export function LiveMoverCard({ stock, quote, history, onOpen }: { stock: LiveBoardStock; quote?: LiveStockQuote; history: number[]; onOpen: () => void }) {
  const tone = quoteTone(quote)
  const text = quote ? marketToneText(tone) : "text-muted-2"
  const chart = sparkData(history, quote)

  return (
    <button type="button" onClick={onOpen} className="grid min-h-[100px] grid-cols-[96px_1fr_104px] items-center gap-4 rounded-2xl border border-border bg-panel px-4 py-3 text-left transition-all hover:border-brand/60 hover:bg-panel-2/70">
      <div>
        <div className="font-mono text-xl font-black text-foreground">{stock.ticker}</div>
        <div className="mt-1 font-mono text-xs text-muted-2">{formatBoardVolume(quote?.volume)}</div>
        <div className="mt-1 text-[10px] text-muted">#{stock.rank} · {stock.sector}</div>
      </div>
      <div className="flex justify-center">
        <Sparkline data={chart} refValue={quote?.reference ?? undefined} color={marketToneHex(tone)} width={160} height={52} strokeWidth={2.2} showDot />
      </div>
      <div className="flex flex-col items-end gap-2 text-right">
        {quote ? <MarketChangePill value={quote.changePercent} tone={tone} title="% thay đổi so với giá mở cửa phiên" /> : <span className="text-muted-2">—</span>}
        <div className={`font-mono text-sm font-bold ${text}`}>{formatBoardPrice(quote?.price)}</div>
        <div className="text-[10px] text-muted">1m DNSE + live</div>
      </div>
    </button>
  )
}

export { formatChangePercent }
