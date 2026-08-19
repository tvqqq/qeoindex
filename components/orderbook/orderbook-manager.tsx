"use client"

import { useEffect } from "react"
import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { LiveOrderBookPanel } from "@/components/orderbook/live-orderbook-panel"

export function OrderBookManager() {
  const { books, order, close, focus } = useOrderBooks()

  // ESC Shortcut: close the currently focused / top-most popup
  useEffect(() => {
    if (!books.length) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        const topKey = order[order.length - 1] || books[books.length - 1]?.key
        if (topKey) {
          close(topKey)
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [books, order, close])

  if (!books.length) return null

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {books.map((book, index) => (
        <LiveOrderBookPanel
          key={book.key}
          stockKey={book.key}
          symbol={book.symbol}
          initialMeta={book.initialMeta}
          index={index}
          z={70 + order.indexOf(book.key)}
          onClose={() => close(book.key)}
          onFocus={() => focus(book.key)}
        />
      ))}
    </div>
  )
}
