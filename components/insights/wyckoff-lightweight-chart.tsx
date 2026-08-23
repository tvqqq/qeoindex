"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { AiLoader } from "@/components/smoothui/ai-loader"
import {
  loadLightweightCharts,
  type LightweightChartApi,
  type LightweightLogicalRange,
  type LightweightPriceLineApi,
  type LightweightSeriesApi,
  type LightweightSeriesMarkersApi,
} from "@/lib/lightweight-charts-runtime"
import type { WyckoffChartStudy } from "@/lib/wyckoff-chart-model"

const ZOOM_SETTLE_MS = 110
const ZOOM_STEP = 0.14
const MIN_VISIBLE_BARS = 36

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

type ScenarioKey = "bull" | "base" | "bear"

type ChartController = {
  chart: LightweightChartApi
  candles: LightweightSeriesApi
  volume: LightweightSeriesApi
  markers: LightweightSeriesMarkersApi | null
  scenarioSeries: Record<ScenarioKey, LightweightSeriesApi>
  priceLines: LightweightPriceLineApi[]
  visibleRange: LightweightLogicalRange | null
  barCount: number
}

function scenarioKey(value: string): ScenarioKey | null {
  if (value === "bull" || value === "base" || value === "bear") return value
  return null
}

function clearPriceLines(controller: ChartController) {
  for (const line of controller.priceLines) controller.candles.removePriceLine?.(line)
  controller.priceLines = []
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function applyDiscreteZoom(controller: ChartController, wheelDelta: number, anchorRatio: number) {
  const current = controller.visibleRange
  if (!current || !Number.isFinite(wheelDelta) || wheelDelta === 0) return

  const span = Math.max(1, current.to - current.from)
  const steps = clamp(Math.round(Math.abs(wheelDelta) / 120), 1, 3)
  const scale = wheelDelta > 0 ? 1 + ZOOM_STEP * steps : 1 / (1 + ZOOM_STEP * steps)
  const maxTo = Math.max(8, controller.barCount - 1 + 8)
  const maxSpan = Math.max(MIN_VISIBLE_BARS, maxTo + 0.5)
  const nextSpan = clamp(span * scale, MIN_VISIBLE_BARS, maxSpan)
  const safeAnchor = clamp(anchorRatio, 0, 1)
  const anchor = current.from + span * safeAnchor

  let from = anchor - nextSpan * safeAnchor
  let to = from + nextSpan
  const minFrom = -0.5

  if (from < minFrom) {
    to += minFrom - from
    from = minFrom
  }
  if (to > maxTo) {
    from -= to - maxTo
    to = maxTo
  }

  const nextRange = { from, to }
  controller.visibleRange = nextRange
  controller.chart.timeScale().setVisibleLogicalRange(nextRange)
}

function applyStudy(controller: ChartController, study: WyckoffChartStudy) {
  const latest = study.bars.at(-1)
  if (!latest) return
  const format = pricePrecision(latest.close)
  const intraday = study.timeframe === "1H" || study.timeframe === "4H"

  controller.barCount = study.bars.length
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
    position: marker.tone === "bullish" ? "belowBar" : "aboveBar",
    color: marker.tone === "bullish" ? "#22c98a" : "#ff477c",
    shape: marker.tone === "bullish" ? "arrowUp" : "arrowDown",
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
  const visibleRange = { from: Math.max(-0.5, last - visible + 1), to: last + 8 }
  controller.visibleRange = visibleRange
  controller.chart.timeScale().setVisibleLogicalRange(visibleRange)
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
    let zoomTimer = 0
    let pendingWheelDelta = 0
    let pendingAnchorRatio = 0.5
    let chart: LightweightChartApi | null = null
    let resizeObserver: ResizeObserver | null = null
    let visibleRangeHandler: ((range: LightweightLogicalRange | null) => void) | null = null

    const handleWheel = (event: WheelEvent) => {
      if (embedded || Math.abs(event.deltaY) < 0.1) return
      event.preventDefault()
      pendingWheelDelta += event.deltaY
      const rect = host.getBoundingClientRect()
      pendingAnchorRatio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5
      window.clearTimeout(zoomTimer)
      zoomTimer = window.setTimeout(() => {
        const controller = controllerRef.current
        const delta = pendingWheelDelta
        pendingWheelDelta = 0
        if (controller) applyDiscreteZoom(controller, delta, pendingAnchorRatio)
      }, ZOOM_SETTLE_MS)
    }

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
          handleScale: {
            mouseWheel: false,
            pinch: embedded,
            axisPressedMouseMove: {
              time: true,
              price: true,
            },
            axisDoubleClickReset: {
              time: true,
              price: true,
            },
          },
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
        const controller: ChartController = {
          chart,
          candles,
          volume,
          markers,
          scenarioSeries,
          priceLines: [],
          visibleRange: null,
          barCount: 0,
        }
        controllerRef.current = controller
        visibleRangeHandler = (range) => {
          if (controllerRef.current === controller) controller.visibleRange = range
        }
        chart.timeScale().subscribeVisibleLogicalRangeChange(visibleRangeHandler)
        if (!embedded) host.addEventListener("wheel", handleWheel, { passive: false })

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
      window.clearTimeout(zoomTimer)
      host.removeEventListener("wheel", handleWheel)
      if (chart && visibleRangeHandler) chart.timeScale().unsubscribeVisibleLogicalRangeChange(visibleRangeHandler)
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
    <div data-wyckoff-chart-canvas className="relative h-[520px] w-full overflow-hidden bg-[#070b11] [contain:layout_paint] xl:h-[660px]">
      <div
        data-wyckoff-chart-raster-viewport
        className="relative mx-auto h-full w-full max-w-[1360px] overflow-hidden bg-[#070b11] [contain:paint]"
      >
        <div ref={hostRef} className="absolute inset-0" aria-label={`Biểu đồ Wyckoff ${ticker} ${study.timeframe}`} />
        {!study.bars.length ? <div className="absolute inset-0 z-[6] grid place-items-center bg-[#070b11] text-sm text-slate-500">Không có OHLCV hoàn tất cho {ticker} · {study.timeframe}.</div> : null}
        {isUpdating && study.bars.length ? <div className="pointer-events-none absolute inset-0 z-[7] grid place-items-center"><AiLoader label={`Đang cập nhật biểu đồ ${ticker}`} showLabel={false} compositorSafe className="border-cyan-400/15 bg-[#081019]/88 px-3 py-2" /></div> : null}
      </div>
      {runtimeError ? <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-rose-500/25 bg-[#120b10] px-3 py-2 text-center text-xs leading-relaxed text-rose-300 shadow-sm">{runtimeError}</div> : null}
    </div>
  )
}
