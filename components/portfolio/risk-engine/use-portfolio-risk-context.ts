"use client"

import { useEffect, useRef, useState } from "react"

import type { PortfolioRiskReadModel } from "@/modules/portfolio/risk-engine/types"

type RiskResponse = {
  ok?: boolean
  risk?: PortfolioRiskReadModel
  error?: string
}

export function usePortfolioRiskContext(portfolioId: string) {
  const [risk, setRisk] = useState<PortfolioRiskReadModel | null>(null)
  const [loading, setLoading] = useState(Boolean(portfolioId))
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setRisk(null)
    setError(null)

    if (!portfolioId) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    void fetch(`/api/portfolio/${portfolioId}/risk`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as RiskResponse | null
        if (!response.ok || !payload?.ok || !payload.risk) {
          throw new Error(payload?.error ?? "Không thể tải dữ liệu rủi ro danh mục.")
        }
        return payload.risk
      })
      .then((nextRisk) => {
        if (!controller.signal.aborted && requestIdRef.current === requestId) setRisk(nextRisk)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return
        setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu rủi ro danh mục.")
      })
      .finally(() => {
        if (!controller.signal.aborted && requestIdRef.current === requestId) setLoading(false)
      })

    return () => controller.abort()
  }, [portfolioId])

  return { risk, loading, error }
}
