"use client"

import { useEffect, useState } from "react"

import type { OpenTradeRiskBreakdown } from "@/modules/portfolio/risk-sizing/types"

export type RiskSizingClientContext = {
  defaultTradeRiskPercent: number
  riskSource: "money_management_plan" | "onboarding_default"
  maxActiveRiskPercent: number | null
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  openTradeRisks: OpenTradeRiskBreakdown[]
  winRatioPercent: number | null
  payoffRatio: number | null
  evidenceCompleteness: "complete" | "partial" | "insufficient"
}

type RiskSizingResponse = {
  ok: boolean
  context?: RiskSizingClientContext
  error?: string
}

export function useRiskSizingContext(portfolioId: string): {
  context: RiskSizingClientContext | null
  loading: boolean
  error: string | null
} {
  const [context, setContext] = useState<RiskSizingClientContext | null>(null)
  const [loading, setLoading] = useState(Boolean(portfolioId))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setContext(null)
    setError(null)

    if (!portfolioId) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    void fetch(`/api/portfolio/${portfolioId}/risk-sizing`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as RiskSizingResponse
        if (!response.ok || !body.ok || !body.context) {
          throw new Error(body.error ?? "Không thể tải risk-sizing context.")
        }
        return body.context
      })
      .then((nextContext) => {
        if (!controller.signal.aborted) setContext(nextContext)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : "Không thể tải risk-sizing context.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [portfolioId])

  return { context, loading, error }
}
