"use client"

import { useEffect, useRef, useState } from "react"

import type { PortfolioConcentrationReadModel, SectorMetadataSnapshot } from "@/modules/portfolio/concentration/types"
import type { OpenTradeRiskBreakdown, RiskState } from "@/modules/portfolio/risk-sizing/types"

export type RiskSizingClientContext = {
  configuredDefaultTradeRiskPercent: number
  effectiveDefaultTradeRiskPercent: number
  defaultTradeRiskPercent: number
  riskSource: "money_management_plan" | "onboarding_default"
  moneyManagementPlanId: string | null
  riskState: RiskState
  riskStateReasons: string[]
  accountEquityVnd: number | null
  accountEquityCompleteness: "complete" | "insufficient"
  accountEquityMissingPriceTickers: string[]
  maxActiveRiskPercent: number | null
  knownActiveRiskVnd: number
  unknownRiskTradeCount: number
  openTradeRisks: OpenTradeRiskBreakdown[]
  concentration: PortfolioConcentrationReadModel
  sectorMetadata: SectorMetadataSnapshot
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
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
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
          throw new Error(body.error ?? "Không thể tải ngữ cảnh tính khối lượng.")
        }
        return body.context
      })
      .then((nextContext) => {
        if (!controller.signal.aborted && requestIdRef.current === requestId) setContext(nextContext)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return
        setError(cause instanceof Error ? cause.message : "Không thể tải ngữ cảnh tính khối lượng.")
      })
      .finally(() => {
        if (!controller.signal.aborted && requestIdRef.current === requestId) setLoading(false)
      })

    return () => controller.abort()
  }, [portfolioId])

  return { context, loading, error }
}
