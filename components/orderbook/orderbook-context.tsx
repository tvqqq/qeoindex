"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"

export interface StockInitialMeta {
  companyName?: string
  sector?: string
  price?: number
  reference?: number
  ceiling?: number
  floor?: number
  changePercent?: number
  volume?: number
  history?: number[]
}

export interface OpenBook {
  key: string // group:symbol
  symbol: string
  initialMeta?: StockInitialMeta
}

interface OrderBookCtx {
  books: OpenBook[]
  open: (key: string, symbol: string, initialMeta?: StockInitialMeta) => void
  close: (key: string) => void
  isOpen: (key: string) => boolean
  focus: (key: string) => void
  order: string[] // z-order, last = top
}

const Ctx = createContext<OrderBookCtx | null>(null)

export function OrderBookProvider({ children }: { children: React.ReactNode }) {
  const [books, setBooks] = useState<OpenBook[]>([])
  const [order, setOrder] = useState<string[]>([])

  const open = useCallback((key: string, symbol: string, initialMeta?: StockInitialMeta) => {
    setBooks((prev) => {
      const existing = prev.find((b) => b.key === key)
      if (existing) {
        if (initialMeta && !existing.initialMeta) {
          return prev.map((b) => (b.key === key ? { ...b, initialMeta } : b))
        }
        return prev
      }
      return [...prev, { key, symbol, initialMeta }]
    })
    setOrder((prev) => [...prev.filter((k) => k !== key), key])
  }, [])

  const close = useCallback((key: string) => {
    setBooks((prev) => prev.filter((b) => b.key !== key))
    setOrder((prev) => prev.filter((k) => k !== key))
  }, [])

  const focus = useCallback((key: string) => {
    setOrder((prev) => [...prev.filter((k) => k !== key), key])
  }, [])

  const isOpen = useCallback((key: string) => books.some((b) => b.key === key), [books])

  const value = useMemo(
    () => ({ books, open, close, isOpen, focus, order }),
    [books, open, close, isOpen, focus, order],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useOrderBooks() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useOrderBooks must be used within OrderBookProvider")
  return ctx
}
