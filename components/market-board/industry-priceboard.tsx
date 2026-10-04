"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { BarChart3, GripVertical, RotateCcw, Search, Star } from "lucide-react"
import type { LiveBoardStock, LiveStockQuote } from "@/components/live-market-stock"
import { getSectorIcon } from "@/components/stock-identity"
import {
  averagePriceboardChange,
  defaultIndustryColumnOrder,
  hasValidPriceboardQuote,
  industryLabelForStock,
  industryPriceboardBackground,
  moveIndustryColumn,
  moveIndustryColumnBy,
  packIndustryLanes,
  reconcileIndustryColumnOrder,
  sortIndustryStocksByPerformance,
  type IndustryPriceboardQuote,
  type IndustryPriceboardStock,
} from "@/modules/market/board/industry-priceboard"
import type { Vn30Membership } from "@/modules/market/board/vn30-membership-contract"

type BoardQuote = LiveStockQuote | undefined

type IndustryPriceboardProps = {
  universe: Array<LiveBoardStock & { kfspSector?: string | null }>
  visibleUniverse: Array<LiveBoardStock & { kfspSector?: string | null }>
  canonicalIndustries: readonly string[]
  displayQuotes: Readonly<Record<string, BoardQuote>>
  orderingQuotes: Readonly<Record<string, IndustryPriceboardQuote | undefined>>
  watchedSymbols: ReadonlySet<string>
  onToggleWatch: (ticker: string) => void
  onOpen: (ticker: string) => void
  userId: string
  canonicalSymbols: readonly string[]
  vn30Membership: Vn30Membership | null
}

const INDUSTRY_ORDER_KEY = "qeoindex:market-board-industry-order:v1"
const PRICE_FORMATTER = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const VOLUME_FORMATTER = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 })
const COLUMN_WIDTH = "w-[232px] min-w-[232px] max-w-[232px]"

function formatPrice(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
  return PRICE_FORMATTER.format(value)
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatVolume(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return VOLUME_FORMATTER.format(value)
}

function quoteIsValid(quote?: IndustryPriceboardQuote) {
  return hasValidPriceboardQuote(quote)
}

type CompactStockRowProps = {
  stock: IndustryPriceboardStock
  quote: BoardQuote
  watched: boolean
  onToggleWatch: (ticker: string) => void
  onOpen: (ticker: string) => void
}

const CompactStockRow = memo(function CompactStockRow({ stock, quote, watched, onToggleWatch, onOpen }: CompactStockRowProps) {
  const change = quoteIsValid(quote) ? quote.changePercent : null
  return (
    <div
      className="board-stock-row group flex h-[25px] items-center gap-0.5 rounded-full border border-white/[0.07] px-1 transition-[border-color,box-shadow,filter] duration-100 hover:border-white/35 hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.10)]"
      style={{ backgroundColor: industryPriceboardBackground(quote) }}
    >
      <button
        type="button"
        aria-label={watched ? `Bỏ ${stock.ticker} khỏi Theo dõi` : `Thêm ${stock.ticker} vào Theo dõi`}
        aria-pressed={watched}
        onClick={() => onToggleWatch(stock.ticker)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-2 transition-colors hover:text-amber-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
      >
        <Star className={`h-[11px] w-[11px] ${watched ? "fill-amber-300 text-amber-300" : ""}`} />
      </button>
      <button
        type="button"
        onClick={() => onOpen(stock.ticker)}
        aria-label={`Mở sổ lệnh ${stock.ticker}`}
        className="grid min-w-0 flex-1 grid-cols-[minmax(34px,1fr)_56px_54px_39px] items-center gap-1 text-left font-sans text-[12px] font-semibold leading-none text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
      >
        <span className="truncate font-semibold tracking-[0.01em] transition-[color,font-weight] group-hover:font-extrabold group-hover:text-white">{stock.ticker}</span>
        <span className="truncate text-right text-[11px] tabular-nums">{formatPrice(quote?.price)}</span>
        <span className="truncate text-right tabular-nums" title={typeof change === "number" ? `Thay đổi ${formatPercent(change)}` : "Chưa có biến động hợp lệ"}>
          {formatPercent(change)}
        </span>
        <span className="truncate text-right text-[10px] tabular-nums text-white/55">{formatVolume(quote?.volume)}</span>
      </button>
    </div>
  )
}, (previous, next) => previous.stock === next.stock && previous.quote === next.quote && previous.watched === next.watched && previous.onOpen === next.onOpen && previous.onToggleWatch === next.onToggleWatch)

function StockRows({ stocks, displayQuotes, watchedSymbols, onToggleWatch, onOpen }: {
  stocks: readonly IndustryPriceboardStock[]
  displayQuotes: Readonly<Record<string, BoardQuote>>
  watchedSymbols: ReadonlySet<string>
  onToggleWatch: (ticker: string) => void
  onOpen: (ticker: string) => void
}) {
  if (stocks.length === 0) return <div className="px-2 py-4 text-center text-[11px] text-muted-2">Chưa có mã phù hợp</div>
  return <div className="space-y-[4px] p-1">{stocks.map((stock) => (
    <CompactStockRow key={stock.ticker} stock={stock} quote={displayQuotes[stock.ticker]} watched={watchedSymbols.has(stock.ticker)} onToggleWatch={onToggleWatch} onOpen={onOpen} />
  ))}</div>
}

export function IndustryPriceboard({
  universe,
  visibleUniverse,
  canonicalIndustries,
  displayQuotes,
  orderingQuotes,
  watchedSymbols,
  onToggleWatch,
  onOpen,
  userId,
  canonicalSymbols,
  vn30Membership,
}: IndustryPriceboardProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; source: string; x: number; y: number } | null>(null)
  const onOpenRef = useRef(onOpen)
  const onToggleWatchRef = useRef(onToggleWatch)
  useLayoutEffect(() => {
    onOpenRef.current = onOpen
    onToggleWatchRef.current = onToggleWatch
  }, [onOpen, onToggleWatch])
  const stableOpen = useCallback((ticker: string) => onOpenRef.current(ticker), [])
  const stableToggleWatch = useCallback((ticker: string) => onToggleWatchRef.current(ticker), [])
  const autoScrollFrame = useRef<number | null>(null)
  const lastHoverRef = useRef<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null)
  const [watchQuery, setWatchQuery] = useState("")
  const industries = useMemo(
    () => [...new Set(canonicalIndustries.map((industry) => industry.trim()).filter(Boolean))],
    [canonicalIndustries],
  )
  const defaultOrder = useMemo(() => defaultIndustryColumnOrder(industries), [industries])
  const storageKey = `${INDUSTRY_ORDER_KEY}:${userId}`
  const [industryOrder, setIndustryOrder] = useState<string[]>(defaultOrder)
  const [hydratedIdentity, setHydratedIdentity] = useState<string | null>(null)
  const orderIdentity = `${storageKey}:${industries.join("\u001f")}`

  useEffect(() => {
    let saved: unknown = null
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) saved = JSON.parse(raw)
    } catch {
      saved = null
    }
    setIndustryOrder(reconcileIndustryColumnOrder(saved, industries))
    setHydratedIdentity(orderIdentity)
  }, [industries, orderIdentity, storageKey])

  useEffect(() => {
    if (hydratedIdentity !== orderIdentity) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(reconcileIndustryColumnOrder(industryOrder, industries)))
    } catch {
      // The current in-memory order stays usable when local storage is unavailable.
    }
  }, [hydratedIdentity, industryOrder, industries, orderIdentity, storageKey])

  useEffect(() => {
    const updateHover = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-industry-column]")
      const label = target?.dataset.industryColumn ?? null
      if (label !== lastHoverRef.current) {
        lastHoverRef.current = label
        setHoveredColumn(label)
      }
    }

    const cancelAutoScroll = () => {
      if (autoScrollFrame.current !== null) {
        window.cancelAnimationFrame(autoScrollFrame.current)
        autoScrollFrame.current = null
      }
    }

    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      drag.x = event.clientX
      drag.y = event.clientY
      updateHover(event.clientX, event.clientY)

      const rail = railRef.current
      const bounds = rail?.getBoundingClientRect()
      if (!rail || !bounds) return
      const edgeSize = 54
      const isNearEdge = drag.x < bounds.left + edgeSize || drag.x > bounds.right - edgeSize
      if (!isNearEdge) {
        cancelAutoScroll()
        return
      }
      if (autoScrollFrame.current !== null) return

      const scroll = () => {
        const current = dragRef.current
        const currentRail = railRef.current
        const currentBounds = currentRail?.getBoundingClientRect()
        if (!current || !currentRail || !currentBounds) {
          autoScrollFrame.current = null
          return
        }
        const direction = current.x < currentBounds.left + edgeSize ? -1 : current.x > currentBounds.right - edgeSize ? 1 : 0
        if (direction === 0) {
          autoScrollFrame.current = null
          return
        }
        currentRail.scrollLeft += direction * 9
        updateHover(current.x, current.y)
        autoScrollFrame.current = window.requestAnimationFrame(scroll)
      }
      autoScrollFrame.current = window.requestAnimationFrame(scroll)
    }

    const finish = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-industry-column]")
      const destination = target?.dataset.industryColumn
      if (destination) {
        setIndustryOrder((previous) => moveIndustryColumn(previous, drag.source, destination))
      }
      dragRef.current = null
      lastHoverRef.current = null
      setDraggingColumn(null)
      setHoveredColumn(null)
      cancelAutoScroll()
    }

    const cancel = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      lastHoverRef.current = null
      setDraggingColumn(null)
      setHoveredColumn(null)
      cancelAutoScroll()
    }

    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragRef.current) return
      dragRef.current = null
      lastHoverRef.current = null
      setDraggingColumn(null)
      setHoveredColumn(null)
      cancelAutoScroll()
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("keydown", keyDown)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("keydown", keyDown)
      cancelAutoScroll()
    }
  }, [])

  const normalizedWatchQuery = watchQuery.trim().toUpperCase()
  const watchCandidates = useMemo(() => {
    if (!normalizedWatchQuery) return []
    return universe
      .filter((stock) => stock.ticker.toUpperCase().includes(normalizedWatchQuery) && !watchedSymbols.has(stock.ticker))
      .sort((a, b) => a.rank - b.rank || a.ticker.localeCompare(b.ticker))
      .slice(0, 6)
  }, [normalizedWatchQuery, universe, watchedSymbols])

  const watchlistStocks = useMemo(
    () => sortIndustryStocksByPerformance(universe.filter((stock) => watchedSymbols.has(stock.ticker)), orderingQuotes),
    [orderingQuotes, universe, watchedSymbols],
  )
  const vn30Symbols = useMemo(() => new Set(vn30Membership?.symbols ?? []), [vn30Membership])
  const canonicalSymbolSet = useMemo(() => new Set(canonicalSymbols.map((symbol) => symbol.toUpperCase())), [canonicalSymbols])
  const matchedMembershipCount = vn30Membership
    ? vn30Membership.symbols.filter((symbol) => canonicalSymbolSet.has(symbol)).length
    : 0
  const vn30Stocks = useMemo(
    () => sortIndustryStocksByPerformance(visibleUniverse.filter((stock) => vn30Symbols.has(stock.ticker)), orderingQuotes),
    [orderingQuotes, visibleUniverse, vn30Symbols],
  )
  const industryStocks = useMemo(() => {
    const byIndustry = new Map<string, typeof visibleUniverse>()
    for (const industry of industries) byIndustry.set(industry, [])
    for (const stock of visibleUniverse) {
      const industry = industryLabelForStock(stock)
      const column = byIndustry.get(industry)
      if (column) column.push(stock)
    }
    return new Map([...byIndustry].map(([industry, stocks]) => [industry, sortIndustryStocksByPerformance(stocks, orderingQuotes)]))
  }, [industries, orderingQuotes, visibleUniverse])

  const industryLanes = useMemo(
    () => packIndustryLanes(industryOrder, industryStocks),
    [industryOrder, industryStocks],
  )

  const reorderByKeyboard = useCallback((industry: string, offset: -1 | 1) => {
    setIndustryOrder((previous) => moveIndustryColumnBy(previous, industry, offset))
  }, [])

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>, industry: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { pointerId: event.pointerId, source: industry, x: event.clientX, y: event.clientY }
    lastHoverRef.current = industry
    setDraggingColumn(industry)
    setHoveredColumn(industry)
  }, [])

  const resetOrder = useCallback(() => setIndustryOrder(defaultOrder), [defaultOrder])

  return (
    <div className="min-w-0" data-market-board-priceboard>
      <div
        ref={railRef}
        className="flex min-h-[calc(100vh-250px)] min-w-0 items-start gap-[9px] overflow-x-auto overflow-y-visible pb-3 pr-1 [scrollbar-color:#34414b_#0b0f14] [scrollbar-width:thin]"
        data-market-board-screenshot-rail
      >
        <section className={`${COLUMN_WIDTH} flex shrink-0 flex-col rounded-[15px] border border-white/[0.10] bg-[#0b0f14]`} data-industry-column="watchlist" data-market-board-industry-column>
          <ColumnHeader label="Theo dõi" count={watchlistStocks.length} average={averagePriceboardChange(watchlistStocks, orderingQuotes)} accent="watch" />
          <div className="border-b border-white/[0.06] p-1.5">
            <div className="relative flex h-7 items-center gap-1 rounded-full border border-white/[0.10] bg-[#090d12] px-2">
              <Search className="h-3 w-3 shrink-0 text-muted-2" />
              <input
                value={watchQuery}
                onChange={(event) => setWatchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setWatchQuery("")
                  if (event.key === "Enter" && watchCandidates[0]) {
                    stableToggleWatch(watchCandidates[0].ticker)
                    setWatchQuery("")
                  }
                }}
                placeholder="+ Thêm mã (vd: DIG, FPT)"
                aria-label="Tìm cổ phiếu để thêm vào Theo dõi"
                className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-foreground outline-none placeholder:text-muted-2"
              />
              {watchQuery ? (
                <button type="button" onClick={() => setWatchQuery("")} aria-label="Xóa tìm kiếm Theo dõi" className="flex h-5 w-5 items-center justify-center rounded-full text-muted-2 hover:text-white">
                  ×
                </button>
              ) : null}
              {watchCandidates.length > 0 ? (
                <div className="absolute left-0 right-0 top-[29px] z-20 rounded-md border border-white/[0.12] bg-[#0b0f14] p-1 shadow-md">
                  {watchCandidates.map((stock) => (
                    <button
                      key={stock.ticker}
                      type="button"
                      onClick={() => {
                        stableToggleWatch(stock.ticker)
                        setWatchQuery("")
                      }}
                      className="flex h-7 w-full items-center justify-between rounded px-1.5 font-mono text-[11px] text-foreground hover:bg-white/[0.06]"
                    >
                      <span>{stock.ticker}</span><span className="text-brand">+ Theo dõi</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <TableLabels />
          <StockRows stocks={watchlistStocks} displayQuotes={displayQuotes} watchedSymbols={watchedSymbols} onToggleWatch={stableToggleWatch} onOpen={stableOpen} />
        </section>

        <section className={`${COLUMN_WIDTH} flex shrink-0 flex-col rounded-[15px] border border-white/[0.10] bg-[#0b0f14]`} data-industry-column="vn30" data-market-board-industry-column>
          <ColumnHeader
            label="VN30"
            count={vn30Stocks.length}
            average={averagePriceboardChange(vn30Stocks, orderingQuotes)}
            accent="index"
            title={vn30Membership ? `Nguồn: ${vn30Membership.source}; dữ liệu lúc ${vn30Membership.asOf}; tải lúc ${vn30Membership.fetchedAt}` : "Nguồn VN30 hiện không khả dụng"}
          />
          {vn30Membership && matchedMembershipCount < vn30Membership.symbols.length ? (
            <div className="min-h-[20px] border-b border-white/[0.06] px-2 py-1 font-sans text-[9px] leading-tight text-ref">
              Phủ {matchedMembershipCount}/{vn30Membership.symbols.length} mã trong danh sách hiện tại
            </div>
          ) : null}
          <TableLabels />
          {vn30Membership ? (
            <StockRows stocks={vn30Stocks} displayQuotes={displayQuotes} watchedSymbols={watchedSymbols} onToggleWatch={stableToggleWatch} onOpen={stableOpen} />
          ) : (
            <div className="px-2 py-4 text-center text-[11px] text-muted-2">Không có dữ liệu VN30</div>
          )}
        </section>

        {industryLanes.map((lane, laneIndex) => (
          <div
            key={`industry-lane-${laneIndex}`}
            className={`${COLUMN_WIDTH} flex shrink-0 flex-col gap-[9px]`}
            data-market-board-industry-lane
          >
            {lane.industries.map((industry) => {
              const stocks = industryStocks.get(industry) ?? []
              const average = averagePriceboardChange(stocks, orderingQuotes)
              const IndustryIcon = getSectorIcon(industry)
              const isDragging = draggingColumn === industry
              const isDropTarget = hoveredColumn === industry && draggingColumn !== industry
              return (
                <section
                  key={industry}
                  data-industry-column={industry}
                  data-market-board-industry-column
                  className={`flex w-full flex-col rounded-[15px] border bg-[#0b0f14] ${isDropTarget ? "border-brand/70" : "border-white/[0.10]"} ${isDragging ? "opacity-60" : ""}`}
                >
                  <header
                    className="flex h-[32px] shrink-0 touch-none select-none items-center gap-1.5 border-b border-white/[0.07] px-2"
                    onPointerDown={(event) => beginDrag(event, industry)}
                  >
                    <button
                      type="button"
                      draggable={false}
                      aria-label={`Kéo để sắp xếp ngành ${industry}; dùng mũi tên trái phải để di chuyển`}
                      title="Kéo để đổi thứ tự; dùng ←/→ khi dùng bàn phím"
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") {
                          event.preventDefault()
                          reorderByKeyboard(industry, -1)
                        } else if (event.key === "ArrowRight") {
                          event.preventDefault()
                          reorderByKeyboard(industry, 1)
                        } else if (event.key === "Home") {
                          event.preventDefault()
                          setIndustryOrder((previous) => moveIndustryColumn(previous, industry, previous[0] ?? industry))
                        } else if (event.key === "End") {
                          event.preventDefault()
                          setIndustryOrder((previous) => moveIndustryColumn(previous, industry, previous.at(-1) ?? industry))
                        }
                      }}
                      className="flex h-6 w-4 shrink-0 touch-none items-center justify-center text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </button>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><IndustryIcon className="h-3.5 w-3.5" /></span>
                    <h2 className="min-w-0 flex-1 truncate font-sans text-[12px] font-bold text-foreground" title={industry}>{industry}</h2>
                    <span className={`shrink-0 font-mono text-[11px] font-semibold tabular-nums ${averageTone(average)}`} title="Trung bình % thay đổi của các mã có giá và % hợp lệ">
                      {average === null ? "—" : `${average > 0 ? "+" : ""}${average.toFixed(2)}%`}
                    </span>
                  </header>
                  <TableLabels />
                  <StockRows stocks={stocks} displayQuotes={displayQuotes} watchedSymbols={watchedSymbols} onToggleWatch={stableToggleWatch} onOpen={stableOpen} />
                </section>
              )
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pb-1 pr-1">
        <span className="text-[10px] text-muted-2">Kéo biểu tượng ⋮⋮ hoặc dùng phím mũi tên để sắp xếp ngành</span>
        <button type="button" onClick={resetOrder} className="flex h-7 items-center gap-1 rounded border border-white/[0.12] px-2 text-[10px] text-muted-2 transition-colors hover:border-brand/50 hover:text-foreground">
          <RotateCcw className="h-2.5 w-2.5" /> Đặt lại thứ tự
        </button>
      </div>
    </div>
  )
}

function averageTone(value: number | null) {
  if (value === null) return "text-muted-2"
  if (value > 0) return "text-up"
  if (value < 0) return "text-down"
  return "text-ref"
}

function ColumnHeader({ label, count, average, accent, title }: { label: string; count: number; average: number | null; accent: "watch" | "index"; title?: string }) {
  const isWatch = accent === "watch"
  return (
    <header className="flex h-[32px] shrink-0 items-center gap-1.5 border-b border-white/[0.07] px-2" title={title}>
      {isWatch ? <Star className="h-3 w-3 shrink-0 fill-amber-300 text-amber-300" /> : <BarChart3 className="h-3 w-3 shrink-0 text-brand" />}
      <h2 className="min-w-0 flex-1 truncate font-sans text-[12px] font-bold text-foreground">{label}</h2>
      <span className="shrink-0 font-mono text-[10px] text-muted-2">{count}</span>
      <span className={`shrink-0 font-mono text-[11px] font-semibold tabular-nums ${averageTone(average)}`}>
        {average === null ? "—" : `${average > 0 ? "+" : ""}${average.toFixed(2)}%`}
      </span>
    </header>
  )
}

function TableLabels() {
  return (
    <div className="grid h-[22px] grid-cols-[14px_minmax(34px,1fr)_56px_54px_39px] items-center gap-1 border-b border-white/[0.07] px-1.5 font-sans text-[10px] font-medium text-muted-2">
      <span />
      <span>Mã</span>
      <span className="text-right">Giá</span>
      <span className="text-right">+/-%</span>
      <span className="text-right">KL</span>
    </div>
  )
}
