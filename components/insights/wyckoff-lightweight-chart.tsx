"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { AiLoader } from "@/components/smoothui/ai-loader"
import {
  loadLightweightCharts,
  type LightweightChartApi,
  type LightweightPriceLineApi,
  type LightweightSeriesApi,
  type LightweightSeriesMarkersApi,
} from "@/lib/lightweight-charts-runtime"
import type { WyckoffChartStudy, WyckoffScenario } from "@/lib/wyckoff-chart-model"
import { cn } from "@/lib/utils"

function pricePrecision(value: number) {
  if (value >= 1000) return { precision: 0, minMove: 1 }
  if (value >= 100) return { precision: 1, minMove: 0.1 }
  if (value >= 10) return { precision: 2, minMove: 0.01 }
  return { precision: 3, minMove: 0.001 }
}

function numericLevels(value: string) {
  return (value.match(/[0-9][0-9,.]*/g) ?? [])
    .map((item) => Number(item.replaceAll(",", "")))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 1 : 2 })
}

function formatMetric(value: number | null | undefined, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toFixed(2).replace(/\.00$/, "")}${suffix}`
}

type ScenarioKey = "bull" | "base" | "bear"

type ChartController = {
  chart: LightweightChartApi
  candles: LightweightSeriesApi
  volume: LightweightSeriesApi
  markers: LightweightSeriesMarkersApi | null
  scenarioSeries: Record<ScenarioKey, LightweightSeriesApi>
  priceLines: LightweightPriceLineApi[]
}

function scenarioKey(value: string): ScenarioKey | null {
  if (value === "bull" || value === "base" || value === "bear") return value
  return null
}

function scenarioTextTone(key: WyckoffScenario["key"]) {
  if (key === "bull") return "text-emerald-300"
  if (key === "bear") return "text-rose-300"
  return "text-amber-200"
}

function scenarioBorderTone(key: WyckoffScenario["key"]) {
  if (key === "bull") return "border-emerald-400/14 bg-emerald-400/[0.025]"
  if (key === "bear") return "border-rose-400/14 bg-rose-400/[0.025]"
  return "border-amber-300/14 bg-amber-300/[0.025]"
}

function clearPriceLines(controller: ChartController) {
  for (const line of controller.priceLines) controller.candles.removePriceLine?.(line)
  controller.priceLines = []
}

function applyStudy(controller: ChartController, study: WyckoffChartStudy) {
  const latest = study.bars.at(-1)
  if (!latest) return
  const format = pricePrecision(latest.close)
  const intraday = study.timeframe === "1H" || study.timeframe === "4H"

  controller.chart.applyOptions({
    timeScale: {
      timeVisible: intraday,
      secondsVisible: false,
      rightOffset: 8,
      barSpacing: intraday ? 8 : 9,
      minBarSpacing: 2,
    },
  })
  controller.candles.applyOptions({ priceFormat: { type: "price", ...format } })
  controller.candles.setData(study.bars.map((bar) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close })))
  controller.volume.setData(study.bars.map((bar) => ({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? "rgba(34,201,138,0.28)" : "rgba(255,71,87,0.28)",
  })))
  controller.chart.panes()[1]?.setHeight(84)
  controller.markers?.setMarkers(study.markers.map((marker) => ({
    time: marker.time,
    position: marker.tone === "bearish" ? "aboveBar" : "belowBar",
    color: marker.tone === "bullish" ? "#22c98a" : marker.tone === "bearish" ? "#ff477c" : "#a7b0bd",
    shape: marker.tone === "bullish" ? "arrowUp" : marker.tone === "bearish" ? "arrowDown" : "circle",
    text: marker.label,
    size: 1.25,
  })))

  clearPriceLines(controller)
  if (study.analysis) {
    for (const price of numericLevels(study.analysis.support).slice(0, 1)) {
      const line = controller.candles.createPriceLine?.({
        price,
        color: "rgba(34,201,138,0.82)",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "Hỗ trợ",
      })
      if (line) controller.priceLines.push(line)
    }
    for (const price of numericLevels(study.analysis.resistance).slice(0, 1)) {
      const line = controller.candles.createPriceLine?.({
        price,
        color: "rgba(255,71,87,0.82)",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "Kháng cự",
      })
      if (line) controller.priceLines.push(line)
    }
  }

  for (const series of Object.values(controller.scenarioSeries)) series.setData([])
  for (const scenario of study.scenarios) {
    const key = scenarioKey(scenario.key)
    if (!key) continue
    const series = controller.scenarioSeries[key]
    series.applyOptions({
      color: scenario.color,
      lineWidth: key === "base" ? 2 : 3,
      lineStyle: 0,
      lineType: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: true,
      title: `${scenario.label} ${scenario.probability}%`,
      priceFormat: { type: "price", ...format },
    })
    series.setData(scenario.path.map((point) => ({ time: point.time, value: point.value })))
  }

  const visible = study.timeframe === "1M" ? 84 : study.timeframe === "1W" ? 150 : 180
  const last = study.bars.length - 1
  controller.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-0.5, last - visible + 1), to: last + 8 })
}

function WyckoffIntelligence({ study }: { study: WyckoffChartStudy }) {
  const analysis = study.analysis
  if (!analysis) return null
  const tags = analysis.tags.slice(0, 6)
  const relVolume = analysis.technical.relVolume
  const rsi = analysis.technical.rsi14

  return (
    <div data-wyckoff-intelligence className="space-y-3 border-t border-white/[0.08] bg-[#070b11] p-3 font-ticker sm:p-4">
      <div className="grid gap-3 xl:grid-cols-2">
        <section data-wyckoff-signal-panel className="rounded-lg border border-purple-400/14 bg-purple-400/[0.025] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-purple-300">Wyckoff signals</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-500">Evidence đang kích hoạt trên {study.timeframe}; signal là dấu hiệu xác suất, không phải lệnh giao dịch.</div>
            </div>
            <span className="rounded border border-white/[0.08] bg-white/[0.035] px-2 py-1 font-mono text-[10px] font-bold text-slate-300">{analysis.confidence}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.length ? tags.map((tag) => <span key={tag} className="rounded border border-purple-300/15 bg-purple-300/[0.05] px-2 py-1 text-[10px] font-bold text-purple-200">{tag}</span>) : <span className="text-[10.5px] text-slate-600">Chưa có Wyckoff event đủ điều kiện gắn nhãn.</span>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"><div className="text-[9.5px] uppercase tracking-wide text-slate-600">Bias</div><div className="mt-0.5 font-mono text-[11px] font-black text-slate-200">{analysis.taBias}</div></div>
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"><div className="text-[9.5px] uppercase tracking-wide text-slate-600">Rel Volume</div><div className="mt-0.5 font-mono text-[11px] font-black text-slate-200">{formatMetric(relVolume, "x")}</div></div>
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"><div className="text-[9.5px] uppercase tracking-wide text-slate-600">RSI 14</div><div className="mt-0.5 font-mono text-[11px] font-black text-slate-200">{formatMetric(rsi)}</div></div>
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"><div className="text-[9.5px] uppercase tracking-wide text-slate-600">Markers</div><div className="mt-0.5 font-mono text-[11px] font-black text-slate-200">{study.markers.length}</div></div>
          </div>
          <p className="mt-3 text-[10.5px] leading-5 text-slate-500">{analysis.whatChanged}</p>
        </section>

        <section data-wyckoff-key-levels className="rounded-lg border border-amber-300/14 bg-amber-300/[0.025] p-3">
          <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-amber-300">Vùng giá then chốt</div>
          <div className="mt-1 text-[11px] leading-5 text-slate-500">Đọc như decision zones. Đường hỗ trợ/kháng cự gần nhất đã được vẽ trực tiếp trên chart.</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-emerald-400/12 bg-emerald-400/[0.025] px-3 py-2"><div className="text-[9.5px] font-bold uppercase tracking-wide text-emerald-400/80">Hỗ trợ / Demand</div><div className="mt-1 break-words font-mono text-[13px] font-black text-emerald-200">{analysis.support || "—"}</div></div>
            <div className="rounded border border-rose-400/12 bg-rose-400/[0.025] px-3 py-2"><div className="text-[9.5px] font-bold uppercase tracking-wide text-rose-400/80">Kháng cự / Supply</div><div className="mt-1 break-words font-mono text-[13px] font-black text-rose-200">{analysis.resistance || "—"}</div></div>
          </div>
          <div className="mt-2 space-y-2 text-[10.5px] leading-5">
            <div className="rounded border border-cyan-400/10 bg-cyan-400/[0.02] px-3 py-2 text-slate-500"><strong className="text-cyan-300">Break → Hold → Test → Follow-through:</strong> {analysis.confirmation}</div>
            <div className="rounded border border-rose-400/10 bg-rose-400/[0.02] px-3 py-2 text-slate-500"><strong className="text-rose-300">Structural invalidation:</strong> {analysis.invalidation}</div>
          </div>
        </section>
      </div>

      <section data-wyckoff-horizon-outlook className="rounded-lg border border-cyan-400/14 bg-cyan-400/[0.02] p-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-cyan-300">Kịch bản theo thời gian</div>
            <p className="mt-1 text-[10.5px] leading-5 text-slate-500">1D → trong tuần · 1W → trong tháng · 1M → dài hạn. Mỗi xác suất là conditional analytical allocation và thay đổi khi evidence thay đổi.</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2.5 xl:grid-cols-3">
          {study.outlooks.map((outlook) => (
            <article key={outlook.key} className="rounded-lg border border-white/[0.07] bg-[#080d14] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-wide text-white">{outlook.label}</div>
                  <div className="mt-0.5 font-mono text-[9.5px] text-slate-600">Nguồn {outlook.sourceTimeframe} · {outlook.confidence ?? "N/A"}</div>
                </div>
                <span className="rounded border border-white/[0.07] bg-white/[0.025] px-2 py-1 text-[9.5px] font-bold text-slate-400">{outlook.bias ?? "Pending"}</span>
              </div>
              <div className="mt-2 line-clamp-2 min-h-8 text-[10.5px] leading-4 text-slate-500">{outlook.phase}</div>
              <div className="mt-2 space-y-1.5">
                {outlook.scenarios.map((scenario) => (
                  <div key={`${outlook.key}-${scenario.key}`} className={cn("rounded border px-2.5 py-2", scenarioBorderTone(scenario.key))}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("text-[10px] font-extrabold uppercase tracking-wide", scenarioTextTone(scenario.key))}>{scenario.label}</span>
                      <span className="font-mono text-[11px] font-black text-slate-100">{scenario.probability}% · {formatPrice(scenario.target)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[9.5px] leading-4 text-slate-600">{scenario.description}</p>
                  </div>
                ))}
                {!outlook.scenarios.length ? <div className="rounded border border-white/[0.06] px-2.5 py-3 text-center text-[10px] text-slate-600">Chưa đủ dữ liệu để dựng kịch bản.</div> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export function WyckoffLightweightChart({
  ticker,
  study,
  loading = false,
  embedded = false,
}: {
  ticker: string
  study: WyckoffChartStudy
  loading?: boolean
  embedded?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<ChartController | null>(null)
  const updateFrameRef = useRef(0)
  const settleFrameRef = useRef(0)
  const [chartReady, setChartReady] = useState(false)
  const [readyKey, setReadyKey] = useState("")
  const [runtimeError, setRuntimeError] = useState("")

  const renderKey = useMemo(() => {
    const firstBar = study.bars[0]
    const lastBar = study.bars.at(-1)
    const scenarioSignature = study.scenarios.map((scenario) => `${scenario.key}:${scenario.probability}:${scenario.path.at(-1)?.value ?? ""}`).join(",")
    return [ticker, study.timeframe, study.bars.length, firstBar?.time ?? 0, lastBar?.time ?? 0, lastBar?.open ?? 0, lastBar?.high ?? 0, lastBar?.low ?? 0, lastBar?.close ?? 0, lastBar?.volume ?? 0, study.analysis?.support ?? "", study.analysis?.resistance ?? "", study.analysis?.bullProbability ?? 0, study.analysis?.baseProbability ?? 0, study.analysis?.bearProbability ?? 0, study.markers.length, scenarioSignature].join("|")
  }, [study, ticker])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let resizeFrame = 0
    let chart: LightweightChartApi | null = null
    let resizeObserver: ResizeObserver | null = null

    void (async () => {
      try {
        const lwc = await loadLightweightCharts()
        if (cancelled || !hostRef.current) return
        const width = Math.max(1, Math.floor(host.clientWidth))
        const height = Math.max(1, Math.floor(host.clientHeight))
        chart = lwc.createChart(host, {
          width,
          height,
          layout: {
            attributionLogo: true,
            background: { type: lwc.ColorType.Solid, color: "#070b11" },
            textColor: "#82909d",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            panes: { separatorColor: "rgba(255,255,255,0.07)", separatorHoverColor: "rgba(34,201,138,0.28)", enableResize: true },
          },
          grid: {
            vertLines: { visible: false },
            horzLines: { visible: false },
          },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.08, bottom: 0.1 } },
          timeScale: { borderColor: "rgba(255,255,255,0.08)", secondsVisible: false, rightOffset: 8, minBarSpacing: 2 },
          localization: { locale: "vi-VN" },
          crosshair: {
            vertLine: { color: "rgba(148,163,184,0.28)", labelBackgroundColor: "#334155" },
            horzLine: { color: "rgba(148,163,184,0.28)", labelBackgroundColor: "#334155" },
          },
          handleScroll: {
            mouseWheel: false,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: false,
          },
          // Zoom is intentionally disabled. Continuous scale redraws trigger
          // Chromium flicker on scaled 4K external displays, while zoom adds
          // little value to this fixed-window Wyckoff workspace.
          handleScale: false,
        })
        const candles = chart.addSeries(lwc.CandlestickSeries, {
          upColor: "#22c98a",
          downColor: "#ff4757",
          wickUpColor: "rgba(34,201,138,0.68)",
          wickDownColor: "rgba(255,71,87,0.68)",
          borderVisible: false,
          priceLineVisible: false,
          lastValueVisible: true,
        }, 0)
        const volume = chart.addSeries(lwc.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1)
        const markers = lwc.createSeriesMarkers?.(candles, []) ?? null
        const scenarioSeries = {
          bull: chart.addSeries(lwc.LineSeries, { priceLineVisible: false, crosshairMarkerVisible: false }, 0),
          base: chart.addSeries(lwc.LineSeries, { priceLineVisible: false, crosshairMarkerVisible: false }, 0),
          bear: chart.addSeries(lwc.LineSeries, { priceLineVisible: false, crosshairMarkerVisible: false }, 0),
        }
        controllerRef.current = { chart, candles, volume, markers, scenarioSeries, priceLines: [] }

        resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame)
          resizeFrame = requestAnimationFrame(() => {
            const currentHost = hostRef.current
            const currentChart = controllerRef.current?.chart
            if (!currentHost || !currentChart) return
            currentChart.applyOptions({ width: Math.max(1, Math.floor(currentHost.clientWidth)), height: Math.max(1, Math.floor(currentHost.clientHeight)) })
          })
        })
        resizeObserver?.observe(host)
        setChartReady(true)
      } catch (error) {
        if (!cancelled) setRuntimeError(error instanceof Error ? error.message : "Không thể khởi tạo biểu đồ Wyckoff")
      }
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      cancelAnimationFrame(resizeFrame)
      cancelAnimationFrame(updateFrameRef.current)
      cancelAnimationFrame(settleFrameRef.current)
      controllerRef.current = null
      chart?.remove()
    }
  }, [])

  useEffect(() => {
    if (!chartReady || !study.bars.length) return
    const controller = controllerRef.current
    if (!controller) return
    cancelAnimationFrame(updateFrameRef.current)
    cancelAnimationFrame(settleFrameRef.current)
    updateFrameRef.current = requestAnimationFrame(() => {
      try {
        applyStudy(controller, study)
        setRuntimeError("")
        settleFrameRef.current = requestAnimationFrame(() => setReadyKey(renderKey))
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : `Không thể cập nhật biểu đồ ${ticker}`)
      }
    })
    return () => {
      cancelAnimationFrame(updateFrameRef.current)
      cancelAnimationFrame(settleFrameRef.current)
    }
  }, [chartReady, renderKey, study, ticker])

  const isUpdating = loading || !chartReady || readyKey !== renderKey

  return (
    <div>
      <div data-wyckoff-chart-canvas className="relative h-[520px] w-full overflow-hidden bg-[#070b11] [contain:layout_paint] xl:h-[660px]">
        <div
          data-wyckoff-chart-raster-viewport
          data-embedded-chart={embedded || undefined}
          className="relative mx-auto h-full w-full max-w-[1360px] overflow-hidden bg-[#070b11] [contain:paint]"
        >
          <div ref={hostRef} className="absolute inset-0" aria-label={`Biểu đồ Wyckoff ${ticker} ${study.timeframe}`} />
          {!study.bars.length ? <div className="absolute inset-0 z-[6] grid place-items-center bg-[#070b11] text-sm text-slate-500">Không có OHLCV hoàn tất cho {ticker} · {study.timeframe}.</div> : null}
          {isUpdating && study.bars.length ? <div className="pointer-events-none absolute inset-0 z-[7] grid place-items-center"><AiLoader label={`Đang cập nhật biểu đồ ${ticker}`} showLabel={false} compositorSafe className="border-cyan-400/15 bg-[#081019]/88 px-3 py-2" /></div> : null}
        </div>
        {runtimeError ? <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-rose-500/25 bg-[#120b10] px-3 py-2 text-center text-xs leading-relaxed text-rose-300 shadow-sm">{runtimeError}</div> : null}
      </div>
      <WyckoffIntelligence study={study} />
    </div>
  )
}
