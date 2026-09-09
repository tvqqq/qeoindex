"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type ExternalCashFlowRow = {
  id: string
  portfolio_id: string
  user_id: string
  flow_type: "deposit" | "withdrawal" | "capital_adjustment"
  signed_amount_vnd: number | string
  effective_at: string
  note: string | null
  provenance: "manual" | "imported" | "portfolio_settings_adjustment"
  created_at: string
}

type FundingHistoryStatus = "known" | "legacy_unrecorded"

type CashFlowResponse = {
  ok?: boolean
  funding_history_status?: FundingHistoryStatus
  cash_flows?: ExternalCashFlowRow[]
  cash_flow?: ExternalCashFlowRow
  error?: string
}

export type AddExternalCashFlowInput = {
  flow_type: ExternalCashFlowRow["flow_type"]
  amount_vnd: number
  effective_at: string
  note?: string | null
}

export function useExternalCashFlows(portfolioId: string) {
  const [rows, setRows] = useState<ExternalCashFlowRow[]>([])
  const [fundingHistoryStatus, setFundingHistoryStatus] = useState<FundingHistoryStatus>("known")
  const [loading, setLoading] = useState(Boolean(portfolioId))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!portfolioId) {
      setRows([])
      setFundingHistoryStatus("known")
      setLoading(false)
      return
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/cash-flows`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      })
      const payload = await response.json().catch(() => null) as CashFlowResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Không thể tải lịch sử dòng vốn ngoài.")
      }
      if (!signal?.aborted && requestIdRef.current === requestId) {
        setRows(payload.cash_flows ?? [])
        setFundingHistoryStatus(payload.funding_history_status ?? "known")
      }
    } catch (cause: unknown) {
      if (signal?.aborted) return
      if (requestIdRef.current === requestId) {
        setError(cause instanceof Error ? cause.message : "Không thể tải lịch sử dòng vốn ngoài.")
      }
    } finally {
      if (!signal?.aborted && requestIdRef.current === requestId) setLoading(false)
    }
  }, [portfolioId])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  const addCashFlow = useCallback(async (input: AddExternalCashFlowInput) => {
    if (!portfolioId) throw new Error("Danh mục không hợp lệ.")
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/portfolio/${portfolioId}/cash-flows`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const payload = await response.json().catch(() => null) as CashFlowResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Không thể ghi nhận dòng vốn ngoài.")
      }
      await refresh()
      return payload.cash_flow ?? null
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Không thể ghi nhận dòng vốn ngoài."
      setError(message)
      throw new Error(message)
    } finally {
      setSubmitting(false)
    }
  }, [portfolioId, refresh])

  return {
    rows,
    fundingHistoryStatus,
    loading,
    submitting,
    error,
    refresh,
    addCashFlow,
  }
}
