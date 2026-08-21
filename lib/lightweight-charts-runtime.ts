"use client"

export interface LightweightSeriesApi {
  setData(data: ReadonlyArray<Record<string, unknown>>): void
  update(data: Record<string, unknown>): void
}

export interface LightweightLogicalRange {
  from: number
  to: number
}

export interface LightweightTimeScaleApi {
  fitContent(): void
  setVisibleLogicalRange(range: LightweightLogicalRange): void
  timeToCoordinate(time: number): number | null
  subscribeVisibleLogicalRangeChange(handler: (range: LightweightLogicalRange | null) => void): void
  unsubscribeVisibleLogicalRangeChange(handler: (range: LightweightLogicalRange | null) => void): void
}

export interface LightweightPaneApi {
  setHeight(height: number): void
}

export interface LightweightChartApi {
  addSeries(definition: unknown, options?: Record<string, unknown>, paneIndex?: number): LightweightSeriesApi
  timeScale(): LightweightTimeScaleApi
  panes(): LightweightPaneApi[]
  remove(): void
}

export interface LightweightChartsRuntime {
  createChart(container: HTMLElement, options?: Record<string, unknown>): LightweightChartApi
  CandlestickSeries: unknown
  HistogramSeries: unknown
  ColorType: { Solid: string }
  version?: () => string
}

declare global {
  interface Window {
    LightweightCharts?: LightweightChartsRuntime
  }
}

const SOURCES = [
  "https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js",
  "https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js",
]

let runtimePromise: Promise<LightweightChartsRuntime> | null = null

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-stockos-lwc][src="${src}"]`)
    if (existing) {
      if (window.LightweightCharts) {
        resolve()
        return
      }
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error(`Không tải được chart runtime từ ${src}`)), { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.crossOrigin = "anonymous"
    script.dataset.stockosLwc = "true"
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      reject(new Error(`Không tải được chart runtime từ ${src}`))
    }
    document.head.appendChild(script)
  })
}

export function loadLightweightCharts(): Promise<LightweightChartsRuntime> {
  if (typeof window === "undefined") return Promise.reject(new Error("Lightweight Charts chỉ chạy trên browser"))
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts)
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    let lastError: unknown = null
    for (const src of SOURCES) {
      try {
        await loadScript(src)
        if (window.LightweightCharts) return window.LightweightCharts
      } catch (error) {
        lastError = error
      }
    }
    runtimePromise = null
    throw lastError instanceof Error ? lastError : new Error("Không thể khởi tạo TradingView Lightweight Charts")
  })()

  return runtimePromise
}
