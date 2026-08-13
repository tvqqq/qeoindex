"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Link2, LogOut, RefreshCw } from "lucide-react"

type LiveState = {
  connected: boolean
  state: "LIVE" | "AUTH_REQUIRED" | "ERROR" | "LOADING"
  message: string
  session?: string
  connectUrl?: string
}

type Quote = {
  symbol: string
  price?: number
  value?: number
  changePercent?: number
  updatedAt?: string
}

function displayNumber(value: number | undefined) {
  if (typeof value !== "number") return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

function displayTime(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)
}

export function FinhayLiveControl({
  symbols = [],
  indexes = [],
  showQuotes = true,
}: {
  symbols?: string[]
  indexes?: string[]
  showQuotes?: boolean
}) {
  const [status, setStatus] = useState<LiveState>({ connected: false, state: "LOADING", message: "Đang kiểm tra Finhay..." })
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [refreshing, setRefreshing] = useState(false)

  const quoteUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (symbols.length) params.set("symbols", symbols.join(","))
    if (indexes.length) params.set("indexes", indexes.join(","))
    return params.size ? `/api/finhay/quote?${params.toString()}` : ""
  }, [indexes, symbols])

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/finhay/status", { cache: "no-store" })
      const payload = await response.json()
      setStatus({
        connected: Boolean(payload.connected),
        state: payload.state ?? "ERROR",
        message: payload.message ?? "",
        session: payload.session,
        connectUrl: payload.connectUrl,
      })
      return Boolean(payload.connected)
    } catch {
      setStatus({ connected: false, state: "ERROR", message: "Không đọc được trạng thái Finhay MCP." })
      return false
    }
  }, [])

  const loadQuotes = useCallback(async () => {
    if (!quoteUrl) return
    try {
      const response = await fetch(quoteUrl, { cache: "no-store" })
      if (!response.ok) return
      const payload = await response.json()
      setQuotes(payload.quotes ?? {})
    } catch {
      // Keep last good live snapshot visible if a refresh fails.
    }
  }, [quoteUrl])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const connected = await loadStatus()
    if (connected && showQuotes) await loadQuotes()
    setRefreshing(false)
  }, [loadQuotes, loadStatus, showQuotes])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!status.connected || !showQuotes || !quoteUrl) return
    const timer = window.setInterval(() => void loadQuotes(), 15_000)
    return () => window.clearInterval(timer)
  }, [loadQuotes, quoteUrl, showQuotes, status.connected])

  const quoteRows = [...indexes, ...symbols].map((symbol) => quotes[symbol]).filter(Boolean)

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className={[
          "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold",
          status.connected ? "border-up/30 bg-up/10 text-up" : status.state === "ERROR" ? "border-down/30 bg-down/10 text-down" : "border-ref/30 bg-ref/10 text-ref",
        ].join(" ")}>
          <Activity className="h-3.5 w-3.5" />
          {status.connected ? `Finhay Live${status.session ? ` · ${status.session}` : ""}` : status.state === "LOADING" ? "Finhay đang kiểm tra" : "Finhay cần xác thực"}
        </span>

        {status.connected ? (
          <form action="/api/finhay/auth/disconnect" method="post">
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-panel-2 px-3 py-1.5 text-xs font-medium text-foreground/70 hover:text-foreground">
              <LogOut className="h-3.5 w-3.5" /> Ngắt
            </button>
          </form>
        ) : (
          <a href={status.connectUrl ?? "/api/finhay/auth/start"} className="inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand">
            <Link2 className="h-3.5 w-3.5" /> Kết nối Finhay
          </a>
        )}

        <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="Làm mới Finhay" className="rounded-md border border-border-strong bg-panel-2 p-1.5 text-foreground/60 hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {showQuotes && status.connected && quoteRows.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {quoteRows.map((quote) => {
            const value = quote.price ?? quote.value
            const change = quote.changePercent ?? 0
            return (
              <div key={quote.symbol} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-right">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold text-foreground">{quote.symbol}</span>
                  <span className="font-mono text-xs text-foreground/85">{displayNumber(value)}</span>
                  <span className={`font-mono text-[11px] font-semibold ${change >= 0 ? "text-up" : "text-down"}`}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
                </div>
                {quote.updatedAt && <div className="mt-0.5 text-[10px] text-foreground/40">Finhay · {displayTime(quote.updatedAt)}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
