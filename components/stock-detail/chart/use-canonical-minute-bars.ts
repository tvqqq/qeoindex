"use client"

import { useEffect, useState } from "react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"

type MinuteBarsStatus = "idle" | "loading" | "ready" | "error"

type MinuteBarsState = {
  bars: OhlcvBar[]
  status: MinuteBarsStatus
  error: string | null
}

const INITIAL_STATE: MinuteBarsState = { bars: [], status: "idle", error: null }
const LOOKBACK_SECONDS = 7 * 24 * 60 * 60

function isOhlcvBar(value: unknown): value is OhlcvBar {
  if (!value || typeof value !== "object") return false
  const bar = value as Record<string, unknown>
  return ["time", "open", "high", "low", "close", "volume"].every((key) => Number.isFinite(bar[key]))
}

export function useCanonicalMinuteBars({ ticker, enabled }: { ticker: string; enabled: boolean }): MinuteBarsState {
  const [state, setState] = useState<MinuteBarsState>(INITIAL_STATE)

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    const to = Math.floor(Date.now() / 1000)
    const from = to - LOOKBACK_SECONDS
    const normalizedTicker = ticker.trim().toUpperCase()

    setState({ bars: [], status: "loading", error: null })

    void (async () => {
      try {
        const params = new URLSearchParams({
          ticker: normalizedTicker,
          resolution: "1m",
          from: String(from),
          to: String(to),
        })
        const response = await fetch(`/api/market/ohlcv?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const payload = (await response.json().catch(() => null)) as { ok?: boolean; bars?: unknown[]; error?: string } | null
        if (!response.ok || !payload?.ok || !Array.isArray(payload.bars)) {
          throw new Error(payload?.error || `HTTP ${response.status}`)
        }

        const bars = payload.bars.filter(isOhlcvBar)
        setState({ bars, status: "ready", error: bars.length ? null : "Không có dữ liệu 1m trong khoảng yêu cầu." })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          bars: [],
          status: "error",
          error: error instanceof Error ? error.message : "Không tải được dữ liệu 1m canonical.",
        })
      }
    })()

    return () => controller.abort()
  }, [enabled, ticker])

  return enabled ? state : INITIAL_STATE
}
