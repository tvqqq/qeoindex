"use client"

import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { Sparkline } from "@/components/sparkline"

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

const SPARK_COLORS = { up: "#21d99a", down: "#f2495c", ref: "#e2b93b" }

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
  if (typeof value !== "number") return "text-muted-2"
  if (value > 0) return "text-up"
  if (value < 0) return "text-down"
  return "text-ref"
}

function sparkColor(value?: number) {
  if (typeof value !== "number" || value === 0) return SPARK_COLORS.ref
  return value > 0 ? SPARK_COLORS.up : SPARK_COLORS.down
}

function formatChangePercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

export function LiveStockRow({ stock, quote, history, onOpen }: { stock: LiveBoardStock; quote?: LiveStockQuote; history: number[]; onOpen: () => void }) {
  const color = boardPctClass(quote?.changePercent)
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen() }
    }} className="group grid cursor-pointer grid-cols-[38px_60px_minmax(76px,1fr)_56px] items-center gap-1 rounded-md border border-transparent px-1.5 py-1.5 transition-colors hover:border-border-strong hover:bg-panel-2/70 focus:outline-none focus:ring-1 focus:ring-brand" title={`Mở sổ lệnh ${stock.ticker}`}>
      <div>
        <div className="font-mono text-[12px] font-bold text-foreground">{stock.ticker}</div>
        <div className="text-[9px] text-muted-2">#{stock.rank}</div>
      </div>
      <div className="flex justify-center">
        <Sparkline data={history} refValue={quote?.reference ?? undefined} color={sparkColor(quote?.changePercent)} width={56} height={28} strokeWidth={1.6} showDot />
      </div>
      <div className="min-w-0 text-right">
        <div className={`truncate font-mono text-[12px] font-semibold ${quote ? color : "text-muted-2"}`}>{formatBoardPrice(quote?.price)}</div>
        <div className="mt-0.5 truncate text-[9px] text-muted-2">KL {formatBoardVolume(quote?.volume)}{!quote && stock.lastClose ? ` · Close ${formatBoardPrice(stock.lastClose)}` : ""}</div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-0.5">
        <span className={`truncate font-mono text-[9px] font-semibold ${quote ? color : "text-muted"}`} title={quote ? "% thay đổi so với giá mở cửa phiên" : "Chờ dữ liệu realtime"}>{quote ? formatChangePercent(quote.changePercent) : "Chờ"}</span>
        <Link href={`/research/${stock.ticker.toLowerCase()}`} onClick={(event) => event.stopPropagation()} className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100" aria-label={`Mở phân tích ${stock.ticker}`}><ExternalLink className="h-2.5 w-2.5" /></Link>
      </div>
    </div>
  )
}

export function LiveMoverCard({ stock, quote, history, onOpen }: { stock: LiveBoardStock; quote?: LiveStockQuote; history: number[]; onOpen: () => void }) {
  const color = boardPctClass(quote?.changePercent)
  return (
    <button type="button" onClick={onOpen} className="grid min-h-[92px] grid-cols-[90px_1fr_92px] items-center gap-3 rounded-2xl border border-border bg-panel px-4 py-3 text-left transition-all hover:border-brand/60 hover:bg-panel-2/70">
      <div>
        <div className="font-mono text-xl font-bold text-foreground">{stock.ticker}</div>
        <div className="mt-1 font-mono text-xs text-muted-2">{formatBoardVolume(quote?.volume)}</div>
        <div className="mt-1 text-[10px] text-muted">#{stock.rank} · {stock.sector}</div>
      </div>
      <div className="flex justify-center">
        <Sparkline data={history} refValue={quote?.reference ?? undefined} color={sparkColor(quote?.changePercent)} width={150} height={48} strokeWidth={2.1} showDot />
      </div>
      <div className="text-right">
        <div className={`font-mono text-lg font-bold ${quote ? color : "text-muted-2"}`}>{quote ? formatChangePercent(quote.changePercent) : "—"}</div>
        <div className={`mt-1 font-mono text-sm ${quote ? color : "text-muted-2"}`}>{formatBoardPrice(quote?.price)}</div>
        <div className="mt-1 text-[10px] text-muted">So với giá mở cửa · bấm mở sổ lệnh</div>
      </div>
    </button>
  )
}
