"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type LargeTradeAlert = {
  tradeId: string
  side: "BUY" | "SELL" | "REF"
  volume: number
  price: number
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

