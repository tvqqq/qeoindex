"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  BOARD_EXCHANGES,
  filterBoardTickers,
  normalizeStockFilterCriteria,
  type BoardExchange,
  type FilterableBoardStock,
  type FilterQuote,
  type StockFilterCriteriaV1,
} from "@/lib/market-board/stock-filter"

interface StockFilterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  universe: readonly FilterableBoardStock[]
  quotes: Readonly<Record<string, FilterQuote | undefined>>
  initialCriteria: StockFilterCriteriaV1
  onApply: (criteria: StockFilterCriteriaV1, tickers: string[]) => void
  persistenceError?: string
  isRefreshing?: boolean
}

function digitsOnly(value: string) {
  const digits = value.replace(/[^0-9]/g, "")
  return digits ? Number(digits) : null
}

function inputValue(value: number | null) {
  return value == null ? "" : String(Math.round(value))
}

export function StockFilterModal({
  open,
  onOpenChange,
  universe,
  quotes,
  initialCriteria,
  onApply,
  persistenceError,
  isRefreshing = false,
}: StockFilterModalProps) {
  const availableSectors = useMemo(
    () => [...new Set(universe.map((stock) => stock.kfspSector.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
    [universe],
  )
  const [exchanges, setExchanges] = useState<Set<BoardExchange>>(() => new Set(initialCriteria.exchanges))
  const [sectors, setSectors] = useState<Set<string>>(() => new Set(initialCriteria.sectors))
  const [minPrice, setMinPrice] = useState(() => inputValue(initialCriteria.minPriceVnd))
  const [minVolume, setMinVolume] = useState(() => inputValue(initialCriteria.minVolumeShares))

  useEffect(() => {
    if (!open) return
    setExchanges(new Set(initialCriteria.exchanges))
    setSectors(new Set(initialCriteria.sectors))
    setMinPrice(inputValue(initialCriteria.minPriceVnd))
    setMinVolume(inputValue(initialCriteria.minVolumeShares))
  }, [initialCriteria, open])

  const criteria = useMemo(() => normalizeStockFilterCriteria({
    version: 1,
    exchanges: [...exchanges],
    minPriceVnd: digitsOnly(minPrice),
    minVolumeShares: digitsOnly(minVolume),
    sectors: [...sectors],
  }, availableSectors), [availableSectors, exchanges, minPrice, minVolume, sectors])

  const previewTickers = useMemo(
    () => criteria ? filterBoardTickers(universe, quotes, criteria) : [],
    [criteria, quotes, universe],
  )

  const toggleExchange = (exchange: BoardExchange) => {
    setExchanges((current) => {
      const next = new Set(current)
      if (next.has(exchange)) next.delete(exchange)
      else next.add(exchange)
      return next
    })
  }

  const toggleSector = (sector: string) => {
    setSectors((current) => {
      const next = new Set(current)
      if (next.has(sector)) next.delete(sector)
      else next.add(sector)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-hidden border-white/[0.12] bg-[#0b0f14] p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-white/[0.08] px-5 py-4">
          <DialogTitle className="text-base font-bold text-foreground">Filter CP</DialogTitle>
          <DialogDescription>
            Lọc cổ phiếu trong universe hiện tại. Giá nhập theo đồng, thanh khoản theo số cổ phiếu khớp trong phiên.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">Sàn</div>
            <div className="flex flex-wrap gap-2">
              {BOARD_EXCHANGES.map((exchange) => (
                <label key={exchange} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={exchanges.has(exchange)}
                    onChange={() => toggleExchange(exchange)}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  {exchange}
                </label>
              ))}
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-2">Giá cổ phiếu &gt;</span>
              <div className="relative">
                <Input
                  inputMode="numeric"
                  value={minPrice}
                  onChange={(event) => setMinPrice(event.target.value)}
                  placeholder="20.000"
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-2">đ</span>
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-2">Thanh khoản &gt;</span>
              <div className="relative">
                <Input
                  inputMode="numeric"
                  value={minVolume}
                  onChange={(event) => setMinVolume(event.target.value)}
                  placeholder="1.000.000"
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-2">cp</span>
              </div>
            </label>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-2">Ngành nghề (KFSP)</div>
              <button
                type="button"
                onClick={() => setSectors(new Set(availableSectors))}
                className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
              >
                Chọn tất cả
              </button>
            </div>
            <div className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/10 p-3 sm:grid-cols-2">
              {availableSectors.map((sector) => (
                <label key={sector} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={sectors.has(sector)}
                    onChange={() => toggleSector(sector)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
                  />
                  <span>{sector}</span>
                </label>
              ))}
            </div>
          </section>

          {persistenceError ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {persistenceError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="m-0 items-center justify-between rounded-none border-white/[0.08] bg-white/[0.025] px-5 py-3 sm:flex-row">
          <div className="mr-auto text-xs text-muted-2">
            {isRefreshing ? (
              <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang cập nhật giá &amp; thanh khoản...</span>
            ) : (
              <span>Đã chọn <b className="text-foreground">{previewTickers.length}</b> / {universe.length} CP</span>
            )}
          </div>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button
            type="button"
            disabled={!criteria || isRefreshing}
            onClick={() => criteria && onApply({ ...criteria, updatedAt: new Date().toISOString() }, previewTickers)}
          >
            Áp dụng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default StockFilterModal
