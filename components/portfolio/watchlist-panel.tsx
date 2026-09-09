"use client"

import Link from "next/link"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Bell, Eye, Minus, Plus, Star, Trash2, TrendingDown, TrendingUp } from "lucide-react"

import { ScoutingCard, type ScoutingQuote } from "@/components/portfolio/revamp/scouting-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
  const [quotes, setQuotes] = useState<Record<string, ScoutingQuote>>({})

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

  const handleSelectWatchlist = useCallback((id: string) => {
    setActiveId(id)
    void loadItems(id)
  }, [loadItems])

  // One quote batch, keyed by the complete active watchlist ticker set.
  const tickersKey = useMemo(() => items.map((i) => i.ticker).join(","), [items])

  useEffect(() => {
    if (!tickersKey) return
    fetch(`/api/market/intraday?tickers=${tickersKey}`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { histories?: Record<string, { price: number; reference: number; change: number; changePercent: number }> } | null) => {
        if (!data?.histories) return
        const map: Record<string, ScoutingQuote> = {}
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

  const { upCount, refCount, downCount } = useMemo(() => {
    let up = 0
    let ref = 0
    let down = 0
    for (const item of items) {
      const quote = quotes[item.ticker]
      if (!quote || quote.change == null || quote.change === 0) ref++
      else if (quote.change > 0) up++
      else down++
    }
    return { upCount: up, refCount: ref, downCount: down }
  }, [items, quotes])

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
      if (data.item) setItems((prev) => [...prev, data.item!])
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
    if (data.ok) setItems((prev) => prev.filter((item) => item.id !== itemId))
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
    if (!data.ok) return

    const next = watchlists.filter((watchlist) => watchlist.id !== id)
    setWatchlists(next)
    setDeleteConfirm(null)
    if (activeId === id) {
      const fallbackId = next[0]?.id ?? ""
      setActiveId(fallbackId)
      if (fallbackId) void loadItems(fallbackId)
      else setItems([])
    }
  }

  const activeWatchlist = watchlists.find((watchlist) => watchlist.id === activeId)

  return (
    <div className="space-y-5 font-ticker">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3">
        {watchlists.map((watchlist) => (
          <button
            key={watchlist.id}
            type="button"
            onClick={() => handleSelectWatchlist(watchlist.id)}
            className={cn(
              "min-h-10 cursor-pointer rounded-full border px-4 py-1.5 text-xs font-bold transition-colors",
              watchlist.id === activeId
                ? "border-purple-500/50 bg-purple-500/20 text-purple-300 shadow-sm"
                : "border-[var(--color-border)] text-[var(--color-muted-2)] hover:border-white/20 hover:text-white",
            )}
          >
            <span className="flex items-center gap-1.5">
              {watchlist.is_default && <Star className="h-3.5 w-3.5 text-amber-400" />}
              {watchlist.name}
            </span>
          </button>
        ))}

        {watchlists.length < 5 && (
          <button
            type="button"
            onClick={() => setCreateWlOpen(true)}
            className="min-h-10 cursor-pointer rounded-full border border-dashed border-white/20 px-3.5 py-1.5 text-xs font-bold text-[var(--color-muted-2)] transition-colors hover:border-white/40 hover:text-white"
          >
            <span className="flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Tạo mới</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Eye className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-extrabold uppercase tracking-wide text-white sm:text-base">
              Scouting Board · Trinh sát · {activeWatchlist?.name ?? "Danh sách theo dõi"}
            </span>
            <span className="text-xs font-semibold text-[var(--color-muted-2)]">({items.length} mã)</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Thẻ hiển thị dữ kiện theo dõi, quote phiên, cảnh báo và tags hiện có; không gán nhãn đánh giá hay tín hiệu giao dịch.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-black/40 px-2.5 py-1 text-xs font-bold">
              <span className="flex items-center gap-0.5 text-[var(--color-up)]"><TrendingUp className="h-3 w-3" /> {upCount}</span>
              <span className="text-[var(--color-border)]">|</span>
              <span className="flex items-center gap-0.5 text-[var(--color-ref)]"><Minus className="h-3 w-3" /> {refCount}</span>
              <span className="text-[var(--color-border)]">|</span>
              <span className="flex items-center gap-0.5 text-[var(--color-down)]"><TrendingDown className="h-3 w-3" /> {downCount}</span>
            </div>
          )}
          {watchlists.length > 1 && (
            <button
              type="button"
              onClick={() => setDeleteConfirm(activeId)}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[var(--color-muted-2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-down)]"
              title="Xóa danh sách này"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <Button
            size="sm"
            onClick={() => setAddTickerOpen(true)}
            className="min-h-10 cursor-pointer gap-1.5 rounded-full border-[var(--color-up)]/30 bg-[var(--color-up)]/10 px-3.5 text-xs font-bold text-[var(--color-up)] transition-colors hover:bg-[var(--color-up)]/20"
            variant="outline"
          >
            <Plus className="h-3.5 w-3.5" /> Thêm mã
          </Button>
        </div>
      </div>

      {loadingItems ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-52 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.02]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-white/[0.06] bg-white/[0.02] py-12 text-center">
          <Eye className="h-8 w-8 text-[var(--color-muted)]" />
          <p className="text-sm font-semibold text-slate-300">Chưa có mã nào trong danh sách</p>
          <Button size="sm" variant="outline" onClick={() => setAddTickerOpen(true)} className="mt-1 min-h-10 gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Thêm mã cổ phiếu
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <ScoutingCard
              key={item.id}
              item={item}
              quote={quotes[item.ticker]}
              onRemove={handleRemoveTicker}
            />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <details className="rounded-3xl border border-[#252837] bg-[#11131c]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-extrabold text-slate-200">
            Chi tiết Scouting Board
          </summary>
          <div className="overflow-x-auto border-t border-[var(--color-border)]">
            <div className="min-w-[620px]">
              <div className="grid grid-cols-[1fr_110px_110px_90px_60px] gap-2 border-b border-[var(--color-border)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
                <span>Mã / Ghi chú</span>
                <span className="text-right">Giá TT (k₫)</span>
                <span className="text-right">% Ngày</span>
                <span className="text-right">Cảnh báo</span>
                <span className="text-right">Thao tác</span>
              </div>

              {items.map((item) => {
                const quote = quotes[item.ticker]
                const price = quote?.price
                const changePct = quote?.changePercent
                const isUp = changePct != null && changePct > 0
                const isDown = changePct != null && changePct < 0

                return (
                  <div key={item.id} className="grid grid-cols-[1fr_110px_110px_90px_60px] items-center gap-2 border-b border-white/5 px-4 py-2.5 last:border-0 hover:bg-white/[0.04]">
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/insights/wyckoff?ticker=${item.ticker}`}
                        prefetch={false}
                        className="text-sm font-black uppercase tracking-wider text-purple-300 transition-colors hover:text-purple-200"
                      >
                        {item.ticker}
                      </Link>
                      {item.note && <span className="mt-0.5 truncate text-xs italic text-[var(--color-muted-2)]">“{item.note}”</span>}
                    </div>
                    <div className="text-right text-xs font-bold tabular-nums sm:text-sm">
                      {price != null ? (
                        <span className={isUp ? "text-[var(--color-up)]" : isDown ? "text-[var(--color-down)]" : "text-[var(--color-ref)]"}>{price.toFixed(1)}</span>
                      ) : <span className="text-[var(--color-muted-2)]">–</span>}
                    </div>
                    <div className="text-right text-xs font-bold tabular-nums sm:text-sm">
                      {changePct != null ? (
                        <span className={isUp ? "text-[var(--color-up)]" : isDown ? "text-[var(--color-down)]" : "text-[var(--color-ref)]"}>
                          {isUp ? "▲ +" : isDown ? "▼ " : "– "}{Math.abs(changePct).toFixed(2)}%
                        </span>
                      ) : <span className="text-[var(--color-muted-2)]">–</span>}
                    </div>
                    <div className="text-right text-[11px] text-[var(--color-muted-2)]">
                      {item.alert_price_above != null || item.alert_price_below != null ? (
                        <div className="flex items-center justify-end gap-1 text-purple-300">
                          <Bell className="h-3 w-3" />
                          <span>{item.alert_price_above != null ? `>${item.alert_price_above}` : ""}{item.alert_price_below != null ? ` <${item.alert_price_below}` : ""}</span>
                        </div>
                      ) : "–"}
                    </div>
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => void handleRemoveTicker(item.id)}
                        className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[var(--color-muted-2)] transition-colors hover:bg-[var(--color-down)]/10 hover:text-[var(--color-down)]"
                        title="Xóa mã khỏi watchlist"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </details>
      )}

      <Dialog open={addTickerOpen} onOpenChange={setAddTickerOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="font-ticker text-sm font-bold text-white">Thêm mã vào Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1 font-ticker">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-muted-2)]">Mã cổ phiếu <span className="text-[var(--color-down)]">*</span></label>
              <Input
                value={newTickerInput}
                onChange={(event) => setNewTickerInput(event.target.value.toUpperCase())}
                placeholder="VD: HPG, SSI, VCB"
                maxLength={10}
                className="font-ticker text-xs font-bold uppercase"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-muted-2)]">Ghi chú theo dõi</label>
              <Input
                value={newNoteInput}
                onChange={(event) => setNewNoteInput(event.target.value)}
                placeholder="VD: Chờ Spring Pha C test MA20"
                maxLength={100}
                className="font-ticker text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">Báo giá khi &gt; (k₫)</label>
                <Input type="number" step="0.1" value={newAlertAbove} onChange={(event) => setNewAlertAbove(event.target.value)} placeholder="30.5" className="font-ticker text-xs" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">Báo giá khi &lt; (k₫)</label>
                <Input type="number" step="0.1" value={newAlertBelow} onChange={(event) => setNewAlertBelow(event.target.value)} placeholder="24.0" className="font-ticker text-xs" />
              </div>
            </div>
            {addTickerError && <p className="text-xs font-bold text-[var(--color-down)]">{addTickerError}</p>}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setAddTickerOpen(false)}>Hủy</Button>
            <Button
              size="sm"
              onClick={() => void handleAddTicker()}
              disabled={addingTicker || !newTickerInput.trim()}
              className="bg-purple-600 text-xs font-bold text-white hover:bg-purple-500"
            >
              {addingTicker ? "Đang thêm..." : "Thêm vào danh sách"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createWlOpen} onOpenChange={setCreateWlOpen}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="font-ticker text-sm font-bold text-white">Tạo danh sách theo dõi mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1 font-ticker">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--color-muted-2)]">Tên danh sách <span className="text-[var(--color-down)]">*</span></label>
              <Input value={newWlName} onChange={(event) => setNewWlName(event.target.value)} placeholder="VD: Cổ phiếu Vượt đỉnh, Sóng BĐS..." maxLength={60} autoFocus />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setCreateWlOpen(false)}>Hủy</Button>
            <Button
              size="sm"
              onClick={() => void handleCreateWatchlist()}
              disabled={creatingWl || !newWlName.trim()}
              className="bg-purple-600 text-xs font-bold text-white hover:bg-purple-500"
            >
              {creatingWl ? "Đang tạo..." : "Tạo danh sách"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm border-[var(--color-border)] bg-[#0b0f13] text-foreground">
          <DialogHeader>
            <DialogTitle className="font-ticker text-sm font-bold text-white">Xóa danh sách theo dõi?</DialogTitle>
          </DialogHeader>
          <p className="font-ticker text-xs text-[var(--color-muted-2)] sm:text-sm">
            Tất cả mã theo dõi trong danh sách <span className="font-bold text-white">{watchlists.find((watchlist) => watchlist.id === deleteConfirm)?.name}</span> sẽ bị xóa.
          </p>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>Hủy</Button>
            <Button size="sm" variant="destructive" onClick={() => deleteConfirm && void handleDeleteWatchlist(deleteConfirm)}>Xóa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
