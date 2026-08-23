"use client"

import { useEffect, useRef, useState } from "react"

import { AiLoader } from "@/components/smoothui/ai-loader"
import { loadLightweightCharts, type LightweightChartApi } from "@/lib/lightweight-charts-runtime"
import type { WyckoffChartStudy } from "@/lib/wyckoff-chart-model"

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

type ChartSlot = {
  key: string
  chart: LightweightChartApi
  layer: HTMLDivElement
}

function removeSlot(slot: ChartSlot | null) {
  if (!slot) return
  try {
    slot.chart.remove()
  } catch {
    // Lightweight Charts can already be detached during rapid navigation.
  }
  slot.layer.remove()
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export function WyckoffLightweightChart({ ticker, study }: { ticker: string; study: WyckoffChartStudy }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const activeSlotRef = useRef<ChartSlot | null>(null)
  const pendingSlotRef = useRef<ChartSlot | null>(null)
  const studyRef = useRef(study)
  const tickerRef = useRef(ticker)
  const [readyKey, setReadyKey] = useState("")
  const [runtimeError, setRuntimeError] = useState<{ key: string; message: string } | null>(null)

  const firstBar = study.bars[0]
  const lastBar = study.bars.at(-1)
  const analysis = study.analysis
  const scenarioSignature = study.scenarios
    .map((scenario) => `${scenario.key}:${scenario.probability}:${scenario.path.at(-1)?.value ?? ""}`)
    .join(",")
  const renderKey = [
    ticker,
    study.timeframe,
    study.bars.length,
    firstBar?.time ?? 0,
    lastBar?.time ?? 0,
    lastBar?.open ?? 0,
    lastBar?.high ?? 0,
    lastBar?.low ?? 0,
    lastBar?.close ?? 0,
    lastBar?.volume ?? 0,
    analysis?.support ?? "",
    analysis?.resistance ?? "",
    analysis?.bullProbability ?? 0,
    analysis?.baseProbability ?? 0,
    analysis?.bearProbability ?? 0,
    study.markers.length,
    scenarioSignature,
  ].join("|")

  const activeError = runtimeError?.key === renderKey ? runtimeError.message : ""
  const isLoading = study.bars.length > 0 && readyKey !== renderKey && !activeError
  const isInitialLoading = isLoading && readyKey === ""

  useEffect(() => {
    studyRef.current = study
    tickerRef.current = ticker
  }, [study, ticker])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let resizeFrame = 0
    const applySize = () => {
      const width = Math.max(1, Math.floor(host.clientWidth))
      const height = Math.max(1, Math.floor(host.clientHeight))
      activeSlotRef.current?.chart.applyOptions({ width, height })
      pendingSlotRef.current?.chart.applyOptions({ width, height })
    }

    applySize()
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame)
          resizeFrame = requestAnimationFrame(applySize)
        })

    resizeObserver?.observe(host)

    return () => {
      resizeObserver?.disconnect()
      cancelAnimationFrame(resizeFrame)
      removeSlot(pendingSlotRef.current)
      removeSlot(activeSlotRef.current)
      pendingSlotRef.current = null
      activeSlotRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const nextStudy = studyRef.current
    const nextTicker = tickerRef.current
    if (!host || !nextStudy.bars.length) return
    if (activeSlotRef.current?.key === renderKey) return

    let cancelled = false
    let localSlot: ChartSlot | null = null

    void (async () => {
      try {
        const lwc = await loadLightweightCharts()
        if (cancelled || !hostRef.current) return

        const layer = document.createElement("div")
        layer.dataset.wyckoffChartLayer = renderKey
        layer.style.position = "absolute"
        layer.style.inset = "0"
        layer.style.visibility = "hidden"
        layer.style.pointerEvents = "none"
        layer.style.background = "#070b11"
        host.appendChild(layer)

        const latest = nextStudy.bars.at(-1)!
        const format = pricePrecision(latest.close)
        const intraday = nextStudy.timeframe === "1H" || nextStudy.timeframe === "4H"
        const initialWidth = Math.max(1, Math.floor(host.clientWidth))
        const initialHeight = Math.max(1, Math.floor(host.clientHeight))

        const chart = lwc.createChart(layer, {
          width: initialWidth,
          height: initialHeight,
          layout: {
            attributionLogo: true,
            background: { type: lwc.ColorType.Solid, color: "#070b11" },
            textColor: "#82909d",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            panes: {
              separatorColor: "rgba(255,255,255,0.07)",
              separatorHoverColor: "rgba(34,201,138,0.28)",
              enableResize: true,
            },
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.025)" },
            horzLines: { color: "rgba(255,255,255,0.035)" },
          },
          rightPriceScale: {
            borderColor: "rgba(255,255,255,0.08)",
            scaleMargins: { top: 0.08, bottom: 0.1 },
          },
          timeScale: {
            borderColor: "rgba(255,255,255,0.08)",
            timeVisible: intraday,
            secondsVisible: false,
            rightOffset: 8,
            barSpacing: intraday ? 8 : 9,
            minBarSpacing: 2,
          },
          localization: { locale: "vi-VN" },
          crosshair: {
            vertLine: { color: "rgba(148,163,184,0.35)", labelBackgroundColor: "#334155" },
            horzLine: { color: "rgba(148,163,184,0.35)", labelBackgroundColor: "#334155" },
          },
          handleScroll: true,
          handleScale: true,
        })

        localSlot = { key: renderKey, chart, layer }
        pendingSlotRef.current = localSlot

        const candles = chart.addSeries(lwc.CandlestickSeries, {
          upColor: "#22c98a",
          downColor: "#ff4757",
          wickUpColor: "#22c98a",
          wickDownColor: "#ff4757",
          borderVisible: false,
          priceFormat: { type: "price", ...format },
          priceLineVisible: true,
          lastValueVisible: true,
        }, 0)
        candles.setData(nextStudy.bars.map((bar) => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })))

        const volume = chart.addSeries(lwc.HistogramSeries, {
          priceFormat: { type: "volume" },
          priceLineVisible: false,
          lastValueVisible: false,
        }, 1)
        volume.setData(nextStudy.bars.map((bar) => ({
          time: bar.time,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(34,201,138,0.38)" : "rgba(255,71,87,0.38)",
        })))
        chart.panes()[1]?.setHeight(108)

        if (lwc.createSeriesMarkers && nextStudy.markers.length) {
          lwc.createSeriesMarkers(candles, nextStudy.markers.map((marker) => ({
            time: marker.time,
            position: marker.tone === "bullish" ? "belowBar" : "aboveBar",
            color: marker.tone === "bullish" ? "#22c98a" : "#ff477c",
            shape: marker.tone === "bullish" ? "arrowUp" : "arrowDown",
            text: marker.label,
            size: 1.25,
          })))
        }

        if (candles.createPriceLine && nextStudy.analysis) {
          numericLevels(nextStudy.analysis.support).slice(0, 3).forEach((price, index) => candles.createPriceLine?.({
            price,
            color: index === 0 ? "rgba(34,201,138,0.78)" : "rgba(34,184,207,0.42)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: index === 0,
            title: index === 0 ? "Hỗ trợ" : "",
          }))
          numericLevels(nextStudy.analysis.resistance).slice(0, 3).forEach((price, index) => candles.createPriceLine?.({
            price,
            color: index === 0 ? "rgba(255,71,87,0.78)" : "rgba(176,124,255,0.42)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: index === 0,
            title: index === 0 ? "Kháng cự" : "",
          }))
        }

        if (lwc.LineSeries) {
          nextStudy.scenarios.forEach((scenario) => {
            const series = chart.addSeries(lwc.LineSeries, {
              color: scenario.color,
              lineWidth: scenario.key === "base" ? 2 : 3,
              lineStyle: scenario.key === "base" ? 2 : 0,
              lineType: 2,
              crosshairMarkerVisible: false,
              priceLineVisible: false,
              lastValueVisible: true,
              title: `${scenario.label} ${scenario.probability}%`,
              priceFormat: { type: "price", ...format },
            }, 0)
            series.setData(scenario.path.map((point) => ({ time: point.time, value: point.value })))
          })
        }

        const visible = nextStudy.timeframe === "1M" ? 84 : nextStudy.timeframe === "1W" ? 150 : 180
        const last = nextStudy.bars.length - 1
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(-0.5, last - visible + 1),
          to: last + 8,
        })

        await nextPaint()
        if (cancelled || pendingSlotRef.current !== localSlot) {
          removeSlot(localSlot)
          return
        }

        const previousSlot = activeSlotRef.current
        layer.style.visibility = "visible"
        layer.style.pointerEvents = "auto"
        activeSlotRef.current = localSlot
        pendingSlotRef.current = null
        removeSlot(previousSlot)

        setRuntimeError((current) => current?.key === renderKey ? null : current)
        setReadyKey(renderKey)
      } catch (error) {
        if (localSlot && pendingSlotRef.current === localSlot) {
          pendingSlotRef.current = null
          removeSlot(localSlot)
        }
        if (!cancelled) {
          setRuntimeError({
            key: renderKey,
            message: error instanceof Error ? error.message : `Không thể khởi tạo biểu đồ ${nextTicker}`,
          })
        }
      }
    })()

    return () => {
      cancelled = true
      if (localSlot && pendingSlotRef.current === localSlot) {
        pendingSlotRef.current = null
        removeSlot(localSlot)
      }
    }
  }, [renderKey])

  return (
    <div data-wyckoff-chart-canvas className="relative h-[520px] w-full overflow-hidden bg-[#070b11] [contain:layout_paint] xl:h-[660px]">
      <div ref={hostRef} className="absolute inset-0" aria-label={`Biểu đồ Wyckoff ${ticker} ${study.timeframe}`} />

      {!study.bars.length ? (
        <div className="absolute inset-0 z-[6] grid place-items-center bg-[#070b11] text-sm text-slate-500">
          Không có OHLCV hoàn tất cho {ticker} · {study.timeframe}.
        </div>
      ) : null}

      {isInitialLoading ? (
        <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-[#070b11]">
          <AiLoader label={`Đang dựng biểu đồ ${ticker} · ${study.timeframe}`} />
        </div>
      ) : null}

      {isLoading && !isInitialLoading ? (
        <div className="pointer-events-none absolute right-3 top-3 z-[7] rounded-lg border border-white/[0.09] bg-[#090e15] px-2.5 py-1.5 shadow-sm">
          <AiLoader label={`Đang cập nhật ${ticker} · ${study.timeframe}`} compact />
        </div>
      ) : null}

      {activeError ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-rose-500/25 bg-[#120b10] px-3 py-2 text-center text-xs leading-relaxed text-rose-300 shadow-sm">
          {activeError}
        </div>
      ) : null}
    </div>
  )
}
