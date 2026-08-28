"use client"

import Link from "next/link"
import React, { useState, useCallback, useEffect, useMemo, memo } from "react"
import { Eye, Plus, Trash2, Star, TrendingUp, TrendingDown, Minus, Bell } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface WatchlistMeta {
  id: string
  name: string
  is_default: boolean
  sort_order: number
}

interface WatchlistItem {
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
        const newQuotes: Record<string, MarketQuote> = {}
        for (const [sym, h] of Object.entries(data.histories)) {
          newQuotes[sym] = {
            price: h.price,
            reference: h.reference,
            change: h.change,
            changePercent: h.changePercent,
          }
        }
        setQuotes(newQuotes)
      })
      .catch(() => {})
  }, [tickersKey])

  // Compute market summary (Up / Ref / Down counts)
  const { upCount, refCount, downCount } = useMemo(() => {
    let u = 0
    let r = 0
    let d = 0
    for (const item of items) {
      const q = quotes[item.ticker]
      if (q && q.changePercent !== null) {
        if (q.changePercent > 0) u++
        else if (q.changePercent < 0) d++
        else r++
      }
    }
    return { upCount: u, refCount: r, downCount: d }
  }, [items, quotes])

  const handleAddTicker = useCallback(async () => {
    const ticker = newTickerInput.trim().toUpperCase()
    if (!ticker) return
    setAddingTicker(true)
    setAddTickerError("")

    const parsedAbove = newAlertAbove ? parseFloat(newAlertAbove) : null
    const parsedBelow = newAlertBelow ? parseFloat(newAlertBelow) : null

    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ticker,
          watchlistId: activeId,
          note: newNoteInput.trim() || null,
          alertPriceAbove: parsedAbove,
          alertPriceBelow: parsedBelow,
        }),
      })
      const data = (await res.json()) as { ok: boolean; item?: WatchlistItem; error?: string }
      if (!data.ok) {
        setAddTickerError(data.error ?? "Thêm thất bại.")
        return
      }
      if (data.item) {
        setItems((prev) => {
          const filtered = prev.filter((i) => i.ticker !== ticker)
          return [...filtered, data.item!].sort((a, b) => a.sort_order - b.sort_order)
        })
      }
      setNewTickerInput("")
      setNewNoteInput("")
      setNewAlertAbove("")
      setNewAlertBelow("")
      setAddTickerOpen(false)
    } finally {
      setAddingTicker(false)
    }
  }, [newTickerInput, newNoteInput, newAlertAbove, newAlertBelow, activeId])

  const handleRemoveTicker = useCallback(
    async (ticker: string) => {
      const res = await fetch(`/api/watchlist?ticker=${ticker}&wid=${activeId}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      const data = (await res.json()) as { ok: boolean }
      if (data.ok) {
        setItems((prev) => prev.filter((i) => i.ticker !== ticker))
      }
    },
    [activeId],
  )

  const handleCreateWatchlist = useCallback(async () => {
    const name = newWlName.trim()
    if (!name) return
    setCreatingWl(true)
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ createNew: true, name }),
      })
      const data = (await res.json()) as { ok: boolean; watchlist?: WatchlistMeta; error?: string }
      if (!data.ok || !data.watchlist) return
      setWatchlists((prev) => [...prev, data.watchlist!])
      setNewWlName("")
      setCreateWlOpen(false)
    } finally {
      setCreatingWl(false)
    }
  }, [newWlName])

  const handleDeleteWatchlist = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/watchlist?watchlistId=${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      const data = (await res.json()) as { ok: boolean }
      if (data.ok) {
        setWatchlists((prev) => prev.filter((w) => w.id !== id))
        if (activeId === id) {
          const remaining = watchlists.filter((w) => w.id !== id)
          if (remaining.length > 0) {
            setActiveId(remaining[0].id)
            loadItems(remaining[0].id)
          }
        }
      }
      setDeleteConfirm(null)
    },
    [activeId, watchlists, loadItems],
  )

  const activeWatchlist = watchlists.find((w) => w.id === activeId)

  return (
    <div className="flex flex-col gap-4">
      {/* Watchlist selector row */}
      <div className="flex flex-wrap items-center gap-2">
        {watchlists.map((wl) => (
          <button
            key={wl.id}
            type="button"
            onClick={() => handleSelectWatchlist(wl.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              wl.id === activeId
                ? "border-[var(--color-up)]/40 bg-[var(--color-up)]/10 text-[var(--color-up)] font-semibold"
                : "border-[var(--color-border)] text-[var(--color-muted-2)] hover:border-white/20 hover:text-white",
            )}
          >
            {wl.is_default && <Star className="h-3 w-3" />}
            <span>{wl.name}</span>
          </button>
        ))}

        {watchlists.length < 5 && (
          <button
            type="button"
            onClick={() => setCreateWlOpen(true)}
            className="flex items-center gap-1 rounded-full border border-dashed border-white/20 px-3 py-1.5 text-xs text-[var(--color-muted-2)] transition-colors hover:border-white/40 hover:text-white"
          >
            <Plus className="h-3 w-3" />
            <span>Tạo mới</span>
          </button>
        )}
      </div>

      {/* Active watchlist toolbar & Up/Ref/Down summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-[var(--color-muted-2)]" />
            <span className="text-sm font-semibold text-[var(--color-foreground)]">
              {activeWatchlist?.name ?? "Danh sách theo dõi"}
            </span>
            <span className="text-xs text-[var(--color-muted-2)]">({items.length} mã)</span>
          </div>

          {/* Up / Ref / Down pills (KFSP style) */}
          {items.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-black/30 px-2 py-0.5 font-ticker text-[11px]">
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
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-muted-2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-down)]"
              title="Xóa danh sách này"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <Button
            size="sm"
            onClick={() => setAddTickerOpen(true)}
            className="h-7 gap-1.5 rounded-full border-[var(--color-up)]/30 bg-[var(--color-up)]/10 px-3 text-xs font-medium text-[var(--color-up)] hover:bg-[var(--color-up)]/20"
            variant="outline"
          >
            <Plus className="h-3 w-3" />
            Thêm mã
          </Button>
        </div>
      </div>

      {/* Items table */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[#0b0f13] overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_100px_100px_80px_60px] gap-2 border-b border-[var(--color-border)] px-4 py-2.5 text-xs font-medium text-[var(--color-muted-2)]">
          <span>Mã / Ghi chú</span>
          <span className="text-right">Giá (k₫)</span>
          <span className="text-right">% Ngày</span>
          <span className="text-right">Cảnh báo</span>
          <span className="text-right">Thao tác</span>
        </div>

        {loadingItems ? (
          <div className="space-y-0">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse border-b border-[var(--color-border)] bg-white/[0.02]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Eye className="h-8 w-8 text-[var(--color-muted)]" />
            <p className="text-sm text-[var(--color-muted-2)]">Chưa có mã nào trong danh sách</p>
            <Button size="sm" variant="outline" onClick={() => setAddTickerOpen(true)} className="mt-1 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Thêm mã cổ phiếu
            </Button>
          </div>
        ) : (
          <div>
            {items.map((item) => (
              <WatchlistItemRow
                key={item.id}
                item={item}
                quote={quotes[item.ticker]}
                onRemove={handleRemoveTicker}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Ticker Dialog with Note & Price Alerts */}
      <Dialog open={addTickerOpen} onOpenChange={setAddTickerOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-white">Thêm mã vào danh sách theo dõi</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted-2)]">
                Mã cổ phiếu <span className="text-[var(--color-down)]">*</span>
              </label>
              <Input
                value={newTickerInput}
                onChange={(e) => setNewTickerInput(e.target.value.toUpperCase())}
                placeholder="VD: VCB, FPT, VNM"
                className="font-ticker uppercase text-xs"
                maxLength={12}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTicker()
                }}
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted-2)]">Ghi chú (tùy chọn)</label>
              <Input
                value={newNoteInput}
                onChange={(e) => setNewNoteInput(e.target.value)}
                placeholder="VD: Chờ test cung quanh MA20..."
                className="text-xs"
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--color-muted-2)]">Báo giá trên (k₫)</label>
                <Input
                  type="number"
                  step="any"
                  value={newAlertAbove}
                  onChange={(e) => setNewAlertAbove(e.target.value)}
                  placeholder="VD: 95.0"
                  className="font-ticker text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-muted-2)]">Báo giá dưới (k₫)</label>
                <Input
                  type="number"
                  step="any"
                  value={newAlertBelow}
                  onChange={(e) => setNewAlertBelow(e.target.value)}
                  placeholder="VD: 82.0"
                  className="font-ticker text-xs"
                />
              </div>
            </div>

            {addTickerError && <p className="text-xs text-[var(--color-down)]">{addTickerError}</p>}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setAddTickerOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleAddTicker}
              disabled={addingTicker || !newTickerInput.trim()}
              className="bg-[var(--color-up)] text-black hover:bg-[var(--color-up)]/90 text-xs font-semibold"
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
            <DialogTitle className="text-sm font-semibold text-white">Tạo danh sách theo dõi mới</DialogTitle>
          </DialogHeader>
          <div>
            <label className="mb-1.5 block text-xs text-[var(--color-muted-2)]">Tên danh sách</label>
            <Input
              value={newWlName}
              onChange={(e) => setNewWlName(e.target.value)}
              placeholder="VD: Cổ phiếu theo dõi Q4, Sóng BĐS..."
              maxLength={80}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateWatchlist()
              }}
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setCreateWlOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleCreateWatchlist}
              disabled={creatingWl || !newWlName.trim()}
              className="bg-[var(--color-up)] text-black hover:bg-[var(--color-up)]/90 text-xs font-semibold"
            >
              {creatingWl ? "Đang tạo..." : "Tạo danh sách"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Watchlist Confirm */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-white">Xóa danh sách?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-muted-2)]">
            Tất cả mã trong danh sách này sẽ bị xóa khỏi bộ theo dõi. Hành động này không thể hoàn tác.
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

// Single row component for watchlist items
const WatchlistItemRow = memo(function WatchlistItemRow({
  item,
  quote,
  onRemove,
}: {
  item: WatchlistItem
  quote?: MarketQuote
  onRemove: (ticker: string) => void
}) {
  const [removing, setRemoving] = useState(false)

  const handleRemove = useCallback(async () => {
    setRemoving(true)
    await onRemove(item.ticker)
    setRemoving(false)
  }, [item.ticker, onRemove])

  const price = quote?.price ?? null
  const changePercent = quote?.changePercent ?? null

  const isUp = changePercent !== null && changePercent > 0
  const isDown = changePercent !== null && changePercent < 0
  const isRef = changePercent !== null && changePercent === 0

  const priceColor = isUp
    ? "text-[var(--color-up)]"
    : isDown
    ? "text-[var(--color-down)]"
    : isRef
    ? "text-[var(--color-ref)]"
    : "text-[var(--color-muted-2)]"

  // Check alert trigger
  const hasTriggeredAbove = price !== null && item.alert_price_above !== null && price >= item.alert_price_above
  const hasTriggeredBelow = price !== null && item.alert_price_below !== null && price <= item.alert_price_below

  return (
    <div className="liquid-glass-row grid grid-cols-[1fr_100px_100px_80px_60px] items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0">
      {/* Ticker + note */}
      <div className="min-w-0">
        <Link
          href={`/insights/wyckoff?ticker=${item.ticker}`}
          prefetch={false}
          className="font-ticker text-sm font-bold uppercase text-white transition-colors hover:text-[var(--color-up)]"
        >
          {item.ticker}
        </Link>
        {item.note && <p className="truncate text-[11px] text-[var(--color-muted-2)]">{item.note}</p>}
      </div>

      {/* Price */}
      <div className={cn("text-right font-ticker text-xs font-semibold tabular-nums", priceColor)}>
        {price !== null ? price.toFixed(1) : "—"}
      </div>

      {/* % change */}
      <div className="text-right font-ticker text-xs tabular-nums">
        {changePercent !== null ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold",
              isUp
                ? "bg-[var(--color-up-dim)] text-[var(--color-up)]"
                : isDown
                ? "bg-[var(--color-down-dim)] text-[var(--color-down)]"
                : "bg-white/5 text-[var(--color-ref)]",
            )}
          >
            {isUp ? "▲ +" : isDown ? "▼ " : ""}
            {changePercent.toFixed(2)}%
          </span>
        ) : (
          <span className="text-[var(--color-muted-2)]">—</span>
        )}
      </div>

      {/* Alerts */}
      <div className="text-right">
        {hasTriggeredAbove || hasTriggeredBelow ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-down)]/20 px-1.5 py-0.5 font-ticker text-[10px] font-bold text-[var(--color-down)] animate-pulse">
            <Bell className="h-2.5 w-2.5" /> Hit!
          </span>
        ) : item.alert_price_above || item.alert_price_below ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 font-ticker text-[10px] font-medium text-amber-400">
            <Bell className="h-2.5 w-2.5" /> {item.alert_price_above ?? item.alert_price_below}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-border)]">–</span>
        )}
      </div>

      {/* Remove button */}
      <div className="text-right">
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="h-6 w-6 rounded text-[var(--color-muted-2)] transition-colors hover:text-[var(--color-down)]"
          title="Xóa khỏi danh sách"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
})
