"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type LargeTradeAlert = {
  tradeId: string
  side: "BUY" | "SELL" | "REF"
  volume: number
  isWhale: boolean
}

// A single static notice replaces the former full-panel effect.
const NOTICE_DURATION_MS = 2_000

export function useLargeTradeNotice() {
  const [notice, setNotice] = useState<LargeTradeAlert | null>(null)
  const timerRef = useRef<number | null>(null)

  const fire = useCallback((next: LargeTradeAlert): boolean => {
    if (timerRef.current !== null) return false
    setNotice(next)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setNotice(null)
    }, NOTICE_DURATION_MS)
    return true
  }, [])

  const clear = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    setNotice(null)
  }, [])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return { notice, fire, clear }
}

export function LargeTradeNotice({ notice }: { notice: LargeTradeAlert | null }) {
  if (!notice) return null

  const tone = notice.side === "SELL"
    ? "border-rose-400/50 bg-[#321a22] text-rose-200"
    : notice.side === "BUY"
      ? "border-emerald-400/50 bg-[#102e29] text-emerald-200"
      : "border-slate-400/50 bg-[#1c2733] text-slate-200"

  return (
    <div
      data-orderbook-large-trade-notice
      role="status"
      aria-live="polite"
      className={`pointer-events-none inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-semibold ${tone}`}
    >
      <span>{notice.isWhale ? "Lệnh cá mập" : "Lệnh lớn"}</span>
      <span className="font-mono font-bold tabular-nums">{notice.volume.toLocaleString("vi-VN")} cp</span>
    </div>
  )
}
