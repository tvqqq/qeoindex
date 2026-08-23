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

export function WyckoffLightweightChart({ ticker, study }: { ticker: string; study: WyckoffChartStudy }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<LightweightChartApi | null>(null)
  const [readyKey, setReadyKey] = useState("")
  const [runtimeError, setRuntimeError] = useState<{ key: string; message: string } | null>(null)
  const lastBarTime = study.bars.at(-1)?.time ?? 0
  const loadKey = `${ticker}:${study.timeframe}:${lastBarTime}:${study.bars.length}`
  const activeError = runtimeError?.key === loadKey ? runtimeError.message : ""
  const isLoading = study.bars.length > 0 && readyKey !== loadKey && !activeError

  useEffect(() => {
    const container = containerRef.current
    if (!container || !study.bars.length) return

    let disposed = false
    let chart: LightweightChartApi | null = null
    let resizeObserver: ResizeObserver | null = null
    let resizeFrame = 0

    void (async () => {
      try {
        const lwc = await loadLightweightCharts()
        if (disposed || !containerRef.current) return

        const latest = study.bars.at(-1)!
        const format = pricePrecision(latest.close)
        const intraday = study.timeframe === "1H" || study.timeframe === "4H"
        const initialWidth = Math.max(1, Math.floor(container.clientWidth))
        const initialHeight = Math.max(1, Math.floor(container.clientHeight))

        chart = lwc.createChart(container, {
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
        candles.setData(study.bars.map((bar) => ({
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
        volume.setData(study.bars.map((bar) => ({
          time: bar.time,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(34,201,138,0.38)" : "rgba(255,71,87,0.38)",
        })))
        chart.panes()[1]?.setHeight(108)

        if (lwc.createSeriesMarkers && study.markers.length) {
          lwc.createSeriesMarkers(candles, study.markers.map((marker) => ({
            time: marker.time,
            position: marker.tone === "bullish" ? "belowBar" : "aboveBar",
            color: marker.tone === "bullish" ? "#22c98a" : "#ff477c",
            shape: marker.tone === "bullish" ? "arrowUp" : "arrowDown",
            text: marker.label,
            size: 1.25,
          })))
        }

        if (candles.createPriceLine && study.analysis) {
          numericLevels(study.analysis.support).slice(0, 3).forEach((price, index) => candles.createPriceLine?.({
            price,
            color: index === 0 ? "rgba(34,201,138,0.78)" : "rgba(34,184,207,0.42)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: index === 0,
            title: index === 0 ? "Hỗ trợ" : "",
          }))
          numericLevels(study.analysis.resistance).slice(0, 3).forEach((price, index) => candles.createPriceLine?.({
            price,
            color: index === 0 ? "rgba(255,71,87,0.78)" : "rgba(176,124,255,0.42)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: index === 0,
            title: index === 0 ? "Kháng cự" : "",
          }))
        }

        if (lwc.LineSeries) {
          study.scenarios.forEach((scenario) => {
            const series = chart!.addSeries(lwc.LineSeries, {
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

        const visible = study.timeframe === "1M" ? 84 : study.timeframe === "1W" ? 150 : 180
        const last = study.bars.length - 1
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(-0.5, last - visible + 1),
          to: last + 8,
        })

        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry || disposed || !chart) return
            const width = Math.max(1, Math.floor(entry.contentRect.width))
            const height = Math.max(1, Math.floor(entry.contentRect.height))
            cancelAnimationFrame(resizeFrame)
            resizeFrame = requestAnimationFrame(() => {
              if (!disposed && chart) chart.applyOptions({ width, height })
            })
          })
          resizeObserver.observe(container)
        }

        chartRef.current = chart
        setReadyKey(loadKey)
      } catch (error) {
        if (!disposed) {
          setRuntimeError({ key: loadKey, message: error instanceof Error ? error.message : "Không thể khởi tạo biểu đồ" })
        }
      }
    })()

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      cancelAnimationFrame(resizeFrame)
      if (chartRef.current === chart) chartRef.current = null
      chart?.remove()
    }
  }, [loadKey, study, ticker])

  if (!study.bars.length) {
    return <div className="grid h-[520px] place-items-center bg-[#070b11] text-sm text-slate-500 xl:h-[660px]">Không có OHLCV hoàn tất cho {ticker} · {study.timeframe}.</div>
  }

  return (
    <div data-wyckoff-chart-canvas className="relative h-[520px] w-full bg-[#070b11] [contain:layout_paint] xl:h-[660px]">
      <div ref={containerRef} className="absolute inset-0" aria-label={`Biểu đồ Wyckoff ${ticker} ${study.timeframe}`} />
      {isLoading ? (
        <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-[#070b11]">
          <AiLoader label={`Đang dựng biểu đồ ${ticker} · ${study.timeframe}`} />
        </div>
      ) : null}
      {activeError ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[#070b11] p-6 text-center">
          <div className="max-w-sm rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-3 text-xs leading-relaxed text-rose-300">{activeError}</div>
        </div>
      ) : null}
    </div>
  )
}
