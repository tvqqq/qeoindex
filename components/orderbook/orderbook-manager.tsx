"use client"

import { useOrderBooks } from "@/components/orderbook/orderbook-context"
import { OrderBookPanel } from "@/components/orderbook/orderbook-panel"

export function OrderBookManager() {
  const { books, order, close, focus } = useOrderBooks()

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div className="pointer-events-auto">
        {books.map((b, i) => (
          <OrderBookPanel
            key={b.key}
            stockKey={b.key}
            index={i}
            z={40 + order.indexOf(b.key)}
            onClose={() => close(b.key)}
            onFocus={() => focus(b.key)}
          />
        ))}
      </div>
    </div>
  )
}
