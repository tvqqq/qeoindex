import { Board } from "@/components/board"
import { IndexBar } from "@/components/index-bar"
import { OrderBookManager } from "@/components/orderbook/orderbook-manager"
import { OrderBookProvider } from "@/components/orderbook/orderbook-context"
import { Sidebar } from "@/components/sidebar"
import { TopNav } from "@/components/top-nav"

export default function Page() {
  return (
    <OrderBookProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopNav />
        <IndexBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 pt-2.5">
            <Board />
          </main>
        </div>
        <OrderBookManager />
      </div>
    </OrderBookProvider>
  )
}
