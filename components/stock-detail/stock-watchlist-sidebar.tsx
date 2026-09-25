"use client"

import Link from "next/link"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  GripVertical,
  Info,
  List,
  Pencil,
  Plus,
  Search,
  Settings2,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { StockLogo } from "@/components/stock-logo"
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
  emoji: string | null
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

const WATCHLIST_EMOJIS = [
  "⭐", "👀", "📈", "📉", "💰", "🏦", "🔥", "🚀",
  "💎", "⚡", "🎯", "🛡️", "🏭", "🛒", "🏠", "🌱",
  "💻", "🚗", "🧠", "🔍", "🍜", "🧪", "❤️", "🧱",
]

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

function WatchlistEmojiPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string | null
  onChange: (emoji: string | null) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-watchlist-emoji-trigger
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "grid place-items-center rounded-md border border-white/[0.12] bg-[#292f37] text-slate-200 transition-colors hover:border-sky-300/35 hover:bg-[#343b45]",
          compact ? "size-10 text-lg" : "size-12 text-xl",
          open && "border-sky-300/40 bg-[#343b45]",
        )}
        title={value ? `Icon: ${value}` : "Chọn Emoji"}
        aria-label={value ? `Đổi icon ${value}` : "Chọn icon Emoji"}
        aria-expanded={open}
      >
        {value ? <span aria-hidden="true">{value}</span> : <SmilePlus className={compact ? "size-4" : "size-5"} />}
      </button>

      {open ? (
        <div
          data-watchlist-emoji-picker
          className={cn(
            "absolute z-[100] grid w-[244px] grid-cols-8 gap-1 rounded-lg border border-white/[0.12] bg-[#171c23] p-2 shadow-[0_20px_55px_-18px_rgba(0,0,0,0.95)]",
            compact ? "left-0 top-11" : "left-0 top-14",
          )}
        >
          {WATCHLIST_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange(emoji)
                setOpen(false)
              }}
              className={cn(
                "grid size-7 place-items-center rounded text-base transition-colors hover:bg-white/[0.09]",
                value === emoji && "bg-sky-400/15 ring-1 ring-sky-300/40",
              )}
              aria-label={`Chọn icon ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className="col-span-8 mt-1 rounded border-t border-white/[0.08] px-2 pt-2 text-center text-[10px] font-semibold text-slate-400 transition-colors hover:text-slate-100"
          >
            Không dùng icon
          </button>
        </div>
      ) : null}
    </div>
  )
}

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
  const [selectorMenuOpen, setSelectorMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [manageError, setManageError] = useState("")
  const [draggedWatchlistId, setDraggedWatchlistId] = useState<string | null>(null)
  const [editingWatchlistId, setEditingWatchlistId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameEmoji, setRenameEmoji] = useState<string | null>(null)
  const [managingWatchlistId, setManagingWatchlistId] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [draggedTicker, setDraggedTicker] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newWatchlistName, setNewWatchlistName] = useState("")
  const [newWatchlistEmoji, setNewWatchlistEmoji] = useState<string | null>(null)
  const [creatingWatchlist, setCreatingWatchlist] = useState(false)
  const [createError, setCreateError] = useState("")

  const [addOpen, setAddOpen] = useState(false)
  const [addTicker, setAddTicker] = useState("")
  const [addTargetId, setAddTargetId] = useState("")
  const [addingTicker, setAddingTicker] = useState(false)
  const [addError, setAddError] = useState("")
  const [addActiveIndex, setAddActiveIndex] = useState(0)
  const [addSuggestionsOpen, setAddSuggestionsOpen] = useState(false)

  const addListboxId = React.useId()
  const selectorMenuRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const bootstrappedRef = useRef(false)

  const itemByTicker = useMemo(
    () => new Map(items.map((item) => [item.ticker.toUpperCase(), item] as const)),
    [items],
  )

  const addSuggestions = useMemo(() => {
    const needle = addTicker.trim().toLocaleLowerCase("vi")
    return items
      .filter((item) => {
        if (!needle) return true
        return item.ticker.toLocaleLowerCase("vi").includes(needle)
          || item.companyName.toLocaleLowerCase("vi").includes(needle)
          || (item.sector || "").toLocaleLowerCase("vi").includes(needle)
      })
      .slice(0, 12)
  }, [addTicker, items])

  const selectedAddStock = useMemo(
    () => itemByTicker.get(addTicker.trim().toUpperCase()) ?? null,
    [addTicker, itemByTicker],
  )
  const activeAddStock = addSuggestions[Math.min(addActiveIndex, Math.max(addSuggestions.length - 1, 0))] ?? null

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
        if (storedActive && (storedActive === SYSTEM_WATCHLIST_ID || nextWatchlists.some((watchlist) => watchlist.id === storedActive))) {
          setActiveListId(storedActive)
        }
      })
      .catch(() => {})
  }, [items])

  const reloadWatchlists = useCallback(async () => {
    const response = await fetch("/api/watchlist", {
      cache: "no-store",
      credentials: "same-origin",
    })
    if (!response.ok) return false
    const payload = await response.json() as {
      ok: boolean
      watchlists?: WatchlistMeta[]
    }
    if (!payload.ok) return false
    setWatchlists(payload.watchlists ?? [])
    return true
  }, [])

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
    if (!selectorMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!selectorMenuRef.current?.contains(event.target as Node)) setSelectorMenuOpen(false)
    }
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [selectorMenuOpen])

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
  const activeListEmoji = activeListId === SYSTEM_WATCHLIST_ID
    ? "📊"
    : activeWatchlist?.emoji ?? null
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

  function openCreateWatchlist() {
    setSelectorMenuOpen(false)
    setManageOpen(false)
    setCreateError("")
    setNewWatchlistName("")
    setNewWatchlistEmoji(null)
    setCreateOpen(true)
  }

  function openManageWatchlists() {
    setSelectorMenuOpen(false)
    setManageError("")
    setEditingWatchlistId(null)
    setRenameValue("")
    setRenameEmoji(null)
    setManageOpen(true)
  }

  async function persistWatchlistOrder(nextWatchlists: WatchlistMeta[]) {
    setWatchlists(nextWatchlists)
    setManageError("")
    const response = await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        action: "reorder-watchlists",
        watchlistIds: nextWatchlists.map((watchlist) => watchlist.id),
      }),
    })

    if (!response.ok) {
      setManageError("Không thể lưu thứ tự watchlist. Đã tải lại dữ liệu.")
      await reloadWatchlists()
    }
  }

  function handleWatchlistDrop(targetWatchlistId: string) {
    const dragged = draggedWatchlistId
    setDraggedWatchlistId(null)
    if (!dragged || dragged === targetWatchlistId) return

    const currentOrder = watchlists.map((watchlist) => watchlist.id)
    const nextOrder = moveTicker(currentOrder, dragged, targetWatchlistId)
    const byId = new Map(watchlists.map((watchlist) => [watchlist.id, watchlist] as const))
    const nextWatchlists = nextOrder.flatMap((id, index) => {
      const watchlist = byId.get(id)
      return watchlist ? [{ ...watchlist, sort_order: index }] : []
    })
    void persistWatchlistOrder(nextWatchlists)
  }

  function beginRenameWatchlist(watchlist: WatchlistMeta) {
    setEditingWatchlistId(watchlist.id)
    setRenameValue(watchlist.name)
    setRenameEmoji(watchlist.emoji)
    setManageError("")
  }

  async function handleRenameWatchlist(watchlistId: string) {
    const name = renameValue.trim()
    if (!name) {
      setManageError("Tên watchlist không được để trống.")
      return
    }

    setManagingWatchlistId(watchlistId)
    setManageError("")
    try {
      const response = await fetch("/api/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "rename-watchlist",
          watchlistId,
          name,
          emoji: renameEmoji,
        }),
      })
      const payload = await response.json().catch(() => null) as {
        ok?: boolean
        watchlist?: WatchlistMeta
        error?: string
      } | null

      if (!response.ok || !payload?.ok || !payload.watchlist) {
        setManageError(payload?.error || "Không thể đổi tên watchlist.")
        return
      }

      setWatchlists((current) => current.map((watchlist) => (
        watchlist.id === watchlistId ? payload.watchlist! : watchlist
      )))
      setEditingWatchlistId(null)
      setRenameValue("")
      setRenameEmoji(null)
    } finally {
      setManagingWatchlistId(null)
    }
  }

  async function handleDeleteWatchlist(watchlist: WatchlistMeta) {
    if (!window.confirm(`Xóa watchlist “${watchlist.name}”? Các mã trong danh sách này cũng sẽ bị xóa khỏi watchlist.`)) return

    setManagingWatchlistId(watchlist.id)
    setManageError("")
    try {
      const response = await fetch(`/api/watchlist?watchlistId=${encodeURIComponent(watchlist.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!response.ok || !payload?.ok) {
        setManageError(payload?.error || "Không thể xóa watchlist.")
        return
      }

      const remaining = watchlists.filter((item) => item.id !== watchlist.id)
      const nextWatchlists = remaining.map((item, index) => ({
        ...item,
        is_default: watchlist.is_default ? index === 0 : item.is_default,
        sort_order: index,
      }))
      setWatchlists(nextWatchlists)

      if (activeListId === watchlist.id) {
        setActiveListId(SYSTEM_WATCHLIST_ID)
        setUserItems([])
      }
      if (addTargetId === watchlist.id) {
        setAddTargetId(nextWatchlists.find((item) => item.is_default)?.id ?? nextWatchlists[0]?.id ?? "")
      }
      if (editingWatchlistId === watchlist.id) {
        setEditingWatchlistId(null)
        setRenameValue("")
        setRenameEmoji(null)
      }

      await reloadWatchlists()
    } finally {
      setManagingWatchlistId(null)
    }
  }

  function openAddTicker(ticker = currentTicker) {
    const preferredTarget = activeListId !== SYSTEM_WATCHLIST_ID
      ? activeListId
      : watchlists.find((watchlist) => watchlist.is_default)?.id ?? watchlists[0]?.id ?? ""
    setAddTargetId(preferredTarget)
    setAddTicker(ticker.toUpperCase())
    setAddActiveIndex(0)
    setAddSuggestionsOpen(false)
    setAddError("")
    setAddOpen(true)
  }

  function moveAddActive(delta: number) {
    if (!addSuggestions.length) return
    setAddSuggestionsOpen(true)
    setAddActiveIndex((current) => {
      const next = current + delta
      if (next < 0) return addSuggestions.length - 1
      if (next >= addSuggestions.length) return 0
      return next
    })
  }

  function selectAddStock(ticker: string) {
    setAddTicker(ticker.toUpperCase())
    setAddSuggestionsOpen(false)
    setAddError("")
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
        body: JSON.stringify({ createNew: true, name, emoji: newWatchlistEmoji }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; watchlist?: WatchlistMeta; error?: string } | null
      if (!response.ok || !payload?.ok || !payload.watchlist) {
        setCreateError(payload?.error || "Không thể tạo watchlist.")
        return
      }
      setWatchlists((current) => [...current, payload.watchlist!].sort((left, right) => left.sort_order - right.sort_order))
      setNewWatchlistName("")
      setNewWatchlistEmoji(null)
      setCreateOpen(false)
      setActiveListId(payload.watchlist.id)
      setUserItems([])
    } finally {
      setCreatingWatchlist(false)
    }
  }

  async function handleAddTicker(tickerOverride?: string) {
    const requestedTicker = (tickerOverride ?? addTicker).trim().toUpperCase()
    const stock = itemByTicker.get(requestedTicker)
    if (!stock || !addTargetId) {
      setAddError(stock ? "Chọn watchlist để thêm mã." : "Chọn mã cổ phiếu từ danh sách gợi ý.")
      setAddSuggestionsOpen(!stock)
      return
    }
    const ticker = stock.ticker

    setAddingTicker(true)
    setAddError("")
    try {
      const targetCount = addTargetId === activeListId ? userItems.length : 10_000
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
      setAddSuggestionsOpen(false)
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
            <div ref={selectorMenuRef} className="relative min-w-0 flex-1">
              <button
                data-watchlist-selector
                type="button"
                onClick={() => {
                  setSelectorMenuOpen((open) => !open)
                  setSortMenuOpen(false)
                }}
                className={cn(
                  "flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-white/[0.08] bg-[#353a43] px-3 text-left text-sm font-semibold text-slate-100 outline-none transition-colors hover:bg-[#3a4049] focus-visible:border-sky-400/60",
                  selectorMenuOpen && "border-sky-400/35 bg-[#3a4049]",
                )}
                aria-haspopup="menu"
                aria-expanded={selectorMenuOpen}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded border border-white/[0.08] bg-white/[0.04] text-sm">
                    {activeListEmoji ?? <List className="size-3.5 text-slate-400" />}
                  </span>
                  <span className="truncate">{activeListName}</span>
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-slate-300 transition-transform", selectorMenuOpen && "rotate-180")} />
              </button>

              {selectorMenuOpen ? (
                <div
                  data-watchlist-selector-menu
                  role="menu"
                  className="absolute left-0 top-10 z-[70] w-[min(330px,calc(100vw-32px))] overflow-hidden rounded-md border border-white/[0.12] bg-[#343840] shadow-[0_22px_55px_-16px_rgba(0,0,0,0.95)]"
                >
                  <div className="px-3 pb-1 pt-3 text-[11px] font-black uppercase tracking-[0.08em] text-slate-400">
                    Danh sách watchlist
                  </div>

                  <div className="max-h-[360px] overflow-y-auto px-1.5 pb-2">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeListId === SYSTEM_WATCHLIST_ID}
                      onClick={() => {
                        setActiveListId(SYSTEM_WATCHLIST_ID)
                        setSelectorMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-3 rounded px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded border border-white/[0.12] bg-white/[0.05] text-base">
                        📊
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">Top 200 · Thị trường</span>
                      {activeListId === SYSTEM_WATCHLIST_ID ? <Check className="size-5 shrink-0 text-sky-200" /> : null}
                    </button>

                    {watchlists.map((watchlist) => (
                      <button
                        key={watchlist.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={activeListId === watchlist.id}
                        onClick={() => {
                          setActiveListId(watchlist.id)
                          setSelectorMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-3 rounded px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded border border-white/[0.12] bg-white/[0.05] text-base text-slate-300">
                          {watchlist.emoji ?? <List className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-100">{watchlist.name}</span>
                          {watchlist.is_default ? (
                            <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-500">Mặc định</span>
                          ) : null}
                        </span>
                        {activeListId === watchlist.id ? <Check className="size-5 shrink-0 text-sky-200" /> : null}
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-white/[0.12] p-1.5">
                    <button
                      type="button"
                      onClick={openCreateWatchlist}
                      className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm font-semibold text-sky-300 transition-colors hover:bg-white/[0.07]"
                    >
                      <Plus className="size-5" />
                      Tạo watchlist mới
                    </button>
                    <button
                      type="button"
                      onClick={openManageWatchlists}
                      className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm font-semibold text-sky-300 transition-colors hover:bg-white/[0.07]"
                    >
                      <Settings2 className="size-5" />
                      Quản lý các watchlist
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div ref={sortMenuRef} className="relative">
              <button
                data-watchlist-sort-trigger
                type="button"
                onClick={() => {
                  setSortMenuOpen((open) => !open)
                  setSelectorMenuOpen(false)
                }}
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
            <button
              type="button"
              onClick={openManageWatchlists}
              className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm border border-white/[0.08] bg-[#30353d] px-2 text-[10px] font-bold text-slate-300 transition-colors hover:bg-[#393f48] hover:text-white"
            >
              <Settings2 className="size-3.5" />
              Quản lý Watchlist
            </button>
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

      <Dialog
        open={manageOpen}
        onOpenChange={(open) => {
          setManageOpen(open)
          if (!open) {
            setEditingWatchlistId(null)
            setRenameValue("")
            setRenameEmoji(null)
            setDraggedWatchlistId(null)
            setManageError("")
          }
        }}
      >
        <DialogContent
          data-watchlist-manage-dialog
          className="max-h-[85vh] overflow-hidden border-white/[0.16] bg-[#1c2128] p-0 font-ticker text-slate-100 shadow-[0_30px_90px_-28px_rgba(0,0,0,0.95)] sm:max-w-[900px]"
        >
          <DialogHeader className="border-b border-white/[0.14] bg-[#2a2f37] px-5 py-3.5 text-left">
            <DialogTitle className="text-lg font-black tracking-tight text-slate-100">Quản lý Watchlist</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-6 pb-6 pt-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-sky-300/10 bg-[#213956] px-4 py-3 text-xs font-semibold text-sky-300">
              <Info className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">Kéo thả để sắp xếp lại thứ tự hiển thị các watchlist.</span>
              <button
                type="button"
                onClick={openCreateWatchlist}
                className="font-bold text-white underline decoration-white/70 underline-offset-4 hover:decoration-white"
              >
                Tạo watchlist mới
              </button>
            </div>

            {manageError ? (
              <div className="mt-3 rounded border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-xs font-semibold text-rose-300">
                {manageError}
              </div>
            ) : null}

            <div className="mt-5 border-t border-white/[0.16]">
              {watchlists.map((watchlist) => {
                const isEditing = editingWatchlistId === watchlist.id
                const isBusy = managingWatchlistId === watchlist.id
                return (
                  <div
                    key={watchlist.id}
                    data-watchlist-manage-row
                    draggable={!isEditing && !isBusy}
                    onDragStart={(event) => {
                      if (isEditing || isBusy) return
                      setDraggedWatchlistId(watchlist.id)
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData("text/plain", watchlist.id)
                    }}
                    onDragEnd={() => setDraggedWatchlistId(null)}
                    onDragOver={(event) => {
                      if (isEditing || isBusy) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      handleWatchlistDrop(watchlist.id)
                    }}
                    className={cn(
                      "grid min-h-[76px] grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.08] px-3 py-3 transition-colors",
                      draggedWatchlistId === watchlist.id && "opacity-45",
                      !isEditing && "hover:bg-white/[0.025]",
                    )}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      className="grid size-9 cursor-grab place-items-center text-slate-300 active:cursor-grabbing"
                      title="Kéo để đổi thứ tự watchlist"
                      aria-label={`Kéo ${watchlist.name} để đổi thứ tự`}
                    >
                      <GripVertical className="size-6" />
                    </button>

                    {isEditing ? (
                      <div className="flex min-w-0 items-center gap-3">
                        <WatchlistEmojiPicker value={renameEmoji} onChange={setRenameEmoji} compact />
                        <div className="min-w-0 flex-1">
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={(event) => {
                            setRenameValue(event.target.value)
                            setManageError("")
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleRenameWatchlist(watchlist.id)
                            if (event.key === "Escape") {
                              setEditingWatchlistId(null)
                              setRenameValue("")
                              setRenameEmoji(null)
                            }
                          }}
                          maxLength={80}
                          className="h-10 max-w-lg border-white/[0.14] bg-[#11161c] text-sm font-semibold"
                        />
                        {watchlist.is_default ? (
                          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Watchlist mặc định</div>
                        ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-white/[0.1] bg-[#292f37] text-lg text-slate-300">
                          {watchlist.emoji ?? <List className="size-4" />}
                        </span>
                        <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-100">{watchlist.name}</div>
                        {watchlist.is_default ? (
                          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Watchlist mặc định</div>
                        ) : null}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRenameWatchlist(watchlist.id)}
                            disabled={isBusy || !renameValue.trim()}
                            className="inline-flex h-10 items-center justify-center rounded bg-blue-500 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {isBusy ? "Đang lưu…" : "Lưu"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingWatchlistId(null)
                              setRenameValue("")
                              setRenameEmoji(null)
                              setManageError("")
                            }}
                            disabled={isBusy}
                            className="grid size-10 place-items-center rounded border border-white/[0.1] bg-[#343941] text-slate-200 transition-colors hover:bg-[#40454f] disabled:opacity-45"
                            aria-label={`Hủy đổi tên ${watchlist.name}`}
                          >
                            <X className="size-5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => beginRenameWatchlist(watchlist)}
                          disabled={isBusy}
                          className="grid size-9 place-items-center rounded-md bg-blue-500 text-white transition-colors hover:bg-blue-400 disabled:opacity-45"
                          aria-label={`Sửa ${watchlist.name}`}
                        >
                          <Pencil className="size-5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void handleDeleteWatchlist(watchlist)}
                        disabled={isBusy || watchlists.length <= 1}
                        className="grid size-9 place-items-center rounded-md bg-red-500 text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={`Xóa ${watchlist.name}`}
                        title={watchlists.length <= 1 ? "Không thể xóa watchlist duy nhất" : "Xóa watchlist"}
                      >
                        <Trash2 className="size-5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 text-[10px] font-semibold text-slate-500">
              <span>Top 200 · Thị trường là danh sách hệ thống nên không xuất hiện trong phần quản lý.</span>
              <span className="font-mono">{watchlists.length} watchlist</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setCreateError("")
            setNewWatchlistName("")
            setNewWatchlistEmoji(null)
          }
        }}
      >
        <DialogContent
          data-watchlist-create-dialog
          className="overflow-visible border-white/[0.16] bg-[#1c2128] p-0 font-ticker text-slate-100 shadow-[0_30px_90px_-28px_rgba(0,0,0,0.95)] sm:max-w-[560px]"
        >
          <DialogHeader className="border-b border-white/[0.14] bg-[#2a2f37] px-5 py-3.5 text-left">
            <DialogTitle className="text-lg font-black tracking-tight text-slate-100">Tạo Watchlist mới</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 px-5 py-5">
            <div>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Icon & tên Watchlist</div>
              <div className="flex items-center gap-3">
                <WatchlistEmojiPicker value={newWatchlistEmoji} onChange={setNewWatchlistEmoji} />
                <Input
                  autoFocus
                  value={newWatchlistName}
                  onChange={(event) => {
                    setNewWatchlistName(event.target.value)
                    setCreateError("")
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newWatchlistName.trim()) void handleCreateWatchlist()
                  }}
                  placeholder="VD: Ngân hàng, Theo dõi breakout..."
                  maxLength={80}
                  className="h-12 border-white/[0.12] bg-[#11161c] text-sm font-semibold text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="rounded-md border border-white/[0.08] bg-[#242a32] px-3 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Xem trước</div>
              <div className="mt-2 flex items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-white/[0.1] bg-[#292f37] text-base text-slate-300">
                  {newWatchlistEmoji ?? <List className="size-4" />}
                </span>
                <span className="min-w-0 truncate text-sm font-black text-slate-100">
                  {newWatchlistName.trim() || "Tên Watchlist"}
                </span>
              </div>
            </div>

            {createError ? (
              <p className="rounded border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-xs font-semibold text-rose-300">
                {createError}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-white/[0.12] bg-[#252b33] px-5 py-3">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              className="h-9 border-white/[0.12] bg-[#30363f] text-xs font-bold text-slate-200 hover:bg-[#3a414b] hover:text-white"
            >
              Hủy
            </Button>
            <Button
              onClick={() => void handleCreateWatchlist()}
              disabled={creatingWatchlist || !newWatchlistName.trim()}
              className="h-9 bg-sky-500 px-4 text-xs font-black text-white hover:bg-sky-400"
            >
              {creatingWatchlist ? "Đang tạo..." : "Tạo Watchlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (!open) setAddSuggestionsOpen(false)
        }}
      >
        <DialogContent className="max-w-md overflow-visible border-white/[0.12] bg-[#20242b] font-ticker text-slate-100">
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
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  autoFocus
                  value={addTicker}
                  role="combobox"
                  aria-label="Tìm mã cổ phiếu để thêm vào watchlist"
                  aria-autocomplete="list"
                  aria-expanded={addSuggestionsOpen}
                  aria-controls={addListboxId}
                  aria-activedescendant={addSuggestionsOpen && activeAddStock ? `${addListboxId}-${activeAddStock.ticker}` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={() => {
                    setAddSuggestionsOpen(true)
                    setAddActiveIndex(Math.max(0, addSuggestions.findIndex((item) => item.ticker === selectedAddStock?.ticker)))
                  }}
                  onChange={(event) => {
                    setAddTicker(event.target.value.toUpperCase())
                    setAddActiveIndex(0)
                    setAddSuggestionsOpen(true)
                    setAddError("")
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault()
                      moveAddActive(1)
                      return
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault()
                      moveAddActive(-1)
                      return
                    }
                    if (event.key === "Escape") {
                      setAddSuggestionsOpen(false)
                      return
                    }
                    if (event.key === "Enter") {
                      event.preventDefault()
                      const target = selectedAddStock ?? activeAddStock
                      if (target && addTargetId) void handleAddTicker(target.ticker)
                    }
                  }}
                  placeholder="Nhập mã hoặc tên công ty…"
                  maxLength={80}
                  className="h-11 border-white/[0.1] bg-[#171b22] pl-10 pr-10 text-sm font-semibold"
                />
                {addTicker ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAddTicker("")
                      setAddActiveIndex(0)
                      setAddSuggestionsOpen(true)
                    }}
                    className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-200"
                    aria-label="Xóa mã đang tìm"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}

                {addSuggestionsOpen ? (
                  <div
                    id={addListboxId}
                    role="listbox"
                    aria-label="Top Stocks 200"
                    data-watchlist-stock-autocomplete
                    className="absolute left-0 right-0 top-[calc(100%+6px)] z-[80] max-h-72 overflow-y-auto rounded-xl border border-white/[0.1] bg-[#15181d] p-1.5 shadow-[0_20px_54px_-18px_rgba(0,0,0,0.95)]"
                  >
                    {addSuggestions.length ? addSuggestions.map((stock, index) => {
                      const active = index === addActiveIndex
                      const selected = stock.ticker === selectedAddStock?.ticker
                      return (
                        <button
                          key={stock.ticker}
                          id={`${addListboxId}-${stock.ticker}`}
                          role="option"
                          aria-selected={selected}
                          type="button"
                          onMouseEnter={() => setAddActiveIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectAddStock(stock.ticker)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                            active ? "bg-white/[0.09]" : "hover:bg-white/[0.05]",
                          )}
                        >
                          <StockLogo symbol={stock.ticker} size={34} className="rounded-lg" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <strong className="font-ticker text-sm font-black text-white">{stock.ticker}</strong>
                              {selected ? (
                                <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">
                                  Đã chọn
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-slate-400">
                              {stock.companyName}
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] font-semibold text-slate-600">
                            {stock.sector || ""}
                          </span>
                        </button>
                      )
                    }) : (
                      <div className="px-3 py-6 text-center text-xs text-slate-500">
                        Không tìm thấy mã phù hợp.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              {selectedAddStock ? (
                <div className="flex items-center gap-2 rounded-lg border border-sky-400/15 bg-sky-400/[0.06] px-2.5 py-2">
                  <StockLogo symbol={selectedAddStock.ticker} size={28} className="rounded-md" />
                  <div className="min-w-0">
                    <div className="font-ticker text-xs font-black text-sky-200">{selectedAddStock.ticker}</div>
                    <div className="truncate text-[10px] text-slate-400">{selectedAddStock.companyName}</div>
                  </div>
                </div>
              ) : null}
            </label>
            {addError ? <p className="text-xs font-semibold text-rose-400">{addError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Hủy</Button>
            <Button
              onClick={() => void handleAddTicker()}
              disabled={addingTicker || !selectedAddStock || !addTargetId}
            >
              {addingTicker ? "Đang thêm..." : selectedAddStock ? `Thêm ${selectedAddStock.ticker}` : "Chọn mã"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
