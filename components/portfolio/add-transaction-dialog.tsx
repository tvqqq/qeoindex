"use client"

import React, { useState, useEffect, useCallback, useMemo, memo } from "react"
import {
  Loader2,
  X,
  Plus,
  TrendingUp,
  Layers,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TransactionAction } from "@/modules/portfolio/pnl"
import { cn } from "@/lib/utils"

interface PortfolioItem {
  id: string
  name: string
}

interface AddTransactionDialogProps {
  portfolioId: string
  portfolios?: PortfolioItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  initialTicker?: string
}

type MainTab = "trade" | "dividend"
type TradeSubTab = "single" | "batch"

const PRESET_SETUP_TAGS = [
  "Nền giá phẳng",
  "Vượt đỉnh 52T",
  "Breakout KL lớn",
  "Pocket Pivot",
  "Spring Wyckoff (Pha C)",
  "Test Cung MA20",
  "Sóng ngành dẫn dắt",
  "Mô hình VCP",
  "Tái tích lũy (Reaccumulation)",
  "Kênh giá song song",
]

const PRESET_MISTAKE_TAGS = [
  "FOMO mua đuổi",
  "Bắt dao rơi",
  "Bỏ qua Stoploss",
  "Vị thế quá lớn",
  "Không theo kế hoạch",
  "Bán non chưa vi phạm",
  "Gồng lỗ",
  "Bình quân giá xuống",
]

interface BarData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function AddTransactionDialog({
  portfolioId,
  portfolios = [],
  open,
  onOpenChange,
  onSuccess,
  initialTicker = "",
}: AddTransactionDialogProps) {
  const [mainTab, setMainTab] = useState<MainTab>("trade")
  const [tradeSubTab, setTradeSubTab] = useState<TradeSubTab>("single")

  // Selected portfolio
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(portfolioId)

  // Single Trade form
  const [action, setAction] = useState<TransactionAction>("buy")
  const [ticker, setTicker] = useState(initialTicker)
  const [transactionDate, setTransactionDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split("T")[0]
  })
  const [quantity, setQuantity] = useState<string>("")
  const [price, setPrice] = useState<string>("")
  const [feeRate, setFeeRate] = useState<string>("0.15") // % phí mặc định
  const [fee, setFee] = useState<string>("0")

  // Targets & Stop Losses
  const [targetPrice1, setTargetPrice1] = useState<string>("")
  const [targetPrice2, setTargetPrice2] = useState<string>("")
  const [targetPrice3, setTargetPrice3] = useState<string>("")
  const [stopLoss1, setStopLoss1] = useState<string>("")
  const [stopLoss2, setStopLoss2] = useState<string>("")
  const [stopLoss3, setStopLoss3] = useState<string>("")

  // Tags
  const [setupTags, setSetupTags] = useState<string[]>([])
  const [mistakeTags, setMistakeTags] = useState<string[]>([])
  const [showSetupPicker, setShowSetupPicker] = useState(false)
  const [showMistakePicker, setShowMistakePicker] = useState(false)
  const [customTagInput, setCustomTagInput] = useState("")

  // Note
  const [note, setNote] = useState<string>("")

  // Dividend specific state
  const [dividendAction, setDividendAction] = useState<"dividend_cash" | "dividend_stock" | "rights">("dividend_cash")
  const [dividendRate, setDividendRate] = useState<string>("")
  const [dividendTaxPct, setDividendTaxPct] = useState<string>("5")

  // Batch import state
  const [batchText, setBatchText] = useState("")
  const [batchPreview, setBatchPreview] = useState<
    Array<{ ticker: string; action: string; quantity: number; price: number; date: string; fee: number }>
  >([])

  // Chart data
  const [chartBars, setChartBars] = useState<BarData[]>([])
  const [loadingChart, setLoadingChart] = useState(false)

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string>("")

  // Sync initial props
  useEffect(() => {
    if (open) {
      setSelectedPortfolioId(portfolioId)
      if (initialTicker) setTicker(initialTicker)
      setErrorMsg("")
    }
  }, [open, portfolioId, initialTicker])

  // Automatically calculate fee when price or quantity or feeRate changes
  useEffect(() => {
    const p = parseFloat(price)
    const q = parseFloat(quantity)
    const rate = parseFloat(feeRate)
    if (!isNaN(p) && !isNaN(q) && !isNaN(rate) && p > 0 && q > 0) {
      const calculatedFee = (p * q * (rate / 100)).toFixed(2)
      setFee(calculatedFee)
    }
  }, [price, quantity, feeRate])

  // Fetch chart bars when ticker changes
  useEffect(() => {
    const cleanTicker = ticker.trim().toUpperCase()
    if (!cleanTicker || cleanTicker.length < 3) {
      setChartBars([])
      return
    }

    const timer = setTimeout(() => {
      setLoadingChart(true)
      fetch(`/api/market/ticker-bars?ticker=${cleanTicker}`, { cache: "no-store", credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { ok: boolean; bars?: BarData[] } | null) => {
          if (data?.ok && data.bars) {
            setChartBars(data.bars)
          } else {
            setChartBars([])
          }
        })
        .catch(() => setChartBars([]))
        .finally(() => setLoadingChart(false))
    }, 400)

    return () => clearTimeout(timer)
  }, [ticker])

  // Risk/Reward ratio calculation
  const rrRatio = useMemo(() => {
    const buyPrice = parseFloat(price)
    const target = parseFloat(targetPrice1)
    const sl = parseFloat(stopLoss1)

    if (isNaN(buyPrice) || buyPrice <= 0) return null
    if (isNaN(target) || isNaN(sl) || target <= buyPrice || sl >= buyPrice) return null

    const reward = target - buyPrice
    const risk = buyPrice - sl
    if (risk <= 0) return null

    const ratio = (reward / risk).toFixed(1)
    const targetGainPct = (((target - buyPrice) / buyPrice) * 100).toFixed(1)
    const slLossPct = (((buyPrice - sl) / buyPrice) * 100).toFixed(1)

    return {
      ratio,
      targetGainPct,
      slLossPct,
    }
  }, [price, targetPrice1, stopLoss1])

  // Parse batch input
  const handleParseBatch = useCallback(() => {
    const lines = batchText.split("\n").filter((l) => l.trim())
    const parsed: typeof batchPreview = []
    for (const line of lines) {
      const parts = line.split(/[,\t|;]/).map((p) => p.trim())
      if (parts.length >= 4) {
        const [t, a, q, p, d, f] = parts
        const tickerStr = t.toUpperCase()
        const act = a.toLowerCase() === "ban" || a.toLowerCase() === "sell" ? "sell" : "buy"
        const qtyNum = parseFloat(q)
        const priceNum = parseFloat(p)
        const dateStr = d || new Date().toISOString().split("T")[0]
        const feeNum = f ? parseFloat(f) : priceNum * qtyNum * 0.0015
        if (tickerStr && !isNaN(qtyNum) && !isNaN(priceNum)) {
          parsed.push({
            ticker: tickerStr,
            action: act,
            quantity: qtyNum,
            price: priceNum,
            date: dateStr,
            fee: isNaN(feeNum) ? 0 : feeNum,
          })
        }
      }
    }
    setBatchPreview(parsed)
  }, [batchText])

  const toggleSetupTag = (tag: string) => {
    setSetupTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const toggleMistakeTag = (tag: string) => {
    setMistakeTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const handleAddCustomTag = (type: "setup" | "mistake") => {
    const val = customTagInput.trim()
    if (!val) return
    if (type === "setup") toggleSetupTag(val)
    else toggleMistakeTag(val)
    setCustomTagInput("")
  }

  // Handle single trade submit
  const handleSubmitSingle = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")

    const cleanTicker = ticker.trim().toUpperCase()
    if (!cleanTicker) {
      setErrorMsg("Vui lòng nhập mã cổ phiếu.")
      return
    }

    const parsedQty = parseFloat(quantity)
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg("Khối lượng phải là số dương.")
      return
    }

    let parsedPrice = parseFloat(price)
    if (action === "dividend_stock") {
      parsedPrice = 0
    } else if (isNaN(parsedPrice) || parsedPrice < 0) {
      setErrorMsg("Giá không hợp lệ.")
      return
    }

    const parsedFee = parseFloat(fee || "0")
    const parsedFeeRate = parseFloat(feeRate || "0.15")

    setSubmitting(true)
    try {
      const res = await fetch(`/api/portfolio/${selectedPortfolioId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ticker: cleanTicker,
          action,
          quantity: parsedQty,
          price: parsedPrice,
          fee: parsedFee,
          fee_rate: parsedFeeRate,
          transaction_date: transactionDate,
          note: note.trim() || null,
          setup_tags: setupTags,
          mistake_tags: mistakeTags,
          tags: [...setupTags, ...mistakeTags],
          target_price_1: targetPrice1 ? parseFloat(targetPrice1) : null,
          target_price_2: targetPrice2 ? parseFloat(targetPrice2) : null,
          target_price_3: targetPrice3 ? parseFloat(targetPrice3) : null,
          stop_loss_1: stopLoss1 ? parseFloat(stopLoss1) : null,
          stop_loss_2: stopLoss2 ? parseFloat(stopLoss2) : null,
          stop_loss_3: stopLoss3 ? parseFloat(stopLoss3) : null,
        }),
      })

      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Thêm giao dịch thất bại.")
        return
      }

      onSuccess()
    } catch {
      setErrorMsg("Lỗi kết nối. Vui lòng thử lại.")
    } finally {
      setSubmitting(false)
    }
  }

  // Handle dividend submit
  const handleSubmitDividend = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")

    const cleanTicker = ticker.trim().toUpperCase()
    if (!cleanTicker) {
      setErrorMsg("Vui lòng nhập mã cổ phiếu.")
      return
    }

    const parsedQty = parseFloat(quantity)
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg("Khối lượng phải là số dương.")
      return
    }

    const parsedRate = parseFloat(dividendRate)
    if (isNaN(parsedRate) || parsedRate < 0) {
      setErrorMsg("Giá trị cổ tức không hợp lệ.")
      return
    }

    const taxPct = parseFloat(dividendTaxPct || "5")
    const calculatedFee =
      dividendAction === "dividend_cash" ? (parsedQty * parsedRate * (taxPct / 100)).toFixed(2) : "0"

    setSubmitting(true)
    try {
      const res = await fetch(`/api/portfolio/${selectedPortfolioId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ticker: cleanTicker,
          action: dividendAction,
          quantity: parsedQty,
          price: dividendAction === "dividend_stock" ? 0 : parsedRate,
          fee: parseFloat(calculatedFee),
          transaction_date: transactionDate,
          note: note.trim() || `Cổ tức ${dividendAction === "dividend_cash" ? "tiền mặt" : "cổ phiếu"}`,
        }),
      })

      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Thêm cổ tức thất bại.")
        return
      }

      onSuccess()
    } catch {
      setErrorMsg("Lỗi kết nối. Vui lòng thử lại.")
    } finally {
      setSubmitting(false)
    }
  }

  // Handle batch submit
  const handleSubmitBatch = async () => {
    if (batchPreview.length === 0) return
    setSubmitting(true)
    setErrorMsg("")
    try {
      const res = await fetch(`/api/portfolio/${selectedPortfolioId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          batch: batchPreview.map((item) => ({
            ticker: item.ticker,
            action: item.action,
            quantity: item.quantity,
            price: item.price,
            fee: item.fee,
            transaction_date: item.date,
          })),
        }),
      })

      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "Nhập hàng loạt thất bại.")
        return
      }

      onSuccess()
    } catch {
      setErrorMsg("Lỗi kết nối khi nhập hàng loạt.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border-[var(--color-border)] bg-[#0b0f13] text-foreground p-0 overflow-hidden">
        {/* Header with Main Tabs */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3.5 bg-[#0e1419]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-lg bg-black/40 p-1 border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setMainTab("trade")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  mainTab === "trade"
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : "text-[var(--color-muted-2)] hover:text-white",
                )}
              >
                <Layers className="h-3.5 w-3.5" />
                Giao dịch
              </button>
              <button
                type="button"
                onClick={() => setMainTab("dividend")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  mainTab === "dividend"
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : "text-[var(--color-muted-2)] hover:text-white",
                )}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Cổ tức & Quyền
              </button>
            </div>

            {mainTab === "trade" && (
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setTradeSubTab("single")}
                  className={cn(
                    "px-2.5 py-1 rounded transition-colors text-xs font-medium",
                    tradeSubTab === "single"
                      ? "text-white underline underline-offset-4 decoration-purple-400 font-bold"
                      : "text-[var(--color-muted-2)] hover:text-white",
                  )}
                >
                  Nhập đơn lẻ
                </button>
                <span className="text-[var(--color-border)]">|</span>
                <button
                  type="button"
                  onClick={() => setTradeSubTab("batch")}
                  className={cn(
                    "px-2.5 py-1 rounded transition-colors text-xs font-medium",
                    tradeSubTab === "batch"
                      ? "text-white underline underline-offset-4 decoration-purple-400 font-bold"
                      : "text-[var(--color-muted-2)] hover:text-white",
                  )}
                >
                  Nhập hàng loạt
                </button>
              </div>
            )}
          </div>

          <DialogTitle className="text-sm font-semibold text-white">Thêm giao dịch</DialogTitle>
        </div>

        {/* ── 1. TRADE TAB: SINGLE ENTRY ── */}
        {mainTab === "trade" && tradeSubTab === "single" && (
          <form onSubmit={handleSubmitSingle} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Nhập thông tin giao dịch */}
              <div className="space-y-3.5">
                <div className="border-b border-[var(--color-border)] pb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-2)]">
                    Nhập thông tin giao dịch
                  </h3>
                </div>

                {/* Loại giao dịch & Danh mục */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Loại giao dịch <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Select
                      value={action}
                      onValueChange={(v) => {
                        if (v) setAction(v as TransactionAction)
                      }}
                    >
                      <SelectTrigger className="w-full border-[var(--color-border)] bg-cell text-xs font-ticker font-semibold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                        <SelectItem value="buy" className="text-xs text-[var(--color-up)] font-bold">
                          Mua (Buy)
                        </SelectItem>
                        <SelectItem value="sell" className="text-xs text-[var(--color-down)] font-bold">
                          Bán (Sell)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Danh mục <span className="text-[var(--color-down)]">*</span>
                    </label>
                    {portfolios.length > 0 ? (
                      <Select
                        value={selectedPortfolioId}
                        onValueChange={(v) => {
                          if (v) setSelectedPortfolioId(v)
                        }}
                      >
                        <SelectTrigger className="w-full border-[var(--color-border)] bg-cell text-xs font-ticker">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                          {portfolios.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value="Danh mục chính" disabled className="text-xs font-ticker" />
                    )}
                  </div>
                </div>

                {/* Ngày & Mã CK */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Ngày giao dịch <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Input
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      className="font-ticker text-xs"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Mã CK <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Input
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      placeholder="VD: HPG, VCB"
                      maxLength={12}
                      className="font-ticker uppercase text-xs font-bold"
                      required
                    />
                  </div>
                </div>

                {/* Khối lượng & Giá */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Khối lượng <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Input
                      type="number"
                      step="any"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="VD: 1000"
                      className="font-ticker text-xs tabular-nums"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Giá thực hiện (Nghìn đồng) <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="VD: 22.25"
                      className="font-ticker text-xs tabular-nums font-bold"
                      required
                    />
                  </div>
                </div>

                {/* Phí % và Tổng phí */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Phí (%)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={feeRate}
                      onChange={(e) => setFeeRate(e.target.value)}
                      placeholder="0.15"
                      className="font-ticker text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Phí & Thuế (k₫)
                    </label>
                    <Input
                      type="number"
                      step="any"
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      placeholder="0"
                      className="font-ticker text-xs tabular-nums"
                    />
                  </div>
                </div>

                {/* Tags: Thiết lập & Sai lầm (KFSP Feature) */}
                <div className="space-y-2 pt-1 border-t border-[var(--color-border)]">
                  {/* Setup tags */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[var(--color-muted-2)]">Thiết lập (Setup)</span>
                      <button
                        type="button"
                        onClick={() => setShowSetupPicker((o) => !o)}
                        className="flex items-center gap-1 rounded bg-purple-500/20 px-2 py-0.5 text-[11px] font-semibold text-purple-300 hover:bg-purple-500/30 transition-colors"
                      >
                        <Plus className="h-3 w-3" /> Chọn thẻ tags
                      </button>
                    </div>
                    {setupTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {setupTags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-semibold text-purple-300 border border-purple-500/30"
                          >
                            {t}
                            <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => toggleSetupTag(t)} />
                          </span>
                        ))}
                      </div>
                    )}
                    {showSetupPicker && (
                      <div className="mt-2 p-2 rounded-lg border border-[var(--color-border)] bg-[#0f1419] space-y-1.5 shadow-xl">
                        <div className="flex flex-wrap gap-1">
                          {PRESET_SETUP_TAGS.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleSetupTag(tag)}
                              className={cn(
                                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                                setupTags.includes(tag)
                                  ? "bg-purple-500 text-white font-bold"
                                  : "bg-white/5 text-[var(--color-muted-2)] hover:text-white",
                              )}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1 pt-1">
                          <Input
                            size={1}
                            value={customTagInput}
                            onChange={(e) => setCustomTagInput(e.target.value)}
                            placeholder="Tag tự tạo..."
                            className="h-6 text-[11px]"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault()
                                handleAddCustomTag("setup")
                              }
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={() => handleAddCustomTag("setup")}
                          >
                            Thêm
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mistake tags */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[var(--color-muted-2)]">Sai lầm (Mistake)</span>
                      <button
                        type="button"
                        onClick={() => setShowMistakePicker((o) => !o)}
                        className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/30 transition-colors"
                      >
                        <Plus className="h-3 w-3" /> Chọn thẻ tags
                      </button>
                    </div>
                    {mistakeTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {mistakeTags.map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300 border border-rose-500/30"
                          >
                            {t}
                            <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => toggleMistakeTag(t)} />
                          </span>
                        ))}
                      </div>
                    )}
                    {showMistakePicker && (
                      <div className="mt-2 p-2 rounded-lg border border-[var(--color-border)] bg-[#0f1419] space-y-1.5 shadow-xl">
                        <div className="flex flex-wrap gap-1">
                          {PRESET_MISTAKE_TAGS.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleMistakeTag(tag)}
                              className={cn(
                                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                                mistakeTags.includes(tag)
                                  ? "bg-rose-500 text-white font-bold"
                                  : "bg-white/5 text-[var(--color-muted-2)] hover:text-white",
                              )}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Biểu đồ giá mục tiêu - cắt lỗ */}
              <div className="space-y-3.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-2)]">
                      Biểu đồ giá mục tiêu - cắt lỗ
                    </h3>
                    {rrRatio && (
                      <span className="font-ticker text-xs font-bold text-[var(--color-up)] bg-[var(--color-up)]/10 px-2 py-0.5 rounded border border-[var(--color-up)]/30">
                        R:R = 1 : {rrRatio.ratio} (+{rrRatio.targetGainPct}% / -{rrRatio.slLossPct}%)
                      </span>
                    )}
                  </div>

                  {/* Visual Chart Box */}
                  <div className="h-44 rounded-xl border border-[var(--color-border)] bg-[#090d11] p-2 relative overflow-hidden flex flex-col justify-end">
                    {loadingChart ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-2)]" />
                      </div>
                    ) : chartBars.length > 0 ? (
                      <TargetStoplossChart
                        bars={chartBars}
                        buyPrice={parseFloat(price)}
                        targetPrice1={parseFloat(targetPrice1)}
                        targetPrice2={parseFloat(targetPrice2)}
                        targetPrice3={parseFloat(targetPrice3)}
                        stopLoss1={parseFloat(stopLoss1)}
                        stopLoss2={parseFloat(stopLoss2)}
                        stopLoss3={parseFloat(stopLoss3)}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 text-xs text-[var(--color-muted-2)]">
                        <span>Nhập mã cổ phiếu (VD: HPG, VCB) để xem biểu đồ giá và các đường Mục tiêu / Cắt lỗ trực quan.</span>
                      </div>
                    )}
                  </div>

                  {/* Target and StopLoss inputs 1, 2, 3 */}
                  <div className="space-y-2 mt-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--color-up)]">
                          Giá mục tiêu 1 (k₫)
                        </label>
                        <Input
                          type="number"
                          step="any"
                          value={targetPrice1}
                          onChange={(e) => setTargetPrice1(e.target.value)}
                          placeholder="VD: 30.0"
                          className="font-ticker text-xs font-semibold border-[var(--color-up)]/30 focus:border-[var(--color-up)]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--color-down)]">
                          Giá cắt lỗ 1 (k₫)
                        </label>
                        <Input
                          type="number"
                          step="any"
                          value={stopLoss1}
                          onChange={(e) => setStopLoss1(e.target.value)}
                          placeholder="VD: 20.5"
                          className="font-ticker text-xs font-semibold border-[var(--color-down)]/30 focus:border-[var(--color-down)]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">
                          Giá mục tiêu 2 (k₫)
                        </label>
                        <Input
                          type="number"
                          step="any"
                          value={targetPrice2}
                          onChange={(e) => setTargetPrice2(e.target.value)}
                          placeholder="0"
                          className="font-ticker text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">
                          Giá cắt lỗ 2 (k₫)
                        </label>
                        <Input
                          type="number"
                          step="any"
                          value={stopLoss2}
                          onChange={(e) => setStopLoss2(e.target.value)}
                          placeholder="0"
                          className="font-ticker text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">
                          Giá mục tiêu 3 (k₫)
                        </label>
                        <Input
                          type="number"
                          step="any"
                          value={targetPrice3}
                          onChange={(e) => setTargetPrice3(e.target.value)}
                          placeholder="0"
                          className="font-ticker text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-[var(--color-muted-2)]">
                          Giá cắt lỗ 3 (k₫)
                        </label>
                        <Input
                          type="number"
                          step="any"
                          value={stopLoss3}
                          onChange={(e) => setStopLoss3(e.target.value)}
                          placeholder="0"
                          className="font-ticker text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Note textarea */}
                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">Ghi chú</label>
                    <textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Ghi lại lý do vào lệnh, bối cảnh thị trường, kế hoạch đi lệnh..."
                      className="w-full rounded-md border border-[var(--color-border)] bg-cell px-3 py-1.5 text-xs text-foreground placeholder:text-[var(--color-muted)] focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {errorMsg && <p className="mt-3 text-xs font-medium text-[var(--color-down)]">{errorMsg}</p>}

            {/* Footer */}
            <div className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
                Hủy
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="gap-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs px-5 shadow-[0_0_15px_rgba(147,51,234,0.3)]"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang lưu...
                  </>
                ) : (
                  "Lưu giao dịch"
                )}
              </Button>
            </div>
          </form>
        )}

        {/* ── 2. TRADE TAB: BATCH ENTRY ── */}
        {mainTab === "trade" && tradeSubTab === "batch" && (
          <div className="p-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--color-muted-2)]">
                Dán dữ liệu giao dịch (Định dạng: <code className="text-purple-300">Mã, Mua/Bán, Khối lượng, Giá, Ngày(YYYY-MM-DD), Phí</code>)
              </label>
              <textarea
                rows={5}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={"HPG, Mua, 1000, 22.25, 2026-08-01, 33\nVCB, Mua, 500, 85.0, 2026-08-10, 60\nFPT, Ban, 200, 135.0, 2026-08-15, 40"}
                className="w-full font-mono text-xs rounded-lg border border-[var(--color-border)] bg-black/40 p-3 text-foreground placeholder:text-[var(--color-muted)] focus:outline-none"
              />
              <Button type="button" size="sm" variant="outline" onClick={handleParseBatch} className="mt-2 text-xs">
                Xem trước ({batchPreview.length} dòng hợp lệ)
              </Button>
            </div>

            {batchPreview.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[#090d11]">
                <table className="w-full text-left text-xs font-ticker">
                  <thead className="border-b border-[var(--color-border)] text-[var(--color-muted-2)] bg-black/20">
                    <tr>
                      <th className="p-2">Mã</th>
                      <th className="p-2">Loại</th>
                      <th className="p-2 text-right">Khối lượng</th>
                      <th className="p-2 text-right">Giá</th>
                      <th className="p-2">Ngày</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchPreview.map((item, idx) => (
                      <tr key={idx} className="border-b border-white/5 last:border-0">
                        <td className="p-2 font-bold uppercase">{item.ticker}</td>
                        <td className="p-2">{item.action === "buy" ? "Mua" : "Bán"}</td>
                        <td className="p-2 text-right">{item.quantity.toLocaleString("vi-VN")}</td>
                        <td className="p-2 text-right">{item.price}</td>
                        <td className="p-2">{item.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {errorMsg && <p className="text-xs font-medium text-[var(--color-down)]">{errorMsg}</p>}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSubmitBatch}
                disabled={submitting || batchPreview.length === 0}
                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs"
              >
                {submitting ? "Đang lưu..." : `Lưu tất cả (${batchPreview.length} GD)`}
              </Button>
            </div>
          </div>
        )}

        {/* ── 3. DIVIDEND & RIGHTS TAB (Screenshot 3) ── */}
        {mainTab === "dividend" && (
          <form onSubmit={handleSubmitDividend} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-3.5">
                <div className="border-b border-[var(--color-border)] pb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-2)]">
                    Nhập thông tin cổ tức & quyền
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Loại giao dịch <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Select
                      value={dividendAction}
                      onValueChange={(v) => {
                        if (v) setDividendAction(v as typeof dividendAction)
                      }}
                    >
                      <SelectTrigger className="w-full border-[var(--color-border)] bg-cell text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                        <SelectItem value="dividend_cash" className="text-xs">
                          Cổ tức tiền mặt
                        </SelectItem>
                        <SelectItem value="dividend_stock" className="text-xs">
                          Cổ tức cổ phiếu
                        </SelectItem>
                        <SelectItem value="rights" className="text-xs">
                          Quyền mua
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Danh mục <span className="text-[var(--color-down)]">*</span>
                    </label>
                    {portfolios.length > 0 ? (
                      <Select
                        value={selectedPortfolioId}
                        onValueChange={(v) => {
                          if (v) setSelectedPortfolioId(v)
                        }}
                      >
                        <SelectTrigger className="w-full border-[var(--color-border)] bg-cell text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                          {portfolios.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value="Danh mục chính" disabled className="text-xs" />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Mã CK <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Input
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      placeholder="VD: HPG"
                      className="font-ticker uppercase text-xs font-bold"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Ngày chốt quyền <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Input
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      className="font-ticker text-xs"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      Số lượng CP nhận <span className="text-[var(--color-down)]">*</span>
                    </label>
                    <Input
                      type="number"
                      step="any"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="1000"
                      className="font-ticker text-xs"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                      {dividendAction === "dividend_cash"
                        ? "Tiền / CP (nghìn VNĐ)"
                        : dividendAction === "rights"
                        ? "Giá phát hành (k₫)"
                        : "Giá vốn (=0)"}
                    </label>
                    <Input
                      type="number"
                      step="any"
                      value={dividendAction === "dividend_stock" ? "0" : dividendRate}
                      disabled={dividendAction === "dividend_stock"}
                      onChange={(e) => setDividendRate(e.target.value)}
                      placeholder="1.5"
                      className="font-ticker text-xs"
                    />
                  </div>
                </div>

                {dividendAction === "dividend_cash" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                        Thuế TNCN (%)
                      </label>
                      <Input
                        type="number"
                        value={dividendTaxPct}
                        onChange={(e) => setDividendTaxPct(e.target.value)}
                        className="font-ticker text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                        Tổng tiền nhận (k₫)
                      </label>
                      <div className="font-ticker text-sm font-bold text-[var(--color-up)] py-1.5">
                        {((parseFloat(quantity || "0") * parseFloat(dividendRate || "0") * (1 - parseFloat(dividendTaxPct || "5") / 100))).toFixed(1)} k₫
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Dividend Summary */}
              <div className="space-y-3.5 flex flex-col justify-between">
                <div>
                  <div className="border-b border-[var(--color-border)] pb-2 mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-2)]">
                      Quy tắc điều chỉnh giá vốn
                    </h3>
                  </div>

                  <div className="rounded-xl border border-[var(--color-border)] bg-[#090d11] p-4 text-xs space-y-2.5 leading-relaxed text-[var(--color-muted-2)]">
                    <p>
                      <strong className="text-white">💰 Cổ tức tiền mặt:</strong> Được trừ trực tiếp vào giá vốn bình quân của vị thế, giúp hạ điểm hòa vốn.
                    </p>
                    <p>
                      <strong className="text-white">📈 Cổ tức cổ phiếu:</strong> Tăng số lượng cổ phiếu nắm giữ với chi phí 0đ, tự động pha loãng làm giảm giá vốn trung bình mỗi cổ phiếu.
                    </p>
                    <p>
                      <strong className="text-white">🏷️ Quyền mua ưu đãi:</strong> Tính như một đợt mua mới với giá ưu đãi, làm cập nhật lại giá vốn bình quân theo tỷ trọng mới.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {errorMsg && <p className="mt-3 text-xs font-medium text-[var(--color-down)]">{errorMsg}</p>}

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs px-5"
              >
                {submitting ? "Đang lưu..." : "Lưu quyền & Cổ tức"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────
// Mini Target / Stoploss Chart (SVG)
// ─────────────────────────────────────────────────────────────

interface TargetStoplossChartProps {
  bars: BarData[]
  buyPrice?: number
  targetPrice1?: number
  targetPrice2?: number
  targetPrice3?: number
  stopLoss1?: number
  stopLoss2?: number
  stopLoss3?: number
}

const TargetStoplossChart = memo(function TargetStoplossChart({
  bars,
  buyPrice,
  targetPrice1,
  targetPrice2,
  targetPrice3,
  stopLoss1,
  stopLoss2,
  stopLoss3,
}: TargetStoplossChartProps) {
  if (bars.length < 2) return null

  const width = 420
  const height = 150
  const padding = { top: 18, bottom: 24, left: 35, right: 80 }

  // Compute domain
  const closePrices = bars.map((b) => b.close)
  let minP = Math.min(...closePrices)
  let maxP = Math.max(...closePrices)

  const activePrices = [buyPrice, targetPrice1, targetPrice2, targetPrice3, stopLoss1, stopLoss2, stopLoss3].filter(
    (p): p is number => p != null && Number.isFinite(p) && p > 0,
  )

  if (activePrices.length > 0) {
    minP = Math.min(minP, ...activePrices)
    maxP = Math.max(maxP, ...activePrices)
  }

  // Padding domain
  const range = maxP - minP || 1
  minP = Math.max(0, minP - range * 0.08)
  maxP = maxP + range * 0.08

  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const getX = (idx: number) => padding.left + (idx / (bars.length - 1)) * chartW
  const getY = (val: number) => padding.top + chartH - ((val - minP) / (maxP - minP)) * chartH

  // Price line path
  const linePoints = bars.map((b, idx) => `${getX(idx).toFixed(1)},${getY(b.close).toFixed(1)}`).join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full select-none overflow-visible">
      {/* Horizontal grid lines */}
      <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="#ffffff" strokeOpacity={0.06} />
      <line x1={padding.left} y1={padding.top + chartH / 2} x2={width - padding.right} y2={padding.top + chartH / 2} stroke="#ffffff" strokeOpacity={0.06} />
      <line x1={padding.left} y1={padding.top + chartH} x2={width - padding.right} y2={padding.top + chartH} stroke="#ffffff" strokeOpacity={0.06} />

      {/* Historical Price Line */}
      <polyline fill="none" stroke="#3b82f6" strokeWidth={1.8} points={linePoints} />

      {/* Target Lines (Green) */}
      {targetPrice1 != null && targetPrice1 > 0 && (
        <g>
          <line
            x1={padding.left}
            y1={getY(targetPrice1)}
            x2={width - padding.right}
            y2={getY(targetPrice1)}
            stroke="var(--color-up)"
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
          <text
            x={width - padding.right + 4}
            y={getY(targetPrice1) + 3}
            fill="var(--color-up)"
            fontSize="9"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            Mục tiêu 1: {targetPrice1}
          </text>
        </g>
      )}

      {/* Buy Price Line (Orange) */}
      {buyPrice != null && buyPrice > 0 && (
        <g>
          <line
            x1={padding.left}
            y1={getY(buyPrice)}
            x2={width - padding.right}
            y2={getY(buyPrice)}
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
          <text
            x={width - padding.right + 4}
            y={getY(buyPrice) + 3}
            fill="#f59e0b"
            fontSize="9"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            Mua: {buyPrice}
          </text>
        </g>
      )}

      {/* Stop Loss Lines (Red) */}
      {stopLoss1 != null && stopLoss1 > 0 && (
        <g>
          <line
            x1={padding.left}
            y1={getY(stopLoss1)}
            x2={width - padding.right}
            y2={getY(stopLoss1)}
            stroke="var(--color-down)"
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
          <text
            x={width - padding.right + 4}
            y={getY(stopLoss1) + 3}
            fill="var(--color-down)"
            fontSize="9"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            Cắt lỗ 1: {stopLoss1}
          </text>
        </g>
      )}

      {/* Date Range on X Axis */}
      <text x={padding.left} y={height - 6} fill="#8a9ba7" fontSize="8" fontFamily="sans-serif">
        {bars[0].date}
      </text>
      <text x={width - padding.right - 45} y={height - 6} fill="#8a9ba7" fontSize="8" fontFamily="sans-serif">
        {bars[bars.length - 1].date}
      </text>
    </svg>
  )
})
