"use client"

import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { LiveOrderBookPanel } from "@/components/orderbook/live-orderbook-panel"

export function OrderBookManager() {
  const { books, order, close, focus } = useOrderBooks()

  if (!books.length) return null

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Enhanced background blur backdrop overlay */}
      <div
        className="pointer-events-auto absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-200 animate-in fade-in"
        onClick={() => {
          const topKey = order[order.length - 1]
          if (topKey) focus(topKey)
        }}
      />

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
