"use client"

import Link from "next/link"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownAZ,
  ArrowUpDown,
  Check,
  ChevronDown,
  GripVertical,
  ListPlus,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/modules/shared/ui/cn"
import type { StockWatchlistItem } from "./types"

interface StockWatchlistSidebarProps {
  currentTicker: string
  items: StockWatchlistItem[]
  onSelectTicker?: (ticker: string) => void
  onVisibleTickersChange?: (tickers: string[]) => void
  isTransitioning?: boolean
}

interface WatchlistMeta {
  id: string
  name: string
  is_default: boolean
  sort_order: number
}

interface WatchlistApiItem {
  id: string
  watchlist_id: string
  ticker: string
  sort_order: number
}

type SortMode =
  | "custom"
  | "sector-asc"
  | "sector-desc"
  | "ticker-asc"
  | "ticker-desc"
  | "price-desc"
  | "price-asc"
  | "change-desc"
  | "change-asc"
  | "market-cap-desc"
  | "market-cap-asc"

const SYSTEM_WATCHLIST_ID = "__top200__"
const ACTIVE_LIST_KEY = "qeo:stock-watchlist:active:v1"
const SYSTEM_ORDER_KEY = "qeo:stock-watchlist:top200-order:v1"
const SORT_KEY_PREFIX = "qeo:stock-watchlist:sort:v1:"

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "custom", label: "Tùy chọn" },
  { value: "sector-asc", label: "Sắp xếp theo ngành A-Z" },
  { value: "sector-desc", label: "Sắp xếp theo ngành Z-A" },
  { value: "ticker-asc", label: "Sắp xếp theo mã A-Z" },
  { value: "ticker-desc", label: "Sắp xếp theo mã Z-A" },
  { value: "price-desc", label: "Sắp xếp theo giá tăng-giảm" },
  { value: "price-asc", label: "Sắp xếp theo giá giảm-tăng" },
  { value: "change-desc", label: "Sắp xếp theo % giá tăng-giảm" },
  { value: "change-asc", label: "Sắp xếp theo % giá giảm-tăng" },
  { value: "market-cap-desc", label: "Sắp xếp theo vốn hóa lớn-bé" },
  { value: "market-cap-asc", label: "Sắp xếp theo vốn hóa bé-lớn" },
]

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—"
  return value.toLocaleString("vi-VN", { minimumFractionDigits: value % 1 ? 1 : 0, maximumFractionDigits: 2 })
}

function formatChange(value: number) {
  if (!Number.isFinite(value)) return "0.00"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`
}

function mergeOrder(order: string[], tickers: string[]) {
  const current = new Set(tickers)
  const kept = order.filter((ticker) => current.has(ticker))
  const seen = new Set(kept)
  for (const ticker of tickers) {
    if (!seen.has(ticker)) {
      kept.push(ticker)
      seen.add(ticker)
    }
  }
  return kept
}

function moveTicker(order: string[], draggedTicker: string, targetTicker: string) {
  if (draggedTicker === targetTicker) return order
  const next = order.filter((ticker) => ticker !== draggedTicker)
  const targetIndex = next.indexOf(targetTicker)
  if (targetIndex < 0) return order
  next.splice(targetIndex, 0, draggedTicker)
  return next
}

export function StockWatchlistSidebar({
  currentTicker,
  items,
  onSelectTicker,
  onVisibleTickersChange,
  isTransitioning = false,
}: StockWatchlistSidebarProps) {
  const [query, setQuery] = useState("")
  const [activeListId, setActiveListId] = useState(SYSTEM_WATCHLIST_ID)
  const [watchlists, setWatchlists] = useState<WatchlistMeta[]>([])
  const [userItems, setUserItems] = useState<WatchlistApiItem[]>([])
  const [systemOrder, setSystemOrder] = useState<string[]>(() => items.map((item) => item.ticker))
  const [sortMode, setSortMode] = useState<SortMode>("custom")
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [draggedTicker, setDraggedTicker] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newWatchlistName, setNewWatchlistName] = useState("")
  const [creatingWatchlist, setCreatingWatchlist] = useState(false)
  const [createError, setCreateError] = useState("")

  const [addOpen, setAddOpen] = useState(false)
  const [addTicker, setAddTicker] = useState("")
  const [addTargetId, setAddTargetId] = useState("")
  const [addingTicker, setAddingTicker] = useState(false)
  const [addError, setAddError] = useState("")

  const sortMenuRef = useRef<HTMLDivElement>(null)
  const bootstrappedRef = useRef(false)

  const itemByTicker = useMemo(
    () => new Map(items.map((item) => [item.ticker.toUpperCase(), item] as const)),
    [items],
  )

  useEffect(() => {
    const canonicalTickers = items.map((item) => item.ticker.toUpperCase())
    setSystemOrder((current) => mergeOrder(current, canonicalTickers))
  }, [items])

  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true

    try {
      const storedOrder = JSON.parse(window.localStorage.getItem(SYSTEM_ORDER_KEY) || "[]") as unknown
      if (Array.isArray(storedOrder)) {
        setSystemOrder(mergeOrder(storedOrder.map(String).map((ticker) => ticker.toUpperCase()), items.map((item) => item.ticker.toUpperCase())))
      }
    } catch {
      // Invalid local order falls back to canonical order.
    }

    void fetch("/api/watchlist", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json() as Promise<{
          ok: boolean
          watchlists?: WatchlistMeta[]
        }>
      })
      .then((payload) => {
        if (!payload?.ok) return
        const nextWatchlists = payload.watchlists ?? []
        setWatchlists(nextWatchlists)

        const storedActive = window.localStorage.getItem(ACTIVE_LIST_KEY)
        if (storedActive === SYSTEM_WATCHLIST_ID || nextWatchlists.some((watchlist) => watchlist.id === storedActive)) {
          setActiveListId(storedActive)
        }
      })
      .catch(() => {})
  }, [items])

  const loadUserWatchlist = useCallback(async (watchlistId: string) => {
    setLoadingList(true)
    try {
      const response = await fetch(`/api/watchlist?wid=${encodeURIComponent(watchlistId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!response.ok) return
      const payload = await response.json() as {
        ok: boolean
        items?: WatchlistApiItem[]
        watchlists?: WatchlistMeta[]
      }
      if (!payload.ok) return
      setUserItems(payload.items ?? [])
      if (payload.watchlists) setWatchlists(payload.watchlists)
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (activeListId !== SYSTEM_WATCHLIST_ID) void loadUserWatchlist(activeListId)
  }, [activeListId, loadUserWatchlist])

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_LIST_KEY, activeListId)
      const storedSort = window.localStorage.getItem(`${SORT_KEY_PREFIX}${activeListId}`) as SortMode | null
      setSortMode(SORT_OPTIONS.some((option) => option.value === storedSort) ? storedSort! : "custom")
    } catch {
      setSortMode("custom")
    }
  }, [activeListId])

  useEffect(() => {
    if (!sortMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) setSortMenuOpen(false)
    }
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [sortMenuOpen])

  const manualItems = useMemo(() => {
    if (activeListId === SYSTEM_WATCHLIST_ID) {
      const order = mergeOrder(systemOrder, items.map((item) => item.ticker.toUpperCase()))
      return order.flatMap((ticker) => {
        const item = itemByTicker.get(ticker)
        return item ? [item] : []
      })
    }

    return userItems.map((watchlistItem) => {
      const item = itemByTicker.get(watchlistItem.ticker.toUpperCase())
      if (item) return item
      return {
        ticker: watchlistItem.ticker.toUpperCase(),
        companyName: watchlistItem.ticker.toUpperCase(),
        sector: "Khác",
        marketCapT: 0,
        price: 0,
        change: 0,
        changePct: 0,
        isBookmarked: true,
      } satisfies StockWatchlistItem
    })
  }, [activeListId, itemByTicker, items, systemOrder, userItems])

  const sortedItems = useMemo(() => {
    if (sortMode === "custom") return manualItems
    const next = [...manualItems]
    const textCompare = (left: string | undefined, right: string | undefined) =>
      (left || "").localeCompare(right || "", "vi", { sensitivity: "base" })

    next.sort((left, right) => {
      switch (sortMode) {
        case "sector-asc":
          return textCompare(left.sector, right.sector) || textCompare(left.ticker, right.ticker)
        case "sector-desc":
          return textCompare(right.sector, left.sector) || textCompare(left.ticker, right.ticker)
        case "ticker-asc":
          return textCompare(left.ticker, right.ticker)
        case "ticker-desc":
          return textCompare(right.ticker, left.ticker)
        case "price-desc":
          return right.price - left.price
        case "price-asc":
          return left.price - right.price
        case "change-desc":
          return right.changePct - left.changePct
        case "change-asc":
          return left.changePct - right.changePct
        case "market-cap-desc":
          return (right.marketCapT ?? 0) - (left.marketCapT ?? 0)
        case "market-cap-asc":
          return (left.marketCapT ?? 0) - (right.marketCapT ?? 0)
        default:
          return 0
      }
    })
    return next
  }, [manualItems, sortMode])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleUpperCase("vi")
    if (!normalizedQuery) return sortedItems
    return sortedItems.filter((item) =>
      item.ticker.toUpperCase().includes(normalizedQuery)
      || item.companyName.toLocaleUpperCase("vi").includes(normalizedQuery)
      || (item.sector || "").toLocaleUpperCase("vi").includes(normalizedQuery),
    )
  }, [query, sortedItems])

  useEffect(() => {
    onVisibleTickersChange?.(filteredItems.map((item) => item.ticker))
  }, [filteredItems, onVisibleTickersChange])

  const activeWatchlist = watchlists.find((watchlist) => watchlist.id === activeListId)
  const activeListName = activeListId === SYSTEM_WATCHLIST_ID
    ? "Top 200 · Thị trường"
    : activeWatchlist?.name ?? "Watchlist"
  const canDrag = sortMode === "custom" && !query.trim()

  function handleItemClick(event: React.MouseEvent<HTMLAnchorElement>, ticker: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    if (onSelectTicker) {
      event.preventDefault()
      onSelectTicker(ticker)
    }
  }

  function chooseSortMode(next: SortMode) {
    setSortMode(next)
    setSortMenuOpen(false)
    try {
      window.localStorage.setItem(`${SORT_KEY_PREFIX}${activeListId}`, next)
    } catch {
      // Sorting still works for this session.
    }
  }

  async function persistUserOrder(nextItems: WatchlistApiItem[]) {
    setUserItems(nextItems)
    const response = await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        watchlistId: activeListId,
        tickers: nextItems.map((item) => item.ticker),
      }),
    })
    if (!response.ok) void loadUserWatchlist(activeListId)
  }

  function handleDrop(targetTicker: string) {
    const dragged = draggedTicker
    setDraggedTicker(null)
    if (!dragged || !canDrag || dragged === targetTicker) return

    if (activeListId === SYSTEM_WATCHLIST_ID) {
      const current = mergeOrder(systemOrder, items.map((item) => item.ticker.toUpperCase()))
      const next = moveTicker(current, dragged, targetTicker)
      setSystemOrder(next)
      try {
        window.localStorage.setItem(SYSTEM_ORDER_KEY, JSON.stringify(next))
      } catch {
        // Keep session order if storage is unavailable.
      }
      return
    }

    const order = userItems.map((item) => item.ticker)
    const nextOrder = moveTicker(order, dragged, targetTicker)
    const byTicker = new Map(userItems.map((item) => [item.ticker, item] as const))
    const nextItems = nextOrder.flatMap((ticker, index) => {
      const item = byTicker.get(ticker)
      return item ? [{ ...item, sort_order: index }] : []
    })
    void persistUserOrder(nextItems)
  }

  function openAddTicker(ticker = currentTicker) {
    const preferredTarget = activeListId !== SYSTEM_WATCHLIST_ID
      ? activeListId
      : watchlists.find((watchlist) => watchlist.is_default)?.id ?? watchlists[0]?.id ?? ""
    setAddTargetId(preferredTarget)
    setAddTicker(ticker.toUpperCase())
    setAddError("")
    setAddOpen(true)
  }

  async function handleCreateWatchlist() {
    const name = newWatchlistName.trim()
    if (!name) return
    setCreatingWatchlist(true)
    setCreateError("")
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ createNew: true, name }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; watchlist?: WatchlistMeta; error?: string } | null
      if (!response.ok || !payload?.ok || !payload.watchlist) {
        setCreateError(payload?.error || "Không thể tạo watchlist.")
        return
      }
      setWatchlists((current) => [...current, payload.watchlist!])
      setNewWatchlistName("")
      setCreateOpen(false)
      setActiveListId(payload.watchlist.id)
      setUserItems([])
    } finally {
      setCreatingWatchlist(false)
    }
  }

  async function handleAddTicker() {
    const ticker = addTicker.trim().toUpperCase()
    if (!ticker || !addTargetId) {
      setAddError("Chọn watchlist và nhập mã cổ phiếu.")
      return
    }

    setAddingTicker(true)
    setAddError("")
    try {
      const targetCount = addTargetId === activeListId ? userItems.length : 0
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          watchlistId: addTargetId,
          ticker,
          sortOrder: targetCount,
        }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; item?: WatchlistApiItem; error?: string } | null
      if (!response.ok || !payload?.ok || !payload.item) {
        setAddError(payload?.error || "Không thể thêm mã vào watchlist.")
        return
      }

      if (addTargetId === activeListId) {
        setUserItems((current) => {
          const withoutTicker = current.filter((item) => item.ticker !== payload.item!.ticker)
          return [...withoutTicker, payload.item!]
        })
      }
      setAddOpen(false)
    } finally {
      setAddingTicker(false)
    }
  }

  return (
    <aside className="h-full w-full">
      <div
        data-stock-detail-watchlist
        className="flex h-full min-h-[500px] flex-col overflow-hidden rounded-lg border border-white/[0.09] bg-[#171b22] font-ticker lg:min-h-0"
      >
        <div className="shrink-0 border-b border-black/30 bg-[#2a2f37] p-2">
          <div className="flex gap-1.5">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Chọn watchlist</span>
              <select
                data-watchlist-selector
                value={activeListId}
                onChange={(event) => setActiveListId(event.target.value)}
                className="h-9 w-full appearance-none rounded-sm border border-white/[0.08] bg-[#353a43] pl-3 pr-8 text-sm font-semibold text-slate-100 outline-none transition-colors hover:bg-[#3a4049] focus:border-sky-400/60"
              >
                <option value={SYSTEM_WATCHLIST_ID}>Top 200 · Thị trường</option>
                {watchlists.map((watchlist) => (
                  <option key={watchlist.id} value={watchlist.id}>
                    {watchlist.name}{watchlist.is_default ? " · mặc định" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
            </label>

            <button
              type="button"
              onClick={() => {
                setCreateError("")
                setCreateOpen(true)
              }}
              className="grid size-9 shrink-0 place-items-center rounded-sm border border-white/[0.08] bg-[#353a43] text-slate-200 transition-colors hover:bg-[#414750] hover:text-white"
              title="Tạo watchlist mới"
              aria-label="Tạo watchlist mới"
            >
              <ListPlus className="size-4" />
            </button>

            <div ref={sortMenuRef} className="relative">
              <button
                data-watchlist-sort-trigger
                type="button"
                onClick={() => setSortMenuOpen((open) => !open)}
                className={cn(
                  "grid size-9 place-items-center rounded-sm border border-white/[0.08] bg-[#353a43] text-slate-200 transition-colors hover:bg-[#414750] hover:text-white",
                  sortMenuOpen && "border-sky-400/40 bg-[#414750]",
                )}
                title="Sắp xếp"
                aria-label="Sắp xếp watchlist"
                aria-expanded={sortMenuOpen}
              >
                <ArrowDownAZ className="size-4" />
              </button>

              {sortMenuOpen ? (
                <div
                  data-watchlist-sort-menu
                  className="absolute right-0 top-10 z-50 w-64 overflow-hidden border border-white/[0.08] bg-[#363941] py-1.5 shadow-2xl"
                >
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => chooseSortMode(option.value)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-slate-200 transition-colors hover:bg-white/[0.07]"
                    >
                      <span className="grid size-4 place-items-center">
                        {sortMode === option.value ? <Check className="size-3.5 text-sky-300" /> : null}
                      </span>
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm mã / công ty / ngành..."
                className="h-8 w-full rounded-sm border border-white/[0.07] bg-[#20242b] pl-8 pr-7 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-sky-400/50 focus:outline-none"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
                  aria-label="Xóa tìm kiếm"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => openAddTicker()}
              disabled={!watchlists.length}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-sky-400/20 bg-sky-400/10 px-2 text-[10px] font-bold text-sky-200 transition-colors hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
              title="Thêm mã vào watchlist"
            >
              <Plus className="size-3.5" />
              Mã
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between px-0.5 text-[10px]">
            <div className="min-w-0 truncate font-semibold text-slate-300">{activeListName}</div>
            <div className="ml-2 shrink-0 font-mono text-slate-500">
              {filteredItems.length}{query ? `/${manualItems.length}` : ""} mã
            </div>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-[20px_minmax(0,1fr)_96px] items-center gap-1 border-b border-black/30 bg-[#23272e] px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
          <span />
          <span>Mã / Công ty</span>
          <span className="text-right">Giá / Thay đổi</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="space-y-px p-px">
              {Array.from({ length: 10 }, (_, index) => (
                <div key={index} className="h-[58px] animate-pulse bg-white/[0.035]" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Không có mã phù hợp trong watchlist này.
            </div>
          ) : (
            filteredItems.map((item) => {
              const isActive = item.ticker === currentTicker.toUpperCase()
              const isUp = item.changePct > 0
              const isDown = item.changePct < 0
              const tone = isUp ? "text-emerald-400" : isDown ? "text-rose-400" : "text-amber-300"

              return (
                <div
                  key={item.ticker}
                  draggable={canDrag}
                  onDragStart={(event) => {
                    if (!canDrag) return
                    setDraggedTicker(item.ticker)
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", item.ticker)
                  }}
                  onDragEnd={() => setDraggedTicker(null)}
                  onDragOver={(event) => {
                    if (!canDrag) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = "move"
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    handleDrop(item.ticker)
                  }}
                  className={cn(
                    "group grid min-h-[58px] grid-cols-[20px_minmax(0,1fr)_96px] items-center gap-1 border-b border-black/25 px-2 py-1.5 transition-colors",
                    isActive ? "bg-sky-500/[0.09]" : "bg-[#2e333b] odd:bg-[#2a2f37] hover:bg-[#373c45]",
                    draggedTicker === item.ticker && "opacity-45",
                  )}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={cn(
                      "grid size-5 place-items-center text-slate-500",
                      canDrag ? "cursor-grab active:cursor-grabbing group-hover:text-slate-300" : "cursor-default opacity-35",
                    )}
                    title={canDrag ? "Kéo để sắp xếp" : "Chọn sắp xếp Tùy chọn để kéo thả"}
                    aria-label={canDrag ? `Kéo ${item.ticker} để sắp xếp` : undefined}
                  >
                    <GripVertical className="size-4" />
                  </button>

                  <Link
                    href={`/insights/${item.ticker.toLowerCase()}`}
                    prefetch={false}
                    onClick={(event) => handleItemClick(event, item.ticker)}
                    className="min-w-0 py-0.5 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <strong className={cn("text-sm font-black tracking-wide", isActive ? "text-sky-200" : "text-[#79b8ff]")}>
                        {item.ticker}
                      </strong>
                      {isActive && isTransitioning ? <span className="size-1.5 animate-ping rounded-full bg-sky-300" /> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] font-medium text-slate-300/85" title={item.companyName}>
                      {item.companyName}
                    </div>
                  </Link>

                  <Link
                    href={`/insights/${item.ticker.toLowerCase()}`}
                    prefetch={false}
                    onClick={(event) => handleItemClick(event, item.ticker)}
                    className="min-w-0 py-0.5 text-right"
                  >
                    <div className="font-mono text-[12px] font-black tabular-nums text-slate-100">
                      {formatPrice(item.price)}
                    </div>
                    <div className={cn("mt-0.5 whitespace-nowrap font-mono text-[10px] font-black tabular-nums", tone)}>
                      {formatChange(item.change)} / {formatChange(item.changePct)}%
                    </div>
                  </Link>
                </div>
              )
            })
          )}
        </div>

        <div className="shrink-0 border-t border-black/40 bg-[#262a31] p-2">
          <div className="flex items-center gap-1.5">
            <Link
              href="/portfolio"
              prefetch={false}
              className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm border border-white/[0.08] bg-[#30353d] px-2 text-[10px] font-bold text-slate-300 transition-colors hover:bg-[#393f48] hover:text-white"
            >
              <Settings2 className="size-3.5" />
              Quản lý Watchlist
            </Link>
            <button
              type="button"
              onClick={() => openAddTicker(currentTicker)}
              disabled={!watchlists.length}
              className="grid size-8 place-items-center rounded-sm border border-white/[0.08] bg-[#30353d] text-slate-300 transition-colors hover:bg-[#393f48] hover:text-white disabled:opacity-40"
              title={`Thêm ${currentTicker} vào watchlist`}
              aria-label={`Thêm ${currentTicker} vào watchlist`}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm border-white/[0.1] bg-[#20242b] text-slate-100">
          <DialogHeader>
            <DialogTitle>Tạo Watchlist mới</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={newWatchlistName}
              onChange={(event) => setNewWatchlistName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && newWatchlistName.trim()) void handleCreateWatchlist()
              }}
              placeholder="VD: Ngân hàng, Theo dõi breakout..."
              maxLength={80}
              className="border-white/[0.1] bg-[#171b22]"
            />
            {createError ? <p className="text-xs font-semibold text-rose-400">{createError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Hủy</Button>
            <Button
              onClick={() => void handleCreateWatchlist()}
              disabled={creatingWatchlist || !newWatchlistName.trim()}
            >
              {creatingWatchlist ? "Đang tạo..." : "Tạo Watchlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm border-white/[0.1] bg-[#20242b] text-slate-100">
          <DialogHeader>
            <DialogTitle>Thêm mã vào Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-400">Watchlist</span>
              <select
                value={addTargetId}
                onChange={(event) => setAddTargetId(event.target.value)}
                className="h-10 w-full rounded-md border border-white/[0.1] bg-[#171b22] px-3 text-sm outline-none focus:border-sky-400/50"
              >
                <option value="">Chọn watchlist</option>
                {watchlists.map((watchlist) => (
                  <option key={watchlist.id} value={watchlist.id}>{watchlist.name}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-400">Mã cổ phiếu</span>
              <Input
                autoFocus
                value={addTicker}
                onChange={(event) => setAddTicker(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && addTicker.trim() && addTargetId) void handleAddTicker()
                }}
                placeholder="VD: MSN"
                maxLength={12}
                className="border-white/[0.1] bg-[#171b22] font-mono font-bold uppercase"
              />
            </label>
            {addError ? <p className="text-xs font-semibold text-rose-400">{addError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Hủy</Button>
            <Button
              onClick={() => void handleAddTicker()}
              disabled={addingTicker || !addTicker.trim() || !addTargetId}
            >
              {addingTicker ? "Đang thêm..." : "Thêm mã"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
