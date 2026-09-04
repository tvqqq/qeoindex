"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { createPortal } from "react-dom"
import { Loader2, SlidersHorizontal } from "lucide-react"

import {
  LiveMarketBoardV2,
  type BoardUniverseStock,
  type IndexQuote,
} from "@/components/live-market-board-v2"
import type { LiveStockQuote } from "@/components/live-market-stock"
import type { IntradayPoint } from "@/modules/market/realtime/intraday-5m"
import {
  defaultStockFilterCriteria,
  filterBoardTickers,
  isValidDailyFilterCache,
  stockFilterHash,
  type StockFilterCriteriaV1,
  type StockFilterDailyCacheV1,
} from "@/lib/market-board/stock-filter"
import { StockFilterModal } from "@/components/market-board/stock-filter-modal"

export type FilterBoardUniverseStock = BoardUniverseStock & {
  exchange: string
  kfspSector: string
}

type BoardSeedQuotes = Record<string, LiveStockQuote | IndexQuote>
type BoardSeedHistories = Record<string, IntradayPoint[]>
type PendingBoardMode = "sector" | "movers" | null

type BatchQuote = {
  symbol: string
  price: number | null
  reference: number | null
  ceiling: number | null
  floor: number | null
  change: number | null
  changePercent: number | null
  volume: number | null
  foreignBuyVolume?: number | null
  foreignSellVolume?: number | null
  foreignBuyValue?: number | null
  foreignSellValue?: number | null
  foreignNetValue?: number | null
  foreignRoom?: number | null
}

type QuoteResponse = {
  ok: boolean
  quotes?: Record<string, BatchQuote>
  updatedAt?: string
  error?: string
}

type PreferenceResponse = {
  ok: boolean
  criteria?: StockFilterCriteriaV1 | null
  error?: string
}

const FILTER_CACHE_PREFIX = "stockos:market-board-filter:v1:"

function vietnamSessionDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function isIndexQuote(quote: LiveStockQuote | IndexQuote | undefined): quote is IndexQuote {
  return Boolean(quote && "value" in quote)
}

function mergeBatchQuotes(
  current: BoardSeedQuotes,
  batch: Record<string, BatchQuote>,
  updatedAt: string,
): BoardSeedQuotes {
  const next = { ...current }
  for (const [symbol, quote] of Object.entries(batch)) {
    if (!quote?.price || !Number.isFinite(quote.price) || quote.price <= 0) continue
    const existing = next[symbol]
    const previous = existing && !isIndexQuote(existing) ? existing : undefined
    next[symbol] = {
      ...previous,
      symbol,
      price: quote.price,
      reference: quote.reference ?? previous?.reference,
      ceiling: quote.ceiling ?? previous?.ceiling,
      floor: quote.floor ?? previous?.floor,
      change: quote.change ?? previous?.change,
      changePercent: quote.changePercent ?? previous?.changePercent ?? 0,
      volume: quote.volume ?? previous?.volume,
      foreignBuyVolume: quote.foreignBuyVolume ?? previous?.foreignBuyVolume,
      foreignSellVolume: quote.foreignSellVolume ?? previous?.foreignSellVolume,
      foreignBuyValue: quote.foreignBuyValue ?? previous?.foreignBuyValue,
      foreignSellValue: quote.foreignSellValue ?? previous?.foreignSellValue,
      foreignNetValue: quote.foreignNetValue ?? previous?.foreignNetValue,
      foreignRoom: quote.foreignRoom ?? previous?.foreignRoom,
      updatedAt,
    }
  }
  return next
}

function stockOnlyQuotes(quotes: BoardSeedQuotes): Record<string, LiveStockQuote> {
  const result: Record<string, LiveStockQuote> = {}
  for (const [symbol, quote] of Object.entries(quotes)) {
    if (!isIndexQuote(quote)) result[symbol] = quote
  }
  return result
}

function cacheKeyForUser(userId: string) {
  return `${FILTER_CACHE_PREFIX}${userId}`
}

export function MarketBoardFilterShell({
  universe,
  initialQuotes,
  initialHistories,
  isSessionOpen,
  userId,
  universeRunId,
}: {
  universe: FilterBoardUniverseStock[]
  initialQuotes: BoardSeedQuotes
  initialHistories: BoardSeedHistories
  isSessionOpen?: boolean
  userId: string
  universeRunId: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const ignoreModeCaptureRef = useRef(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [boardKey, setBoardKey] = useState(0)
  const [quoteSeed, setQuoteSeed] = useState<BoardSeedQuotes>(() => ({ ...initialQuotes }))
  const [historySeed, setHistorySeed] = useState<BoardSeedHistories>(() => ({ ...initialHistories }))
  const [filterActive, setFilterActive] = useState(false)
  const [filteredTickers, setFilteredTickers] = useState<string[]>([])
  const [savedCriteria, setSavedCriteria] = useState<StockFilterCriteriaV1 | null>(null)
  const [modalCriteria, setModalCriteria] = useState<StockFilterCriteriaV1 | null>(null)
  const [modalQuotes, setModalQuotes] = useState<Record<string, LiveStockQuote>>({})
  const [modalOpen, setModalOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [quoteReady, setQuoteReady] = useState(false)
  const [persistenceError, setPersistenceError] = useState("")
  const [pendingModeAfterRemount, setPendingModeAfterRemount] = useState<PendingBoardMode>(null)

  const universeSymbols = useMemo(() => universe.map((stock) => stock.ticker), [universe])
  const availableSectors = useMemo(
    () => [...new Set(universe.map((stock) => stock.kfspSector.trim()).filter(Boolean))],
    [universe],
  )
  const fallbackCriteria = useMemo(
    () => defaultStockFilterCriteria(availableSectors),
    [availableSectors],
  )
  const filteredTickerSet = useMemo(() => new Set(filteredTickers), [filteredTickers])
  const activeUniverse = useMemo(
    () => filterActive ? universe.filter((stock) => filteredTickerSet.has(stock.ticker)) : universe,
    [filterActive, filteredTickerSet, universe],
  )

  const findModeButton = useCallback((mode: Exclude<PendingBoardMode, null>) => {
    const expected = mode === "sector" ? "Tất cả" : "Top movers"
    return [...(rootRef.current?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent?.trim() === expected) as HTMLButtonElement | undefined
  }, [])

  const clickChildMode = useCallback((mode: Exclude<PendingBoardMode, null>) => {
    const button = findModeButton(mode)
    if (!button) return false
    ignoreModeCaptureRef.current = true
    try {
      button.click()
    } finally {
      ignoreModeCaptureRef.current = false
    }
    return true
  }, [findModeButton])

  useEffect(() => {
    const findPortalTarget = () => {
      const allButton = findModeButton("sector")
      const moversButton = findModeButton("movers")
      const sharedParent = allButton?.parentElement
      setPortalTarget(sharedParent && sharedParent === moversButton?.parentElement ? sharedParent : null)
    }
    findPortalTarget()
    const observer = new MutationObserver(findPortalTarget)
    if (rootRef.current) observer.observe(rootRef.current, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [boardKey, findModeButton])

  useEffect(() => {
    if (filterActive || !pendingModeAfterRemount || !portalTarget) return
    if (clickChildMode(pendingModeAfterRemount)) setPendingModeAfterRemount(null)
  }, [clickChildMode, filterActive, pendingModeAfterRemount, portalTarget])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch("/api/me/market-board-filter", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        })
        const payload = await response.json() as PreferenceResponse
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to load filter")
        setSavedCriteria(payload.criteria ?? null)
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        setPersistenceError("Không thể tải bộ lọc đã lưu. Bạn vẫn có thể dùng Filter CP trên thiết bị này.")
      }
    })()
    return () => controller.abort()
  }, [])

  const fetchCurrentQuotes = useCallback(async () => {
    const response = await fetch("/api/market/quotes", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ symbols: universeSymbols }),
    })
    const payload = await response.json() as QuoteResponse
    if (!response.ok || !payload.ok || !payload.quotes) {
      throw new Error(payload.error || "Unable to refresh market quotes")
    }
    const receivedAt = payload.updatedAt || new Date().toISOString()
    const merged = mergeBatchQuotes(quoteSeed, payload.quotes, receivedAt)
    return { merged, stocks: stockOnlyQuotes(merged) }
  }, [quoteSeed, universeSymbols])

  const writeDailyCache = useCallback((criteria: StockFilterCriteriaV1, tickers: string[]) => {
    const cache: StockFilterDailyCacheV1 = {
      version: 1,
      userId,
      vietnamDate: vietnamSessionDay(),
      universeRunId,
      filterHash: stockFilterHash(criteria),
      tickers,
      resolvedAt: new Date().toISOString(),
    }
    try {
      localStorage.setItem(cacheKeyForUser(userId), JSON.stringify(cache))
    } catch {
      // Cache is optional; persisted criteria still restore the user's setup.
    }
  }, [universeRunId, userId])

  const readDailyCache = useCallback((criteria: StockFilterCriteriaV1) => {
    try {
      const raw = localStorage.getItem(cacheKeyForUser(userId))
      if (!raw) return null
      const parsed = JSON.parse(raw) as unknown
      const expected = {
        userId,
        vietnamDate: vietnamSessionDay(),
        universeRunId,
        filterHash: stockFilterHash(criteria),
        universeSymbols,
      }
      return isValidDailyFilterCache(parsed, expected) ? parsed : null
    } catch {
      return null
    }
  }, [universeRunId, universeSymbols, userId])

  const openFilterEditor = useCallback(async (criteria: StockFilterCriteriaV1) => {
    setPersistenceError("")
    setModalCriteria(criteria)
    setQuoteReady(false)
    setModalOpen(true)
    setIsRefreshing(true)
    try {
      const { merged, stocks } = await fetchCurrentQuotes()
      setQuoteSeed(merged)
      setModalQuotes(stocks)
      setQuoteReady(true)
    } catch {
      setPersistenceError("Không thể cập nhật giá/thanh khoản hiện tại. Vui lòng thử lại trước khi Áp dụng.")
    } finally {
      setIsRefreshing(false)
    }
  }, [fetchCurrentQuotes])

  const activateSavedFilter = useCallback(async (criteria: StockFilterCriteriaV1) => {
    const cached = readDailyCache(criteria)
    if (cached) {
      clickChildMode("sector")
      setFilteredTickers(cached.tickers)
      setFilterActive(true)
      return
    }

    setIsRefreshing(true)
    try {
      const { merged, stocks } = await fetchCurrentQuotes()
      const tickers = filterBoardTickers(universe, stocks, criteria)
      setQuoteSeed(merged)
      setHistorySeed({})
      setFilteredTickers(tickers)
      writeDailyCache(criteria, tickers)
      setFilterActive(true)
      setBoardKey((key) => key + 1)
    } catch {
      setPersistenceError("Không thể cập nhật dữ liệu để kích hoạt Filter CP. Bảng hiện tại được giữ nguyên.")
      await openFilterEditor(criteria)
    } finally {
      setIsRefreshing(false)
    }
  }, [clickChildMode, fetchCurrentQuotes, openFilterEditor, readDailyCache, universe, writeDailyCache])

  const handleFilterButton = useCallback(() => {
    if (filterActive) {
      void openFilterEditor(savedCriteria ?? fallbackCriteria)
      return
    }
    if (!savedCriteria) {
      void openFilterEditor(fallbackCriteria)
      return
    }
    void activateSavedFilter(savedCriteria)
  }, [activateSavedFilter, fallbackCriteria, filterActive, openFilterEditor, savedCriteria])

  const persistCriteria = useCallback(async (criteria: StockFilterCriteriaV1) => {
    try {
      const response = await fetch("/api/me/market-board-filter", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ criteria }),
      })
      const payload = await response.json() as PreferenceResponse
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to save filter")
      setPersistenceError("")
      if (payload.criteria) setSavedCriteria(payload.criteria)
    } catch {
      setPersistenceError("Không thể lưu bộ lọc lên tài khoản. Filter CP vẫn đang hoạt động cục bộ.")
    }
  }, [])

  const handleApply = useCallback((criteria: StockFilterCriteriaV1, tickers: string[]) => {
    const nextSeed: BoardSeedQuotes = { ...quoteSeed, ...modalQuotes }
    setQuoteSeed(nextSeed)
    setHistorySeed({})
    setSavedCriteria(criteria)
    setFilteredTickers(tickers)
    writeDailyCache(criteria, tickers)
    setFilterActive(true)
    setQuoteReady(false)
    setModalOpen(false)
    setBoardKey((key) => key + 1)
    void persistCriteria(criteria)
  }, [modalQuotes, persistCriteria, quoteSeed, writeDailyCache])

  const leaveFilter = useCallback(async (targetMode: Exclude<PendingBoardMode, null>) => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setPersistenceError("")
    try {
      const { merged } = await fetchCurrentQuotes()
      setQuoteSeed(merged)
      // Empty seed forces the existing board to perform its current intraday bootstrap for all symbols.
      setHistorySeed({})
      setPendingModeAfterRemount(targetMode)
      setFilterActive(false)
      setBoardKey((key) => key + 1)
    } catch {
      setPersistenceError("Không thể đồng bộ lại toàn bộ bảng điện. Filter CP được giữ nguyên để tránh hiển thị dữ liệu cũ.")
    } finally {
      setIsRefreshing(false)
    }
  }, [fetchCurrentQuotes, isRefreshing])

  const handleBoardClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!filterActive || ignoreModeCaptureRef.current) return
    const button = (event.target as HTMLElement).closest("button")
    const text = button?.textContent?.trim()
    const targetMode: PendingBoardMode = text === "Tất cả" ? "sector" : text === "Top movers" ? "movers" : null
    if (!targetMode) return
    event.preventDefault()
    event.stopPropagation()
    void leaveFilter(targetMode)
  }, [filterActive, leaveFilter])

  return (
    <div ref={rootRef} onClickCapture={handleBoardClickCapture} className="relative h-full min-h-0">
      <LiveMarketBoardV2
        key={boardKey}
        universe={activeUniverse}
        initialQuotes={quoteSeed}
        initialHistories={historySeed}
        isSessionOpen={isSessionOpen}
      />

      {filterActive && filteredTickers.length === 0 ? (
        <div className="pointer-events-none absolute left-1/2 top-[118px] z-20 -translate-x-1/2 rounded-full border border-amber-500/30 bg-[#171208]/95 px-4 py-2 text-xs font-medium text-amber-300 shadow-xl">
          Không có cổ phiếu phù hợp bộ lọc hiện tại
        </div>
      ) : null}

      {portalTarget ? createPortal(
        <button
          type="button"
          onClick={handleFilterButton}
          disabled={isRefreshing && !modalOpen}
          className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-all ${
            filterActive
              ? "border border-emerald-400/30 bg-emerald-500/15 font-semibold text-emerald-300 shadow-[0_2px_8px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.12)]"
              : "text-muted-2 hover:bg-white/[0.04] hover:text-foreground"
          }`}
          title={filterActive ? "Chỉnh sửa Filter CP" : "Lọc cổ phiếu"}
        >
          {isRefreshing && !modalOpen ? <Loader2 className="h-3 w-3 animate-spin" /> : <SlidersHorizontal className="h-3 w-3" />}
          <span>Filter CP</span>
          {filterActive ? <span className="font-mono text-[10px]">{filteredTickers.length}</span> : null}
        </button>,
        portalTarget,
      ) : null}

      <StockFilterModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        universe={universe}
        quotes={modalQuotes}
        initialCriteria={modalCriteria ?? savedCriteria ?? fallbackCriteria}
        onApply={handleApply}
        persistenceError={persistenceError}
        isRefreshing={isRefreshing}
        quoteReady={quoteReady}
      />
    </div>
  )
}

export default MarketBoardFilterShell
