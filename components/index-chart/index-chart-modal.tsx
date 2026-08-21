"use client"

import { Dialog } from "@base-ui/react/dialog"
import { Activity, BarChart3, RefreshCw, X } from "lucide-react"
import { IndexMinuteChart } from "@/components/index-chart/index-minute-chart"
import { useIndexCandles } from "@/components/index-chart/use-index-candles"
import type { CandleBar, IndexChartSymbol } from "@/lib/index-candles"

const PRICE_FORMATTER = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 2 })
const VOLUME_FORMATTER = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 })
const TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})
const DATE_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

function formatPrice(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? PRICE_FORMATTER.format(value) : "—"
}

function formatVolume(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? VOLUME_FORMATTER.format(value) : "—"
}

function ChartCard({ symbol, bars, loading, error }: {
  symbol: IndexChartSymbol
  bars: CandleBar[]
  loading: boolean
  error?: string
}) {
  const current = bars.at(-1)
  const sessionOpen = bars[0]?.open
  const change = current && sessionOpen ? current.close - sessionOpen : 0
  const changePercent = current && sessionOpen ? (change / sessionOpen) * 100 : 0
  const tone = change > 0 ? "text-emerald-400" : change < 0 ? "text-rose-400" : "text-amber-300"
  const title = symbol === "VNINDEX" ? "VN-INDEX" : "VN30F1M"
  const subtitle = symbol === "VNINDEX" ? "Thị trường cơ sở" : "Phái sinh tháng gần nhất"

  return (
    <section className="flex min-h-[430px] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#080c10] shadow-[0_18px_50px_-28px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] bg-white/[0.025] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-ticker text-sm font-extrabold tracking-wide text-white">{title}</span>
            <span className="rounded-md border border-cyan-400/20 bg-cyan-400/8 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300">1m</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">{subtitle}</div>
        </div>

        <div className="text-right">
          <div className="font-mono text-[18px] font-extrabold tracking-tight text-white">{formatPrice(current?.close)}</div>
          {current && sessionOpen ? (
            <div className={`font-mono text-[10px] font-bold ${tone}`} title="Biến động so với giá mở cửa của phiên đang hiển thị">
              {change > 0 ? "+" : ""}{formatPrice(change)} · {changePercent > 0 ? "+" : ""}{changePercent.toFixed(2)}% vs mở cửa
            </div>
          ) : null}
        </div>

        {current ? (
          <div className="basis-full flex flex-wrap gap-x-3 gap-y-1 border-t border-white/[0.05] pt-2 font-mono text-[9.5px] text-slate-500">
            <span>O <b className="text-slate-300">{formatPrice(current.open)}</b></span>
            <span>H <b className="text-slate-300">{formatPrice(current.high)}</b></span>
            <span>L <b className="text-slate-300">{formatPrice(current.low)}</b></span>
            <span>C <b className="text-slate-300">{formatPrice(current.close)}</b></span>
            <span>Vol <b className="text-slate-300">{formatVolume(current.volume)}</b></span>
            <span className="ml-auto hidden text-slate-600 sm:inline">{bars.length} nến · {DATE_FORMATTER.format(new Date(current.time * 1000))}</span>
          </div>
        ) : null}
      </div>

      <div className="relative min-h-[340px] flex-1">
        {bars.length ? (
          <IndexMinuteChart symbol={symbol} data={bars} />
        ) : loading ? (
          <div className="absolute inset-0 overflow-hidden bg-[#080c10] p-5">
            <div className="h-full animate-pulse rounded-xl bg-[linear-gradient(110deg,rgba(255,255,255,0.025),rgba(255,255,255,0.065),rgba(255,255,255,0.025))] bg-[length:200%_100%]" />
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm">
              <Activity className="mx-auto mb-3 h-6 w-6 text-slate-600" />
              <div className="text-xs font-semibold text-slate-300">Chưa có dữ liệu nến 1 phút</div>
              <div className="mt-1 text-[10px] leading-relaxed text-slate-500" title={error}>
                DNSE chưa trả OHLCV hợp lệ cho {title}. Hệ thống vẫn giữ chart còn lại hoạt động độc lập.
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export function IndexChartModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { candles, isLoading, isRefreshing, errors, generatedAt, lastLiveAt, refresh } = useIndexCandles(open)
  const isLive = lastLiveAt > 0 && Date.now() - lastLiveAt < 20_000
  const hasAnyData = candles.VNINDEX.length > 0 || candles.VN30F1M.length > 0

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/72 backdrop-blur-[5px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-[81] overflow-y-auto p-2 sm:p-4 lg:p-6">
          <div className="flex min-h-full items-center justify-center">
            <Dialog.Popup className="relative w-full max-w-[1560px] overflow-hidden rounded-[22px] border border-white/[0.12] bg-[#070a0e]/98 shadow-[0_35px_120px_rgba(0,0,0,0.9),0_0_70px_rgba(34,201,138,0.06),inset_0_1px_0_rgba(255,255,255,0.08)] outline-none transition duration-150 data-[ending-style]:scale-[0.985] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.985] data-[starting-style]:opacity-0">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-[linear-gradient(110deg,rgba(34,201,138,0.07),rgba(8,12,16,0.96)_34%,rgba(168,85,247,0.055))] px-4 py-3.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(34,201,138,0.12)]">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <Dialog.Title className="truncate text-sm font-extrabold tracking-tight text-white sm:text-base">VN Market · Biểu đồ 1 phút</Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">
                      VN-INDEX cơ sở và VN30F1M phái sinh · OHLCV DNSE
                    </Dialog.Description>
                  </div>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <div className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold sm:flex ${
                    isLive
                      ? "border-emerald-400/25 bg-emerald-400/8 text-emerald-300"
                      : hasAnyData
                        ? "border-cyan-400/20 bg-cyan-400/7 text-cyan-300"
                        : "border-white/[0.1] bg-white/[0.035] text-slate-400"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                    {isLive ? "DNSE LIVE" : hasAnyData ? "DNSE SNAPSHOT" : "ĐANG KẾT NỐI"}
                  </div>
                  {generatedAt ? (
                    <span className="hidden font-mono text-[9px] text-slate-600 md:inline">{TIME_FORMATTER.format(new Date(generatedAt))}</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={refresh}
                    disabled={isRefreshing}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-slate-400 transition hover:border-cyan-400/25 hover:bg-cyan-400/8 hover:text-cyan-300 disabled:opacity-50"
                    aria-label="Làm mới dữ liệu biểu đồ"
                    title="Làm mới REST snapshot"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  </button>
                  <Dialog.Close
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-slate-400 transition hover:border-rose-400/25 hover:bg-rose-400/8 hover:text-rose-300"
                    aria-label="Đóng biểu đồ"
                  >
                    <X className="h-4 w-4" />
                  </Dialog.Close>
                </div>
              </header>

              <main className="grid grid-cols-1 gap-3 p-3 sm:p-4 lg:grid-cols-2 lg:gap-4">
                <ChartCard symbol="VNINDEX" bars={candles.VNINDEX} loading={isLoading} error={errors.VNINDEX} />
                <ChartCard symbol="VN30F1M" bars={candles.VN30F1M} loading={isLoading} error={errors.VN30F1M} />
              </main>

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] bg-white/[0.015] px-4 py-2 text-[9px] text-slate-600 sm:px-5">
                <span>Realtime ưu tiên WebSocket; REST 30s là lớp bootstrap/fallback.</span>
                <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="transition hover:text-slate-400">
                  TradingView Lightweight Charts™ · Copyright © 2025 TradingView, Inc.
                </a>
              </footer>
            </Dialog.Popup>
          </div>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
