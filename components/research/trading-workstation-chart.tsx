"use client"

import { useMemo, useState } from "react"

import type { OhlcvBar } from "@/lib/technical-indicators"
import type { WyckoffScanResult } from "@/modules/wyckoff/engine"

function sma(values: number[], period: number) {
  const out: Array<number | null> = Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function ema(values: number[], period: number) {
  const out: Array<number | null> = Array(values.length).fill(null)
  if (!values.length) return out
  const alpha = 2 / (period + 1)
  let current = values[0]
  out[0] = current
  for (let i = 1; i < values.length; i += 1) {
    current = values[i] * alpha + current * (1 - alpha)
    out[i] = current
  }
  return out
}

function rsi(values: number[], period = 14) {
  const out: Array<number | null> = Array(values.length).fill(null)
  if (values.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1]
    gain += Math.max(delta, 0)
    loss += Math.max(-delta, 0)
  }
  gain /= period
  loss /= period
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1]
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  }
  return out
}

function macd(values: number[]) {
  const fast = ema(values, 12)
  const slow = ema(values, 26)
  const line = values.map((_, i) => fast[i] == null || slow[i] == null ? null : (fast[i] as number) - (slow[i] as number))
  const signal: Array<number | null> = Array(values.length).fill(null)
  let seeded = false
  let current = 0
  const alpha = 2 / 10
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] == null) continue
    if (!seeded) {
      current = line[i] as number
      seeded = true
    } else {
      current = (line[i] as number) * alpha + current * (1 - alpha)
    }
    signal[i] = current
  }
  const hist = line.map((value, i) => value == null || signal[i] == null ? null : value - (signal[i] as number))
  return { line, signal, hist }
}

function parseLevels(value: string | undefined) {
  if (!value) return []
  return (value.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((token) => Number(token.replace(/,/g, "")))
    .filter((level) => Number.isFinite(level) && level > 0)
}

function eventMarkers(bars: OhlcvBar[]) {
  const events: Array<{ index: number; label: string; bullish: boolean; price: number }> = []
  for (let i = 20; i < bars.length; i += 1) {
    const bar = bars[i]
    const prior = bars.slice(i - 20, i)
    const priorHigh = Math.max(...prior.map((row) => row.high))
    const priorLow = Math.min(...prior.map((row) => row.low))
    const avgVolume = prior.reduce((sum, row) => sum + row.volume, 0) / Math.max(1, prior.length)
    const relVolume = avgVolume > 0 ? bar.volume / avgVolume : 1
    const spread = Math.max(bar.high - bar.low, 1e-9)
    const closeLocation = (bar.close - bar.low) / spread
    if (bar.low < priorLow && bar.close > priorLow && closeLocation > 0.55) events.push({ index: i, label: "Spring?", bullish: true, price: bar.low })
    else if (bar.high > priorHigh && bar.close < priorHigh && closeLocation < 0.45) events.push({ index: i, label: "UT?", bullish: false, price: bar.high })
    else if (bar.close > priorHigh && closeLocation > 0.65 && relVolume >= 1.1) events.push({ index: i, label: "SOS?", bullish: true, price: bar.low })
    else if (bar.close < priorLow && closeLocation < 0.35 && relVolume >= 1.1) events.push({ index: i, label: "SOW?", bullish: false, price: bar.high })
  }
  return events
}

function fmt(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function formatTime(time: number) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(time * 1000))
}

export function TradingWorkstationChart({ bars, scan, label }: { bars: OhlcvBar[]; scan?: WyckoffScanResult; label: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const computed = useMemo(() => {
    const closes = bars.map((bar) => bar.close)
    return {
      ma20: sma(closes, 20),
      ma50: sma(closes, 50),
      ma200: sma(closes, 200),
      rsi: rsi(closes),
      macd: macd(closes),
      events: eventMarkers(bars),
    }
  }, [bars])

  const start = Math.max(0, bars.length - 120)
  const shown = bars.slice(start)
  if (shown.length < 2) return <div className="rounded-lg border border-border bg-panel-2 p-6 text-sm text-foreground/55">Chưa đủ OHLCV để vẽ chart {label}.</div>

  const ma20 = computed.ma20.slice(start)
  const ma50 = computed.ma50.slice(start)
  const ma200 = computed.ma200.slice(start)
  const rsiSeries = computed.rsi.slice(start)
  const macdLine = computed.macd.line.slice(start)
  const macdSignal = computed.macd.signal.slice(start)
  const macdHist = computed.macd.hist.slice(start)
  const events = computed.events.filter((event) => event.index >= start).map((event) => ({ ...event, index: event.index - start }))

  const width = 1120
  const left = 64
  const right = 28
  const chartWidth = width - left - right
  const priceTop = 20
  const priceHeight = 310
  const volumeTop = 350
  const volumeHeight = 80
  const rsiTop = 465
  const rsiHeight = 105
  const macdTop = 615
  const macdHeight = 110
  const height = 755

  const levels = [...parseLevels(scan?.support), ...parseLevels(scan?.resistance)]
  const priceValues = shown.flatMap((bar, i) => [bar.low, bar.high, ma20[i] ?? bar.close, ma50[i] ?? bar.close, ma200[i] ?? bar.close])
  for (const level of levels) priceValues.push(level)
  const rawMin = Math.min(...priceValues)
  const rawMax = Math.max(...priceValues)
  const pad = Math.max((rawMax - rawMin) * 0.06, rawMax * 0.006)
  const min = rawMin - pad
  const max = rawMax + pad
  const maxVolume = Math.max(...shown.map((bar) => bar.volume), 1)
  const validMacd = [...macdLine, ...macdSignal, ...macdHist].filter((value): value is number => value != null && Number.isFinite(value))
  const macdAbs = Math.max(...validMacd.map((value) => Math.abs(value)), 1e-6)

  const x = (i: number) => left + ((i + 0.5) / shown.length) * chartWidth
  const yPrice = (value: number) => priceTop + ((max - value) / Math.max(1e-9, max - min)) * priceHeight
  const yRsi = (value: number) => rsiTop + ((100 - value) / 100) * rsiHeight
  const yMacd = (value: number) => macdTop + ((macdAbs - value) / (macdAbs * 2)) * macdHeight
  const candleWidth = Math.max(2.5, Math.min(10, chartWidth / shown.length * 0.68))

  const linePath = (series: Array<number | null>, scale: (value: number) => number) => {
    let started = false
    return series.map((value, i) => {
      if (value == null) return ""
      const command = started ? "L" : "M"
      started = true
      return `${command} ${x(i)} ${scale(value)}`
    }).join(" ")
  }

  const hovered = hoverIndex == null ? shown.at(-1)! : shown[hoverIndex]
  const hoveredIndex = hoverIndex == null ? shown.length - 1 : hoverIndex
  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * width
    const index = Math.max(0, Math.min(shown.length - 1, Math.floor(((svgX - left) / chartWidth) * shown.length)))
    setHoverIndex(index)
  }

  return <div className="overflow-x-auto">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-foreground/55">
      <div className="font-mono">{formatTime(hovered.time)} · O {fmt(hovered.open)} · H {fmt(hovered.high)} · L {fmt(hovered.low)} · C {fmt(hovered.close)} · Vol {fmt(hovered.volume, 0)}</div>
      <div className="flex flex-wrap gap-3"><span className="text-brand">MA20 {fmt(ma20[hoveredIndex])}</span><span className="text-ref">MA50 {fmt(ma50[hoveredIndex])}</span><span className="text-down">MA200 {fmt(ma200[hoveredIndex])}</span></div>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[920px] w-full select-none" role="img" aria-label={`Trading chart ${label}`} onPointerMove={pointerMove} onPointerLeave={() => setHoverIndex(null)}>
      {[min, min + (max - min) / 2, max].map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={yPrice(tick)} y2={yPrice(tick)} stroke="var(--color-border-strong)" strokeDasharray="4 6" opacity="0.45" /><text x={left - 8} y={yPrice(tick) + 4} textAnchor="end" fill="currentColor" className="text-[11px] text-foreground/45">{fmt(tick, 1)}</text></g>)}

      {parseLevels(scan?.support).map((level) => <g key={`s-${level}`}><line x1={left} x2={width - right} y1={yPrice(level)} y2={yPrice(level)} stroke="var(--color-up)" strokeDasharray="6 6" opacity="0.55" /><text x={width - right - 3} y={yPrice(level) - 5} textAnchor="end" fill="var(--color-up)" fontSize="10">S {fmt(level)}</text></g>)}
      {parseLevels(scan?.resistance).map((level) => <g key={`r-${level}`}><line x1={left} x2={width - right} y1={yPrice(level)} y2={yPrice(level)} stroke="var(--color-down)" strokeDasharray="6 6" opacity="0.55" /><text x={width - right - 3} y={yPrice(level) - 5} textAnchor="end" fill="var(--color-down)" fontSize="10">R {fmt(level)}</text></g>)}

      {shown.map((bar, i) => {
        const up = bar.close >= bar.open
        const yOpen = yPrice(bar.open)
        const yClose = yPrice(bar.close)
        const top = Math.min(yOpen, yClose)
        const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen))
        const volumeH = (bar.volume / maxVolume) * volumeHeight
        return <g key={bar.time}>
          <line x1={x(i)} x2={x(i)} y1={yPrice(bar.high)} y2={yPrice(bar.low)} stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth="1.2" />
          <rect x={x(i) - candleWidth / 2} y={top} width={candleWidth} height={bodyHeight} rx="0.8" fill={up ? "var(--color-up)" : "var(--color-down)"} />
          <rect x={x(i) - candleWidth / 2} y={volumeTop + volumeHeight - volumeH} width={candleWidth} height={volumeH} fill={up ? "var(--color-up)" : "var(--color-down)"} opacity="0.35" />
        </g>
      })}

      <path d={linePath(ma20, yPrice)} fill="none" stroke="var(--color-brand)" strokeWidth="1.6" />
      <path d={linePath(ma50, yPrice)} fill="none" stroke="var(--color-ref)" strokeWidth="1.6" />
      <path d={linePath(ma200, yPrice)} fill="none" stroke="var(--color-down)" strokeWidth="1.35" opacity="0.8" />

      {events.map((event) => {
        const markerY = yPrice(event.price) + (event.bullish ? 18 : -14)
        return <g key={`${event.index}-${event.label}`}><circle cx={x(event.index)} cy={markerY} r="8" fill={event.bullish ? "var(--color-up)" : "var(--color-down)"} opacity="0.9" /><text x={x(event.index)} y={markerY + 3.5} textAnchor="middle" fill="white" fontSize="7" fontWeight="700">{event.label.replace("?", "")}</text></g>
      })}

      <line x1={left} x2={width - right} y1={volumeTop - 10} y2={volumeTop - 10} stroke="var(--color-border)" />
      <text x={left} y={volumeTop - 16} fill="currentColor" className="text-[11px] text-foreground/45">VOLUME</text>

      {[30, 50, 70].map((tick) => <g key={`rsi-${tick}`}><line x1={left} x2={width - right} y1={yRsi(tick)} y2={yRsi(tick)} stroke="var(--color-border-strong)" strokeDasharray={tick === 50 ? "3 7" : "6 6"} opacity={tick === 50 ? 0.3 : 0.5} /><text x={left - 8} y={yRsi(tick) + 4} textAnchor="end" fill="currentColor" className="text-[10px] text-foreground/40">{tick}</text></g>)}
      <text x={left} y={rsiTop - 12} fill="currentColor" className="text-[11px] text-foreground/45">RSI14</text>
      <path d={linePath(rsiSeries, yRsi)} fill="none" stroke="var(--color-brand)" strokeWidth="1.8" />

      <line x1={left} x2={width - right} y1={yMacd(0)} y2={yMacd(0)} stroke="var(--color-border-strong)" opacity="0.55" />
      <text x={left} y={macdTop - 12} fill="currentColor" className="text-[11px] text-foreground/45">MACD 12/26/9</text>
      {macdHist.map((value, i) => value == null ? null : <rect key={`hist-${i}`} x={x(i) - candleWidth / 2} y={Math.min(yMacd(value), yMacd(0))} width={candleWidth} height={Math.max(1, Math.abs(yMacd(value) - yMacd(0)))} fill={value >= 0 ? "var(--color-up)" : "var(--color-down)"} opacity="0.3" />)}
      <path d={linePath(macdLine, yMacd)} fill="none" stroke="var(--color-brand)" strokeWidth="1.6" />
      <path d={linePath(macdSignal, yMacd)} fill="none" stroke="var(--color-ref)" strokeWidth="1.5" />

      {hoverIndex != null && <g pointerEvents="none"><line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={priceTop} y2={macdTop + macdHeight} stroke="var(--color-foreground)" strokeDasharray="3 5" opacity="0.35" /><line x1={left} x2={width - right} y1={yPrice(hovered.close)} y2={yPrice(hovered.close)} stroke="var(--color-foreground)" strokeDasharray="3 5" opacity="0.28" /></g>}
    </svg>
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-foreground/50"><span>Candlestick + Volume</span><span className="text-brand">MA20 / MACD</span><span className="text-ref">MA50 / Signal</span><span className="text-down">MA200 / Resistance</span><span className="text-up">Support</span><span>Spring/UT/SOS/SOW = candidate marker, không phải confirmation.</span></div>
  </div>
}
