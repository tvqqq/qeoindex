"use client"

import { ArrowDown, ArrowRight, ArrowUp, Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useId, useMemo, useState } from "react"

import { StockLogo } from "@/components/stock-logo"

export type HomeStockSearchStock = {
  ticker: string
  companyName: string | null
  logoPath: string
}

type HomeStockSearchProps = {
  stocks: readonly HomeStockSearchStock[]
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("vi")
}

export function HomeStockSearch({ stocks }: HomeStockSearchProps) {
  const router = useRouter()
  const listboxId = useId()
  const [query, setQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)

  const filteredStocks = useMemo(() => {
    const needle = normalized(query)
    if (!needle) return stocks.slice(0, 200)
    return stocks
      .filter((stock) => {
        const companyName = normalized(stock.companyName ?? "")
        return normalized(stock.ticker).includes(needle) || companyName.includes(needle)
      })
      .slice(0, 200)
  }, [query, stocks])

  const activeStock = filteredStocks[Math.min(activeIndex, Math.max(filteredStocks.length - 1, 0))] ?? null
  const selectedStock = selectedTicker ? stocks.find((stock) => stock.ticker === selectedTicker) ?? null : null

  function goToTicker(ticker: string) {
    setIsOpen(false)
    router.push(`/insights/${ticker}`)
  }

  function submitSelection() {
    const exactTicker = stocks.find((stock) => normalized(stock.ticker) === normalized(query)) ?? null
    const target = selectedStock ?? exactTicker ?? activeStock
    if (target) goToTicker(target.ticker)
  }

  function moveActive(delta: number) {
    if (!filteredStocks.length) return
    setIsOpen(true)
    setActiveIndex((current) => {
      const next = current + delta
      if (next < 0) return filteredStocks.length - 1
      if (next >= filteredStocks.length) return 0
      return next
    })
  }

  return (
    <div
      data-home-stock-search
      data-open={isOpen ? "true" : "false"}
      className="relative mx-auto mt-5 w-full max-w-[560px] text-left"
    >
      <div className="relative rounded-[28px] border border-white/[0.1] bg-[#202328] p-2 shadow-[0_24px_54px_-28px_rgba(213,255,99,0.32)] transition-[border-color,box-shadow] duration-300 focus-within:border-[#d5ff63]/35 focus-within:shadow-[0_28px_62px_-28px_rgba(213,255,99,0.42)]">
        <div className="flex min-h-[68px] items-center gap-3 rounded-[22px] bg-[#111317] px-4 sm:px-5">
          <Search className="h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.8} aria-hidden="true" />
          <input
            value={query}
            type="text"
            role="combobox"
            aria-label="Tìm cổ phiếu"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-activedescendant={isOpen && activeStock ? `${listboxId}-${activeStock.ticker}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={stocks.length ? "Nhập mã hoặc tên công ty…" : "Danh sách cổ phiếu chưa sẵn sàng"}
            disabled={!stocks.length}
            className="min-w-0 flex-1 bg-transparent text-base font-bold text-white outline-none placeholder:font-medium placeholder:text-slate-600 disabled:cursor-not-allowed sm:text-lg"
            onFocus={() => {
              if (stocks.length) setIsOpen(true)
            }}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedTicker(null)
              setActiveIndex(0)
              setIsOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                moveActive(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                moveActive(-1)
                return
              }
              if (event.key === "Escape") {
                setIsOpen(false)
                return
              }
              if (event.key === "Enter") {
                event.preventDefault()
                submitSelection()
              }
            }}
          />
          <button
            type="button"
            aria-label="Mở Insights cho cổ phiếu đã chọn"
            disabled={!selectedStock && !activeStock}
            onClick={submitSelection}
            className="group/go flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#d5ff63] text-[#111317] shadow-[0_10px_28px_-16px_rgba(213,255,99,0.9)] transition-[transform,box-shadow,opacity] duration-300 hover:scale-[1.04] hover:shadow-[0_14px_34px_-14px_rgba(213,255,99,0.95)] disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transform-none motion-reduce:transition-none"
          >
            <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover/go:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {isOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Top Stocks 200"
          className="absolute left-0 right-0 top-[calc(100%+10px)] z-40 max-h-[340px] overflow-y-auto rounded-[24px] border border-white/[0.1] bg-[#15181d] p-2 shadow-[0_28px_70px_-24px_rgba(0,0,0,0.95)]"
        >
          {filteredStocks.length ? filteredStocks.map((stock, index) => {
            const active = index === activeIndex
            const selected = stock.ticker === selectedTicker
            return (
              <button
                key={stock.ticker}
                id={`${listboxId}-${stock.ticker}`}
                role="option"
                aria-selected={selected}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  setSelectedTicker(stock.ticker)
                  setQuery(stock.ticker)
                  setActiveIndex(index)
                  setIsOpen(false)
                }}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,transform] duration-200 motion-reduce:transition-none ${active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}
              >
                <StockLogo symbol={stock.ticker} logoPath={stock.logoPath} size={38} className="rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-ticker text-sm font-black text-white">{stock.ticker}</span>
                    {selected ? <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#d5ff63]">Đã chọn</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-400">{stock.companyName || "Tên công ty chưa cập nhật"}</span>
                </span>
                <ArrowRight className={`h-4 w-4 shrink-0 transition-[opacity,transform] duration-200 ${active ? "translate-x-0 opacity-70" : "-translate-x-1 opacity-0"}`} aria-hidden="true" />
              </button>
            )
          }) : (
            <div className="px-4 py-7 text-center text-sm text-slate-500">Không tìm thấy mã phù hợp.</div>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-center gap-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600" aria-hidden="true">
        <span className="inline-flex items-center gap-1"><ArrowDown className="h-3 w-3" /> <ArrowUp className="h-3 w-3" /> chọn</span>
        <span>Enter mở Insights</span>
      </div>
    </div>
  )
}
