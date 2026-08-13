"use client"

import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { OrderBookPanel } from "@/components/orderbook/orderbook-panel"

export function OrderBookManager() {
  const { books, order, close, focus } = useOrderBooks()

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {books.map((book, index) => (
        <OrderBookPanel
          key={book.key}
          stockKey={book.key}
          symbol={book.symbol}
          index={index}
          z={70 + order.indexOf(book.key)}
          onClose={() => close(book.key)}
          onFocus={() => focus(book.key)}
        />
      ))}
    </div>
  )
}
