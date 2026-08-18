import { memo } from "react"
import { ExternalLink, Star } from "lucide-react"
import { MarketChangePill } from "@/components/market-change-pill"
import { Sparkline } from "@/components/sparkline"
import { TickerResearchLink } from "@/components/ticker-research-link"
import { normalizeMarketPrice } from "@/lib/intraday-5m"
import {
  marketToneFromChange,
  marketToneFromPrice,
  marketToneHex,
  marketToneText,
  type MarketTone,
} from "@/lib/market-tone"
import { usePriceFlashAnimation } from "@/lib/use-flash-animation"

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
  foreignBuyValue?: number
  foreignSellValue?: number
  foreignBuyVolume?: number
  foreignSellVolume?: number
  foreignNetValue?: number
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

export function formatForeignNetValue(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < 100_000) {
    return { text: "0b", tone: "neutral" as const }
  }
  const isBuy = value > 0
  const sign = isBuy ? "+" : "-"
  const abs = Math.abs(value)
  const inBillions = abs / 1_000_000_000

  let formattedNum = ""
  if (inBillions >= 100) {
    formattedNum = inBillions.toFixed(0)
  } else if (inBillions >= 10) {
    formattedNum = inBillions.toFixed(1)
  } else {
    formattedNum = inBillions.toFixed(2)
  }

  return {
    text: `${sign}${formattedNum}b`,
    tone: isBuy ? ("buy" as const) : ("sell" as const),
  }
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
    changePercent: quote?.changePercent,
  })
}

function formatChangePercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function sparkData(history: number[], livePrice?: number | null) {
  const valid = history.filter((value) => Number.isFinite(value) && value > 0)
  if (!valid.length && (!livePrice || !Number.isFinite(livePrice) || livePrice <= 0)) return []
  if (!valid.length && livePrice) return [livePrice, livePrice]

  const anchor = valid.at(-1)!
  const normalized = valid.slice(-90).map((price) => normalizeMarketPrice(price, anchor) ?? price)

  if (livePrice && Number.isFinite(livePrice) && livePrice > 0) {
    const liveNormalized = normalizeMarketPrice(livePrice, anchor)
    if (liveNormalized && liveNormalized > 0 && Math.abs(liveNormalized - normalized.at(-1)!) > 1e-4) {
      return [...normalized, liveNormalized]
    }
  }
  return normalized
}

function sparkReference(history: number[], reference?: number, lastClose?: number | null) {
  const valid = history.filter((value) => Number.isFinite(value) && value > 0)
  const anchor = valid.at(-1) ?? valid[0]
  if (!anchor) return undefined
  const explicit = normalizeMarketPrice(reference, anchor)
  if (explicit && explicit > 0) return explicit
  const fallback = normalizeMarketPrice(lastClose, anchor)
  if (fallback && fallback > 0) return fallback
  return undefined
}

function getGainerStyles(quote?: LiveStockQuote, tone?: MarketTone) {
  const change = quote?.changePercent ?? 0
  const isCeiling =
    tone === "ceiling" ||
    (typeof quote?.ceiling === "number" && typeof quote?.price === "number" && quote.price >= quote.ceiling - 0.05) ||
    change >= 6.85
  const isSuper = !isCeiling && change >= 5
  const isStrong = !isCeiling && !isSuper && change >= 3

  if (isCeiling) {
    return {
      rowClass: "ceiling-gainer border-purple-500/80 bg-purple-950/25",
      cardClass: "ceiling-gainer border-purple-500/80 bg-purple-950/25",
      tickerClass: "text-purple-300 font-bold",
    }
  }
  if (isSuper) {
    return {
      rowClass: "super-gainer border-emerald-400/80 bg-emerald-950/25",
      cardClass: "super-gainer border-emerald-400/80 bg-emerald-950/25",
      tickerClass: "text-emerald-300 font-bold",
    }
  }
  if (isStrong) {
    return {
      rowClass: "strong-gainer border-up/60 bg-up/5",
      cardClass: "strong-gainer border-up/60 bg-up/5",
      tickerClass: "text-up font-bold",
    }
  }
  return {
    rowClass: "border-white/[0.07]",
    cardClass: "border-white/[0.08]",
    tickerClass: "text-foreground",
  }
}

export interface LiveStockRowProps {
  stock: LiveBoardStock
  quote?: LiveStockQuote
  history: number[]
  onOpen: () => void
  isWatched?: boolean
  isWhaleActive?: boolean
  onToggleWatch?: (event: React.MouseEvent) => void
}

function areStockPropsEqual(prev: LiveStockRowProps, next: LiveStockRowProps) {
  if (prev.stock.ticker !== next.stock.ticker) return false
  if (prev.isWatched !== next.isWatched) return false
  if (prev.isWhaleActive !== next.isWhaleActive) return false
  if (prev.quote?.price !== next.quote?.price) return false
  if (prev.quote?.changePercent !== next.quote?.changePercent) return false
  if (prev.quote?.foreignNetValue !== next.quote?.foreignNetValue) return false
  if (prev.quote?.reference !== next.quote?.reference) return false
  if (prev.quote?.ceiling !== next.quote?.ceiling) return false
  if (prev.quote?.floor !== next.quote?.floor) return false
  if (prev.history.length !== next.history.length) return false
  if (prev.history.at(-1) !== next.history.at(-1)) return false
  return true
}

export const LiveStockRow = memo(function LiveStockRow({
  stock,
  quote,
  history,
  onOpen,
  isWatched,
  isWhaleActive,
  onToggleWatch,
}: LiveStockRowProps) {
  const tone = quoteTone(quote)
  const text = quote ? marketToneText(tone) : "text-muted-2"
  const chart = sparkData(history, quote?.price)
  const chartReference = sparkReference(chart, quote?.reference, stock.lastClose)
  const strongGainer = (quote?.changePercent ?? 0) >= 3
  const { rowClass, tickerClass } = getGainerStyles(quote, tone)
  const foreign = formatForeignNetValue(quote?.foreignNetValue)
  const priceFlash = usePriceFlashAnimation(quote?.price, quote?.reference)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen() }
      }}
      className={`group relative grid min-h-[58px] cursor-pointer grid-cols-[46px_minmax(42px,1fr)_64px] items-center gap-1 rounded-xl border bg-[#0d1217] px-2 py-2 transition-colors hover:bg-[#141a21] hover:border-white/[0.16] focus:outline-none focus:ring-1 focus:ring-brand ${
        isWhaleActive
          ? "whale-golden-pulse"
          : priceFlash === "up"
            ? "flash-up border-up/80"
            : priceFlash === "down"
              ? "flash-down border-down/80"
              : priceFlash === "ref"
                ? "flash-ref border-ref/80"
                : strongGainer
                  ? rowClass
                  : "border-white/[0.07]"
      }`}
      title={isWhaleActive ? `[LỆNH CÁ MẬP] Mở sổ lệnh ${stock.ticker}` : `Mở sổ lệnh ${stock.ticker}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-0.5">
          <span className={`font-mono text-[16px] leading-none tracking-[0.02em] ${tickerClass}`}>{stock.ticker}</span>
          {isWhaleActive && (
            <span className="text-[10px] leading-none animate-bounce" title="Lệnh lớn vừa khớp!">🐋</span>
          )}
          {onToggleWatch && (
            <button
              type="button"
              onClick={onToggleWatch}
              aria-label={isWatched ? `Bỏ theo dõi ${stock.ticker}` : `Theo dõi ${stock.ticker}`}
              className={`shrink-0 rounded p-0.5 transition-colors focus:outline-none focus:ring-1 focus:ring-brand ${
                isWatched
                  ? "text-amber-400 opacity-100"
                  : "text-muted opacity-0 group-hover:opacity-100 hover:text-amber-300"
              }`}
            >
              <Star className={`h-3 w-3 ${isWatched ? "fill-amber-400" : ""}`} />
            </button>
          )}
        </div>
        {/* GT Mua - Bán Khối ngoại realtime (Đỏ nhẹ khi bán ròng, Xanh nhẹ khi mua ròng, font italic) */}
        <div
          className={`mt-1 font-mono text-[9.5px] italic font-medium leading-none truncate ${
            foreign.tone === "buy" ? "text-emerald-400/90" : foreign.tone === "sell" ? "text-rose-400/90" : "text-muted-2"
          }`}
          title={`Khối ngoại ${foreign.tone === "buy" ? "Mua ròng" : foreign.tone === "sell" ? "Bán ròng" : "Ròng"}: ${foreign.text}`}
        >
          {foreign.text}
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-center overflow-hidden">
        <Sparkline data={chart} refValue={chartReference} color={marketToneHex(tone)} width={52} height={26} strokeWidth={1.8} showDot />
      </div>

      <div className="flex min-w-0 flex-col items-end gap-1.5">
        <div
          className={`max-w-full truncate font-mono text-[11px] font-semibold leading-none rounded px-0.5 transition-colors ${text} ${
            priceFlash === "up"
              ? "flash-text-up font-bold"
              : priceFlash === "down"
                ? "flash-text-down font-bold"
                : priceFlash === "ref"
                  ? "flash-text-ref font-bold"
                  : ""
          }`}
        >
          {formatBoardPrice(quote?.price)}
        </div>
        {quote ? <MarketChangePill value={quote.changePercent} tone={tone} compact title="% thay đổi so với giá tham chiếu (đóng cửa phiên trước)" /> : <span className="text-[10px] text-muted">Chờ giá</span>}
      </div>

      <TickerResearchLink
        ticker={stock.ticker}
        onClick={(event) => event.stopPropagation()}
        className="absolute right-1 top-1 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-panel hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        aria-label={`Mở phân tích ${stock.ticker}`}
      >
        <ExternalLink className="h-3 w-3" />
      </TickerResearchLink>
    </div>
  )
}, areStockPropsEqual)

export const LiveMoverCard = memo(function LiveMoverCard({
  stock,
  quote,
  history,
  onOpen,
  isWatched,
  isWhaleActive,
  onToggleWatch,
}: LiveStockRowProps) {
  const tone = quoteTone(quote)
  const text = quote ? marketToneText(tone) : "text-muted-2"
  const chart = sparkData(history, quote?.price)
  const chartReference = sparkReference(chart, quote?.reference, stock.lastClose)
  const strongGainer = (quote?.changePercent ?? 0) >= 3
  const { cardClass, tickerClass } = getGainerStyles(quote, tone)
  const foreign = formatForeignNetValue(quote?.foreignNetValue)
  const priceFlash = usePriceFlashAnimation(quote?.price, quote?.reference)

  return (
    <div
      className={`group relative grid min-h-[100px] grid-cols-[96px_1fr_104px] items-center gap-4 rounded-2xl border bg-[#0c1015] px-4 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.3)] transition-colors hover:border-white/[0.18] hover:bg-[#141a21] ${
        isWhaleActive
          ? "whale-golden-pulse"
          : priceFlash === "up"
            ? "flash-up border-up/80"
            : priceFlash === "down"
              ? "flash-down border-down/80"
              : priceFlash === "ref"
                ? "flash-ref border-ref/80"
                : strongGainer
                  ? cardClass
                  : "border-white/[0.08]"
      }`}
    >
      <button type="button" onClick={onOpen} className="absolute inset-0 rounded-2xl focus:outline-none focus:ring-1 focus:ring-brand" aria-label={`Mở sổ lệnh ${stock.ticker}`} />
      <div>
        <div className="flex items-center gap-1.5">
          <span className={`font-mono text-2xl ${tickerClass}`}>{stock.ticker}</span>
          {onToggleWatch && (
            <button
              type="button"
              onClick={onToggleWatch}
              aria-label={isWatched ? `Bỏ theo dõi ${stock.ticker}` : `Theo dõi ${stock.ticker}`}
              className={`z-10 rounded p-1 transition-colors focus:outline-none focus:ring-1 focus:ring-brand ${
                isWatched
                  ? "text-amber-400 opacity-100"
                  : "text-muted opacity-0 group-hover:opacity-100 hover:text-amber-300"
              }`}
            >
              <Star className={`h-4 w-4 ${isWatched ? "fill-amber-400" : ""}`} />
            </button>
          )}
        </div>
        <div
          className={`mt-1 font-mono text-xs italic font-semibold ${
            foreign.tone === "buy" ? "text-emerald-400/90" : foreign.tone === "sell" ? "text-rose-400/90" : "text-muted-2"
          }`}
        >
          Khối ngoại: {foreign.text}
        </div>
        <div className="mt-1 text-[10px] text-muted">{stock.sector}</div>
      </div>
      <div className="flex justify-center">
        <Sparkline data={chart} refValue={chartReference} color={marketToneHex(tone)} width={160} height={52} strokeWidth={2.2} showDot />
      </div>
      <div className="flex flex-col items-end gap-2 text-right">
        {quote ? <MarketChangePill value={quote.changePercent} tone={tone} title="% thay đổi so với giá tham chiếu (đóng cửa phiên trước)" /> : <span className="text-muted-2">—</span>}
        <div
          className={`font-mono text-xs font-semibold rounded px-1 transition-colors ${text} ${
            priceFlash === "up"
              ? "flash-text-up font-bold"
              : priceFlash === "down"
                ? "flash-text-down font-bold"
                : priceFlash === "ref"
                  ? "flash-text-ref font-bold"
                  : ""
          }`}
        >
          {formatBoardPrice(quote?.price)}
        </div>
        <div className="text-[10px] text-muted">Yahoo 5m + DNSE live</div>
      </div>
    </div>
  )
}, areStockPropsEqual)

export { formatChangePercent }