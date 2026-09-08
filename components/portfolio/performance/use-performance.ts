"use client"

import { useCallback, useEffect, useState } from "react"

import type { PerformanceReadModel } from "@/modules/portfolio/performance/types"

type PerformanceResponse = {
  ok: boolean
  performance?: PerformanceReadModel
  error?: string
}

export function usePortfolioPerformance(portfolioId: string | null): {
  data: PerformanceReadModel | null
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const [data, setData] = useState<PerformanceReadModel | null>(null)
  const [loading, setLoading] = useState(Boolean(portfolioId))
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!portfolioId) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void fetch(`/api/portfolio/${portfolioId}/performance`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as PerformanceResponse | null
        if (!response.ok || !payload?.ok || !payload.performance) {
          throw new Error(payload?.error ?? "Không thể tải dữ liệu hiệu suất.")
        }
        return payload.performance
      })
      .then((performance) => {
        if (controller.signal.aborted) return
        setData(performance)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        const message = reason instanceof Error
          ? reason.message
          : "Không thể tải dữ liệu hiệu suất."
        setData(null)
        setError(message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [portfolioId, refreshKey])

  return { data, loading, error, refresh }
}
