"use client"

import Link from "next/link"
import React, { useState, useCallback, useEffect, useMemo } from "react"
import { Eye, Plus, Trash2, Star, TrendingUp, TrendingDown, Minus, Bell } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/modules/shared/ui/cn"

export interface WatchlistMeta {
  id: string
  name: string
  is_default: boolean
  sort_order: number
}

export interface WatchlistItem {
  id: string
  watchlist_id: string
  ticker: string
  sort_order: number
  note: string | null
  alert_price_above: number | null
  alert_price_below: number | null
  tags: string[]
  created_at: string
  updated_at: string
}

interface MarketQuote {
  price: number | null
  reference: number | null
  change: number | null
  changePercent: number | null
}

interface WatchlistPanelProps {
  initialWatchlists: WatchlistMeta[]
  initialActiveId: string
  initialItems: WatchlistItem[]
}

export function WatchlistPanel({
  initialWatchlists,
  initialActiveId,
  initialItems,
}: WatchlistPanelProps) {
  const [watchlists, setWatchlists] = useState<WatchlistMeta[]>(initialWatchlists)
  const [activeId, setActiveId] = useState(initialActiveId)
  const [items, setItems] = useState<WatchlistItem[]>(initialItems)
  const [loadingItems, setLoadingItems] = useState(false)
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({})

  // Dialog states
  const [addTickerOpen, setAddTickerOpen] = useState(false)
  const [newTickerInput, setNewTickerInput] = useState("")
  const [newNoteInput, setNewNoteInput] = useState("")
  const [newAlertAbove, setNewAlertAbove] = useState("")
  const [newAlertBelow, setNewAlertBelow] = useState("")
  const [addingTicker, setAddingTicker] = useState(false)
  const [addTickerError, setAddTickerError] = useState("")

  const [createWlOpen, setCreateWlOpen] = useState(false)
  const [newWlName, setNewWlName] = useState("")
  const [creatingWl, setCreatingWl] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Load items for a watchlist
  const loadItems = useCallback(async (watchlistId: string) => {
    setLoadingItems(true)
    try {
      const res = await fetch(`/api/watchlist?wid=${watchlistId}`, { cache: "no-store", credentials: "same-origin" })
      if (!res.ok) return
      const data = (await res.json()) as { ok: boolean; items?: WatchlistItem[] }
      if (data.ok && data.items) setItems(data.items)
    } finally {
      setLoadingItems(false)
    }
  }, [])

  const handleSelectWatchlist = useCallback(
    (id: string) => {
      setActiveId(id)
      loadItems(id)
    },
    [loadItems],
  )

  // Fetch quotes for all tickers currently in watchlist
  const tickersKey = useMemo(() => items.map((i) => i.ticker).join(","), [items])

  useEffect(() => {
    if (!tickersKey) return
    fetch(`/api/market/intraday?tickers=${tickersKey}`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { histories?: Record<string, { price: number; reference: number; change: number; changePercent: number }> } | null) => {
        if (!data?.histories) return
        const map: Record<string, MarketQuote> = {}
        for (const [ticker, quote] of Object.entries(data.histories)) {
          map[ticker] = {
            price: quote.price,
            reference: quote.reference,
            change: quote.change,
            changePercent: quote.changePercent,
          }
        }
        setQuotes(map)
      })
      .catch(() => {})
  }, [tickersKey])

  // Up / Ref / Down stats
  const { upCount, refCount, downCount } = useMemo(() => {
    let up = 0
    let ref = 0
    let down = 0
    for (const item of items) {
      const q = quotes[item.ticker]
      if (!q || q.change == null || q.change === 0) {
        ref++
      } else if (q.change > 0) {
        up++
      } else {
        down++
      }
    }
    return { upCount: up, refCount: ref, downCount: down }
  }, [items, quotes])

  // Handlers
  const handleAddTicker = async () => {
    const ticker = newTickerInput.trim().toUpperCase()
    if (!ticker) {
      setAddTickerError("Vui lòng nhập mã cổ phiếu.")
      return
    }
    setAddingTicker(true)
    setAddTickerError("")
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          watchlist_id: activeId,
          ticker,
          note: newNoteInput.trim() || null,
          alert_price_above: newAlertAbove ? parseFloat(newAlertAbove) : null,
          alert_price_below: newAlertBelow ? parseFloat(newAlertBelow) : null,
        }),
      })
      const data = (await res.json()) as { ok: boolean; item?: WatchlistItem; error?: string }
      if (!res.ok || !data.ok) {
        setAddTickerError(data.error || "Không thể thêm mã vào watchlist.")
        return
      }
      if (data.item) {
        setItems((prev) => [...prev, data.item!])
      }
      setNewTickerInput("")
      setNewNoteInput("")
      setNewAlertAbove("")
      setNewAlertBelow("")
      setAddTickerOpen(false)
    } finally {
      setAddingTicker(false)
    }
  }

  const handleRemoveTicker = async (itemId: string) => {
    const res = await fetch(`/api/watchlist?id=${itemId}`, {
      method: "DELETE",
      credentials: "same-origin",
    })
    if (!res.ok) return
    const data = (await res.json()) as { ok: boolean }
    if (data.ok) {
      setItems((prev) => prev.filter((i) => i.id !== itemId))
    }
  }

  const handleCreateWatchlist = async () => {
    const name = newWlName.trim()
    if (!name) return
    setCreatingWl(true)
    try {
      const res = await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { ok: boolean; watchlist?: WatchlistMeta }
      if (data.ok && data.watchlist) {
        setWatchlists((prev) => [...prev, data.watchlist!])
        setActiveId(data.watchlist.id)
        setItems([])
        setNewWlName("")
        setCreateWlOpen(false)
      }
    } finally {
      setCreatingWl(false)
    }
  }

  const handleDeleteWatchlist = async (id: string) => {
    const res = await fetch(`/api/watchlist?wid=${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    })
    if (!res.ok) return
    const data = (await res.json()) as { ok: boolean }
    if (data.ok) {
      setWatchlists((prev) => {
        const next = prev.filter((w) => w.id !== id)
        if (activeId === id && next.length > 0) {
          handleSelectWatchlist(next[0].id)
        }
        return next
      })
      setDeleteConfirm(null)
    }
  }

  const activeWatchlist = watchlists.find((w) => w.id === activeId)

  return (
    <div className="space-y-4 font-ticker">
      {/* Watchlist Tabs Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3">
        {watchlists.map((wl) => (
          <button
            key={wl.id}
            type="button"
            onClick={() => handleSelectWatchlist(wl.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-bold transition-colors cursor-pointer",
              wl.id === activeId
                ? "border-purple-500/50 bg-purple-500/20 text-purple-300 shadow-sm"
                : "border-[var(--color-border)] text-[var(--color-muted-2)] hover:border-white/20 hover:text-white",
            )}
          >
            {wl.is_default && <Star className="h-3.5 w-3.5 text-amber-400" />}
            <span>{wl.name}</span>
          </button>
        ))}

        {watchlists.length < 5 && (
          <button
            type="button"
            onClick={() => setCreateWlOpen(true)}
            className="flex items-center gap-1 rounded-full border border-dashed border-white/20 px-3.5 py-1.5 text-xs font-bold text-[var(--color-muted-2)] transition-colors hover:border-white/40 hover:text-white cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tạo mới</span>
          </button>
        )}
      </div>

      {/* Active watchlist toolbar & Up/Ref/Down summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-purple-400" />
            <span className="font-ticker text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
              {activeWatchlist?.name ?? "Danh sách theo dõi"}
            </span>
            <span className="font-ticker text-xs font-semibold text-[var(--color-muted-2)]">({items.length} mã)</span>
          </div>

          {/* Up / Ref / Down pills (KFSP style) */}
          {items.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-black/40 px-2.5 py-0.5 font-ticker text-xs font-bold">
              <span className="flex items-center gap-0.5 text-[var(--color-up)]">
                <TrendingUp className="h-3 w-3" /> {upCount}
              </span>
              <span className="text-[var(--color-border)]">|</span>
              <span className="flex items-center gap-0.5 text-[var(--color-ref)]">
                <Minus className="h-3 w-3" /> {refCount}
              </span>
              <span className="text-[var(--color-border)]">|</span>
              <span className="flex items-center gap-0.5 text-[var(--color-down)]">
                <TrendingDown className="h-3 w-3" /> {downCount}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {watchlists.length > 1 && (
            <button
              type="button"
              onClick={() => setDeleteConfirm(activeId)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-muted-2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-down)] cursor-pointer"
              title="Xóa danh sách này"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <Button
            size="sm"
            onClick={() => setAddTickerOpen(true)}
            className="h-8 gap-1.5 rounded-full border-[var(--color-up)]/30 bg-[var(--color-up)]/10 px-3.5 text-xs font-bold text-[var(--color-up)] hover:bg-[var(--color-up)]/20 transition-colors cursor-pointer"
            variant="outline"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm mã
          </Button>
        </div>
      </div>

      {/* Items table */}
      <div className="overflow-x-auto rounded-3xl border border-[#252837] bg-[#11131c]">
        <div className="min-w-[620px]">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_110px_110px_90px_60px] gap-2 border-b border-[var(--color-border)] px-4 py-2.5 font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
            <span>Mã / Ghi chú</span>
            <span className="text-right">Giá TT (k₫)</span>
            <span className="text-right">% Ngày</span>
            <span className="text-right">Cảnh báo</span>
            <span className="text-right">Thao tác</span>
          </div>

          {loadingItems ? (
            <div className="space-y-0">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-11 animate-pulse border-b border-[var(--color-border)] bg-white/[0.02]" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Eye className="h-8 w-8 text-[var(--color-muted)]" />
              <p className="font-ticker text-sm font-semibold text-slate-300">Chưa có mã nào trong danh sách</p>
              <Button size="sm" variant="outline" onClick={() => setAddTickerOpen(true)} className="mt-1 gap-1.5 font-ticker text-xs">
                <Plus className="h-3.5 w-3.5" />
                Thêm mã cổ phiếu
              </Button>
            </div>
          ) : (
            items.map((item) => {
              const quote = quotes[item.ticker]
              const price = quote?.price
              const changePct = quote?.changePercent
              const isUp = changePct != null && changePct > 0
              const isDown = changePct != null && changePct < 0

              return (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_110px_110px_90px_60px] items-center gap-2 border-b border-white/5 px-4 py-2.5 hover:bg-white/[0.04] transition-colors last:border-0"
                >
                  {/* Ticker & Note */}
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/insights/wyckoff?ticker=${item.ticker}`}
                        prefetch={false}
                        className="font-ticker text-sm font-black uppercase tracking-wider text-purple-300 hover:text-purple-200 transition-colors"
                      >
                        {item.ticker}
                      </Link>
                    </div>
                    {item.note && (
                      <span className="font-ticker text-xs text-[var(--color-muted-2)] truncate mt-0.5 italic">
                        &ldquo;{item.note}&rdquo;
                      </span>
                    )}
                  </div>

                  {/* Giá TT */}
                  <div className="text-right font-ticker text-xs sm:text-sm font-bold tabular-nums">
                    {price != null ? (
                      <span
                        className={
                          isUp
                            ? "text-[var(--color-up)]"
                            : isDown
                            ? "text-[var(--color-down)]"
                            : "text-[var(--color-ref)]"
                        }
                      >
                        {price.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted-2)]">–</span>
                    )}
                  </div>

                  {/* % Ngày */}
                  <div className="text-right font-ticker text-xs sm:text-sm font-bold tabular-nums">
                    {changePct != null ? (
                      <span
                        className={
                          isUp
                            ? "text-[var(--color-up)]"
                            : isDown
                            ? "text-[var(--color-down)]"
                            : "text-[var(--color-ref)]"
                        }
                      >
                        {isUp ? "▲ +" : isDown ? "▼ " : "– "}
                        {Math.abs(changePct).toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted-2)]">–</span>
                    )}
                  </div>

                  {/* Alerts */}
                  <div className="text-right font-ticker text-[11px] text-[var(--color-muted-2)]">
                    {item.alert_price_above || item.alert_price_below ? (
                      <div className="flex items-center justify-end gap-1 text-purple-300">
                        <Bell className="h-3 w-3" />
                        <span>
                          {item.alert_price_above ? `>${item.alert_price_above}` : ""}
                          {item.alert_price_below ? ` <${item.alert_price_below}` : ""}
                        </span>
                      </div>
                    ) : (
                      "–"
                    )}
                  </div>

                  {/* Delete button */}
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => handleRemoveTicker(item.id)}
                      className="p-1 text-[var(--color-muted-2)] hover:text-[var(--color-down)] transition-colors rounded-full hover:bg-[var(--color-down)]/10 cursor-pointer"
                      title="Xóa mã khỏi watchlist"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Add Ticker Dialog */}
      <Dialog open={addTickerOpen} onOpenChange={setAddTickerOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="font-ticker text-sm font-bold text-white">Thêm mã vào Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1 font-ticker">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-muted-2)]">
                Mã cổ phiếu <span className="text-[var(--color-down)]">*</span>
              </label>
              <Input
                value={newTickerInput}
                onChange={(e) => setNewTickerInput(e.target.value.toUpperCase())}
                placeholder="VD: HPG, SSI, VCB"
                maxLength={10}
                className="font-ticker uppercase text-xs font-bold"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-muted-2)]">Ghi chú theo dõi</label>
              <Input
                value={newNoteInput}
                onChange={(e) => setNewNoteInput(e.target.value)}
                placeholder="VD: Chờ Spring Pha C test MA20"
                maxLength={100}
                className="font-ticker text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">Báo giá khi &gt; (k₫)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={newAlertAbove}
                  onChange={(e) => setNewAlertAbove(e.target.value)}
                  placeholder="30.5"
                  className="font-ticker text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">Báo giá khi &lt; (k₫)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={newAlertBelow}
                  onChange={(e) => setNewAlertBelow(e.target.value)}
                  placeholder="24.0"
                  className="font-ticker text-xs"
                />
              </div>
            </div>
            {addTickerError && (
              <p className="text-xs font-bold text-[var(--color-down)]">{addTickerError}</p>
            )}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setAddTickerOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleAddTicker}
              disabled={addingTicker || !newTickerInput.trim()}
              className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs"
            >
              {addingTicker ? "Đang thêm..." : "Thêm vào danh sách"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Watchlist Dialog */}
      <Dialog open={createWlOpen} onOpenChange={setCreateWlOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="font-ticker text-sm font-bold text-white">Tạo danh sách theo dõi mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1 font-ticker">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-muted-2)]">
                Tên danh sách <span className="text-[var(--color-down)]">*</span>
              </label>
              <Input
                value={newWlName}
                onChange={(e) => setNewWlName(e.target.value)}
                placeholder="VD: Cổ phiếu Vượt đỉnh, Sóng BĐS..."
                maxLength={60}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setCreateWlOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleCreateWatchlist}
              disabled={creatingWl || !newWlName.trim()}
              className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs"
            >
              {creatingWl ? "Đang tạo..." : "Tạo danh sách"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Watchlist Confirm Dialog */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="font-ticker text-sm font-bold text-white">Xóa danh sách theo dõi?</DialogTitle>
          </DialogHeader>
          <p className="font-ticker text-xs sm:text-sm text-[var(--color-muted-2)]">
            Tất cả mã theo dõi trong danh sách{" "}
            <span className="font-bold text-white">
              {watchlists.find((w) => w.id === deleteConfirm)?.name}
            </span>{" "}
            sẽ bị xóa.
          </p>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
              Hủy
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteConfirm && handleDeleteWatchlist(deleteConfirm)}
            >
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
