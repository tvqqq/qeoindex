"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  Activity,
  BarChart3,
  GripVertical,
  Maximize2,
  Minimize2,
  Minus,
  RefreshCw,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { IndexMinuteChart } from "@/components/index-chart/index-minute-chart"
import { useIndexCandles } from "@/components/index-chart/use-index-candles"
import {
  INDEX_CHART_RESOLUTIONS,
  INDEX_CHART_RESOLUTION_LABELS,
  type CandleBar,
  type IndexChartResolution,
  type IndexChartSymbol,
} from "@/lib/index-candles"

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
const DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const DEFAULT_WIDTH = 1480
const DEFAULT_HEIGHT = 840
const MIN_WIDTH = 760
const MIN_HEIGHT = 520
const EDGE_GAP = 8
const MINIMIZED_HEIGHT = 64

type ResizeHandle = "e" | "s" | "se"

function formatPrice(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? PRICE_FORMATTER.format(value) : "—"
}

function formatVolume(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? VOLUME_FORMATTER.format(value) : "—"
}

function dateKey(time: number) {
  return DATE_KEY_FORMATTER.format(new Date(time * 1000))
}

function sessionMeta(bars: CandleBar[]) {
  if (!bars.length) return { open: undefined as number | undefined, sessionCount: 0 }
  const latestSession = dateKey(bars[bars.length - 1].time)
  const sessionCount = new Set(bars.map((bar) => dateKey(bar.time))).size
  const firstLatest = bars.find((bar) => dateKey(bar.time) === latestSession)
  return { open: firstLatest?.open, sessionCount }
}

function ChartCard({
  symbol,
  bars,
  resolution,
  loading,
  error,
}: {
  symbol: IndexChartSymbol
  bars: CandleBar[]
  resolution: IndexChartResolution
  loading: boolean
  error?: string
}) {
  const current = bars.at(-1)
  const { open: sessionOpen, sessionCount } = useMemo(() => sessionMeta(bars), [bars])
  const change = current && sessionOpen ? current.close - sessionOpen : 0
  const changePercent = current && sessionOpen ? (change / sessionOpen) * 100 : 0
  const tone = change > 0 ? "text-emerald-400" : change < 0 ? "text-rose-400" : "text-amber-300"
  const title = symbol === "VNINDEX" ? "VN-INDEX" : "VN30F1M"
  const subtitle = symbol === "VNINDEX" ? "Thị trường cơ sở" : "Phái sinh tháng gần nhất"
  const timeframeLabel = INDEX_CHART_RESOLUTION_LABELS[resolution]

  return (
    <section className="flex min-h-[390px] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#080c10] shadow-[0_18px_50px_-28px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] bg-white/[0.025] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-ticker text-sm font-extrabold tracking-wide text-white">{title}</span>
            <span className="rounded-md border border-cyan-400/20 bg-cyan-400/8 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300">{timeframeLabel}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            {subtitle}{sessionCount > 1 ? ` · ${sessionCount} phiên lịch sử` : ""}
          </div>
        </div>

        <div className="text-right">
          <div className="font-mono text-[18px] font-extrabold tracking-tight text-white">{formatPrice(current?.close)}</div>
          {current && sessionOpen ? (
            <div className={`font-mono text-[10px] font-bold ${tone}`} title="Biến động so với giá mở cửa của phiên mới nhất">
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
            <span className="ml-auto hidden text-slate-600 sm:inline">
              {bars.length} nến · {sessionCount} phiên · {DATE_FORMATTER.format(new Date(current.time * 1000))}
            </span>
          </div>
        ) : null}
      </div>

      <div className="relative min-h-[300px] flex-1">
        {bars.length ? (
          <IndexMinuteChart symbol={symbol} data={bars} resolution={resolution} />
        ) : loading ? (
          <div className="absolute inset-0 overflow-hidden bg-[#080c10] p-5">
            <div className="h-full animate-pulse rounded-xl bg-[linear-gradient(110deg,rgba(255,255,255,0.025),rgba(255,255,255,0.065),rgba(255,255,255,0.025))] bg-[length:200%_100%]" />
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm">
              <Activity className="mx-auto mb-3 h-6 w-6 text-slate-600" />
              <div className="text-xs font-semibold text-slate-300">Chưa có dữ liệu nến {timeframeLabel}</div>
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

function initialSize() {
  if (typeof window === "undefined") return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  return {
    width: Math.min(DEFAULT_WIDTH, Math.max(360, window.innerWidth - EDGE_GAP * 2)),
    height: Math.min(DEFAULT_HEIGHT, Math.max(420, window.innerHeight - EDGE_GAP * 2)),
  }
}

function initialPosition(size: { width: number; height: number }) {
  if (typeof window === "undefined") return { x: EDGE_GAP, y: EDGE_GAP }
  return {
    x: Math.max(EDGE_GAP, Math.floor((window.innerWidth - size.width) / 2)),
    y: Math.max(EDGE_GAP, Math.floor((window.innerHeight - size.height) / 2)),
  }
}

export function IndexChartModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [resolution, setResolution] = useState<IndexChartResolution>("1")
  const { candles, isLoading, isRefreshing, errors, generatedAt, lastLiveAt, refresh } = useIndexCandles(open, resolution)
  const firstSizeRef = useRef(initialSize())
  const [size, setSize] = useState(firstSizeRef.current)
  const [pos, setPos] = useState(() => initialPosition(firstSizeRef.current))
  const [isMaximized, setIsMaximized] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const isLive = lastLiveAt > 0 && Date.now() - lastLiveAt < 20_000
  const hasAnyData = candles.VNINDEX.length > 0 || candles.VN30F1M.length > 0

  useEffect(() => {
    if (!open) return
    const clamp = () => {
      if (isMaximized) return
      const minWidth = Math.min(MIN_WIDTH, Math.max(360, window.innerWidth - EDGE_GAP * 2))
      const minHeight = Math.min(MIN_HEIGHT, Math.max(360, window.innerHeight - EDGE_GAP * 2))
      setSize((current) => {
        const width = Math.max(minWidth, Math.min(current.width, window.innerWidth - EDGE_GAP * 2))
        const height = Math.max(minHeight, Math.min(current.height, window.innerHeight - EDGE_GAP * 2))
        setPos((currentPos) => ({
          x: Math.max(EDGE_GAP, Math.min(currentPos.x, window.innerWidth - width - EDGE_GAP)),
          y: Math.max(EDGE_GAP, Math.min(currentPos.y, window.innerHeight - (isMinimized ? MINIMIZED_HEIGHT : height) - EDGE_GAP)),
        }))
        return { width, height }
      })
    }
    clamp()
    window.addEventListener("resize", clamp)
    return () => window.removeEventListener("resize", clamp)
  }, [open, isMaximized, isMinimized])

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isMaximized) return
    const target = event.target as HTMLElement
    if (target.closest("[data-chart-action]")) return
    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    const startPosX = pos.x
    const startPosY = pos.y
    let curX = startPosX
    let curY = startPosY
    let rafId: number | null = null

    const move = (pointerEvent: PointerEvent) => {
      curX = Math.max(0, Math.min(window.innerWidth - 200, startPosX + pointerEvent.clientX - startX))
      curY = Math.max(0, Math.min(window.innerHeight - MINIMIZED_HEIGHT, startPosY + pointerEvent.clientY - startY))
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        if (!panelRef.current) return
        panelRef.current.style.left = `${curX}px`
        panelRef.current.style.top = `${curY}px`
      })
    }

    const end = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      setPos({ x: curX, y: curY })
    }

    window.addEventListener("pointermove", move, { passive: true })
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }, [isMaximized, pos.x, pos.y])

  const startResize = useCallback((handle: ResizeHandle, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isMaximized || isMinimized) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const startWidth = size.width
    const startHeight = size.height
    const minWidth = Math.min(MIN_WIDTH, Math.max(360, window.innerWidth - EDGE_GAP * 2))
    const minHeight = Math.min(MIN_HEIGHT, Math.max(360, window.innerHeight - EDGE_GAP * 2))
    let curWidth = startWidth
    let curHeight = startHeight
    let rafId: number | null = null

    const move = (pointerEvent: PointerEvent) => {
      const dx = pointerEvent.clientX - startX
      const dy = pointerEvent.clientY - startY
      if (handle === "e" || handle === "se") {
        curWidth = Math.max(minWidth, Math.min(window.innerWidth - pos.x - EDGE_GAP, startWidth + dx))
      }
      if (handle === "s" || handle === "se") {
        curHeight = Math.max(minHeight, Math.min(window.innerHeight - pos.y - EDGE_GAP, startHeight + dy))
      }
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        if (!panelRef.current) return
        panelRef.current.style.width = `${curWidth}px`
        panelRef.current.style.height = `${curHeight}px`
      })
    }

    const end = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      setSize({ width: curWidth, height: curHeight })
    }

    window.addEventListener("pointermove", move, { passive: true })
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }, [isMaximized, isMinimized, pos.x, pos.y, size.height, size.width])

  const toggleMaximized = useCallback(() => {
    setIsMinimized(false)
    setIsMaximized((value) => !value)
  }, [])

  const toggleMinimized = useCallback(() => {
    setIsMaximized(false)
    setIsMinimized((value) => !value)
  }, [])

  const popupStyle = isMaximized
    ? {
        left: EDGE_GAP,
        top: EDGE_GAP,
        width: `calc(100vw - ${EDGE_GAP * 2}px)`,
        height: `calc(100vh - ${EDGE_GAP * 2}px)`,
      }
    : {
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: isMinimized ? MINIMIZED_HEIGHT : size.height,
      }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/72 backdrop-blur-[5px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="pointer-events-none fixed inset-0 z-[81]">
          <Dialog.Popup
            ref={panelRef}
            style={popupStyle}
            className="pointer-events-auto fixed flex max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[22px] border border-white/[0.12] bg-[#070a0e]/98 shadow-[0_35px_120px_rgba(0,0,0,0.9),0_0_70px_rgba(34,201,138,0.06),inset_0_1px_0_rgba(255,255,255,0.08)] outline-none transition-shadow duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
          >
            <header
              onPointerDown={startDrag}
              onDoubleClick={(event) => {
                if (!(event.target as HTMLElement).closest("[data-chart-action]")) toggleMaximized()
              }}
              className={`flex h-16 shrink-0 select-none flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-[linear-gradient(110deg,rgba(34,201,138,0.07),rgba(8,12,16,0.96)_34%,rgba(168,85,247,0.055))] px-4 sm:px-5 ${isMaximized ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="hidden text-slate-600 sm:block"><GripVertical className="h-4 w-4" /></div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(34,201,138,0.12)]">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-sm font-extrabold tracking-tight text-white sm:text-base">VN Market · Multi-timeframe</Dialog.Title>
                  <Dialog.Description className="mt-0.5 hidden text-[10px] text-slate-500 sm:block sm:text-[11px]">
                    VN-INDEX cơ sở và VN30F1M phái sinh · OHLCV DNSE
                  </Dialog.Description>
                </div>
              </div>

              <div data-chart-action className="ml-auto flex items-center gap-1.5 sm:gap-2">
                <div className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold md:flex ${
                  isLive
                    ? "border-emerald-400/25 bg-emerald-400/8 text-emerald-300"
                    : hasAnyData
                      ? "border-cyan-400/20 bg-cyan-400/7 text-cyan-300"
                      : "border-white/[0.1] bg-white/[0.035] text-slate-400"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
                  {isLive ? "DNSE LIVE" : hasAnyData ? "DNSE HISTORY" : "ĐANG KẾT NỐI"}
                </div>
                {generatedAt ? (
                  <span className="hidden font-mono text-[9px] text-slate-600 lg:inline">{TIME_FORMATTER.format(new Date(generatedAt))}</span>
                ) : null}
                <button
                  type="button"
                  onClick={refresh}
                  disabled={isRefreshing}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-slate-400 transition hover:border-cyan-400/25 hover:bg-cyan-400/8 hover:text-cyan-300 disabled:opacity-50"
                  aria-label="Làm mới dữ liệu biểu đồ"
                  title="Làm mới history snapshot"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={toggleMinimized}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
                  aria-label={isMinimized ? "Khôi phục cửa sổ" : "Thu nhỏ cửa sổ"}
                  title={isMinimized ? "Khôi phục" : "Thu nhỏ"}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={toggleMaximized}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
                  aria-label={isMaximized ? "Khôi phục kích thước" : "Phóng to toàn màn hình"}
                  title={isMaximized ? "Khôi phục kích thước" : "Phóng to"}
                >
                  {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </button>
                <Dialog.Close
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.035] text-slate-400 transition hover:border-rose-400/25 hover:bg-rose-400/8 hover:text-rose-300"
                  aria-label="Đóng biểu đồ"
                >
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>
            </header>

            {!isMinimized ? (
              <>
                <div data-chart-action className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/[0.06] bg-white/[0.018] px-3 py-2 sm:px-4">
                  <span className="mr-1 hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600 sm:inline">Timeframe</span>
                  {INDEX_CHART_RESOLUTIONS.map((value) => {
                    const active = value === resolution
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setResolution(value)}
                        aria-pressed={active}
                        className={`min-w-11 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] font-bold transition ${
                          active
                            ? "border-emerald-400/35 bg-emerald-400/12 text-emerald-300 shadow-[0_0_16px_rgba(34,201,138,0.08)]"
                            : "border-white/[0.08] bg-white/[0.025] text-slate-500 hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-slate-300"
                        }`}
                      >
                        {INDEX_CHART_RESOLUTION_LABELS[value]}
                      </button>
                    )
                  })}
                  <span className="ml-auto hidden text-[9px] text-slate-600 md:inline">
                    Intraday: giờ trên trục X · ngày đánh dấu tại đầu phiên
                  </span>
                </div>

                <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 sm:p-4 lg:grid-cols-2 lg:gap-4">
                  <ChartCard symbol="VNINDEX" bars={candles.VNINDEX} resolution={resolution} loading={isLoading} error={errors.VNINDEX} />
                  <ChartCard symbol="VN30F1M" bars={candles.VN30F1M} resolution={resolution} loading={isLoading} error={errors.VN30F1M} />
                </main>

                <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] bg-white/[0.015] px-4 py-2 text-[9px] text-slate-600 sm:px-5">
                  <span>History theo timeframe từ DNSE; realtime được hợp nhất từ luồng 1m. Kéo chart sang trái để xem lịch sử.</span>
                  <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="transition hover:text-slate-400">
                    TradingView Lightweight Charts™ · Copyright © 2025 TradingView, Inc.
                  </a>
                </footer>

                {!isMaximized ? (
                  <>
                    <div
                      onPointerDown={(event) => startResize("e", event)}
                      className="absolute bottom-3 right-0 top-16 z-20 w-1.5 cursor-ew-resize"
                      aria-hidden="true"
                    />
                    <div
                      onPointerDown={(event) => startResize("s", event)}
                      className="absolute bottom-0 left-3 right-3 z-20 h-1.5 cursor-ns-resize"
                      aria-hidden="true"
                    />
                    <div
                      onPointerDown={(event) => startResize("se", event)}
                      className="absolute bottom-0 right-0 z-30 h-5 w-5 cursor-nwse-resize rounded-br-[20px] border-b-2 border-r-2 border-white/20"
                      aria-hidden="true"
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
