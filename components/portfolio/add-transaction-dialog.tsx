"use client"

import React, { memo, useCallback, useEffect, useMemo, useState, type ComponentType } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  CalendarDays,
  Hash,
  Layers,
  Loader2,
  Plus,
  ReceiptText,
  ShieldAlert,
  StickyNote,
  Tag,
  Target,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
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
import { cn } from "@/modules/shared/ui/cn"

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
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(portfolioId)

  const [action, setAction] = useState<TransactionAction>("buy")
  const [ticker, setTicker] = useState(initialTicker)
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().split("T")[0])
  const [quantity, setQuantity] = useState("")
  const [price, setPrice] = useState("")
  const [feeRate, setFeeRate] = useState("0.15")
  const [fee, setFee] = useState("0")

  const [targetPrice1, setTargetPrice1] = useState("")
  const [targetPrice2, setTargetPrice2] = useState("")
  const [targetPrice3, setTargetPrice3] = useState("")
  const [stopLoss1, setStopLoss1] = useState("")
  const [stopLoss2, setStopLoss2] = useState("")
  const [stopLoss3, setStopLoss3] = useState("")

  const [setupTags, setSetupTags] = useState<string[]>([])
  const [mistakeTags, setMistakeTags] = useState<string[]>([])
  const [showSetupPicker, setShowSetupPicker] = useState(false)
  const [showMistakePicker, setShowMistakePicker] = useState(false)
  const [customTagInput, setCustomTagInput] = useState("")
  const [note, setNote] = useState("")

  const [dividendAction, setDividendAction] = useState<"dividend_cash" | "dividend_stock" | "rights">("dividend_cash")
  const [dividendRate, setDividendRate] = useState("")
  const [dividendTaxPct, setDividendTaxPct] = useState("5")

  const [batchText, setBatchText] = useState("")
  const [batchPreview, setBatchPreview] = useState<
    Array<{ ticker: string; action: string; quantity: number; price: number; date: string; fee: number }>
  >([])

  const [chartBars, setChartBars] = useState<BarData[]>([])
  const [loadingChart, setLoadingChart] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")

  useEffect(() => {
    if (!open) return
    setSelectedPortfolioId(portfolioId)
    if (initialTicker) setTicker(initialTicker)
    setErrorMsg("")
  }, [open, portfolioId, initialTicker])

  useEffect(() => {
    const p = parseFloat(price)
    const q = parseFloat(quantity)
    const rate = parseFloat(feeRate)
    if (!Number.isNaN(p) && !Number.isNaN(q) && !Number.isNaN(rate) && p > 0 && q > 0) {
      setFee((p * q * (rate / 100)).toFixed(2))
    }
  }, [price, quantity, feeRate])

  useEffect(() => {
    const cleanTicker = ticker.trim().toUpperCase()
    if (!cleanTicker || cleanTicker.length < 3) {
      setChartBars([])
      return
    }

    const timer = setTimeout(() => {
      setLoadingChart(true)
      fetch(`/api/market/ticker-bars?ticker=${cleanTicker}`, { cache: "no-store", credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { ok: boolean; bars?: BarData[] } | null) => {
          setChartBars(data?.ok && data.bars ? data.bars : [])
        })
        .catch(() => setChartBars([]))
        .finally(() => setLoadingChart(false))
    }, 400)

    return () => clearTimeout(timer)
  }, [ticker])

  const rrRatio = useMemo(() => {
    const buyPrice = parseFloat(price)
    const target = parseFloat(targetPrice1)
    const stop = parseFloat(stopLoss1)
    if (Number.isNaN(buyPrice) || buyPrice <= 0) return null
    if (Number.isNaN(target) || Number.isNaN(stop) || target <= buyPrice || stop >= buyPrice) return null
    const reward = target - buyPrice
    const risk = buyPrice - stop
    if (risk <= 0) return null
    return {
      ratio: (reward / risk).toFixed(1),
      targetGainPct: (((target - buyPrice) / buyPrice) * 100).toFixed(1),
      slLossPct: (((buyPrice - stop) / buyPrice) * 100).toFixed(1),
    }
  }, [price, targetPrice1, stopLoss1])

  const handleParseBatch = useCallback(() => {
    const parsed: typeof batchPreview = []
    for (const line of batchText.split("\n").filter((item) => item.trim())) {
      const parts = line.split(/[,\t|;]/).map((part) => part.trim())
      if (parts.length < 4) continue
      const [t, a, q, p, d, f] = parts
      const tickerStr = t.toUpperCase()
      const act = a.toLowerCase() === "ban" || a.toLowerCase() === "sell" ? "sell" : "buy"
      const qtyNum = parseFloat(q)
      const priceNum = parseFloat(p)
      const dateStr = d || new Date().toISOString().split("T")[0]
      const feeNum = f ? parseFloat(f) : priceNum * qtyNum * 0.0015
      if (!tickerStr || Number.isNaN(qtyNum) || Number.isNaN(priceNum)) continue
      parsed.push({
        ticker: tickerStr,
        action: act,
        quantity: qtyNum,
        price: priceNum,
        date: dateStr,
        fee: Number.isNaN(feeNum) ? 0 : feeNum,
      })
    }
    setBatchPreview(parsed)
  }, [batchText])

  const toggleSetupTag = (tag: string) => {
    setSetupTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])
  }

  const toggleMistakeTag = (tag: string) => {
    setMistakeTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])
  }

  const handleAddCustomTag = (type: "setup" | "mistake") => {
    const value = customTagInput.trim()
    if (!value) return
    if (type === "setup") toggleSetupTag(value)
    else toggleMistakeTag(value)
    setCustomTagInput("")
  }

  const handleSubmitSingle = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMsg("")

    const cleanTicker = ticker.trim().toUpperCase()
    if (!cleanTicker) {
      setErrorMsg("Vui lòng nhập mã cổ phiếu.")
      return
    }
    const parsedQty = parseFloat(quantity)
    if (Number.isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg("Khối lượng phải là số dương.")
      return
    }
    const parsedPrice = parseFloat(price)
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setErrorMsg("Giá không hợp lệ.")
      return
    }

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
          fee: parseFloat(fee || "0"),
          fee_rate: parseFloat(feeRate || "0.15"),
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

  const handleSubmitDividend = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMsg("")

    const cleanTicker = ticker.trim().toUpperCase()
    if (!cleanTicker) {
      setErrorMsg("Vui lòng nhập mã cổ phiếu.")
      return
    }
    const parsedQty = parseFloat(quantity)
    if (Number.isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg("Khối lượng phải là số dương.")
      return
    }
    const parsedRate = parseFloat(dividendRate)
    if (dividendAction !== "dividend_stock" && (Number.isNaN(parsedRate) || parsedRate < 0)) {
      setErrorMsg("Giá trị cổ tức không hợp lệ.")
      return
    }

    const taxPct = parseFloat(dividendTaxPct || "5")
    const calculatedFee = dividendAction === "dividend_cash"
      ? (parsedQty * parsedRate * (taxPct / 100)).toFixed(2)
      : "0"

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
      <DialogContent className="max-h-[94vh] w-[calc(100vw-1rem)] max-w-6xl overflow-hidden border-[var(--color-border)] bg-[#0b0f13] p-0 text-foreground sm:w-[calc(100vw-2rem)] sm:max-w-6xl">
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[#0e1419] px-4 py-3 pr-12 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="flex w-fit max-w-full items-center gap-1 rounded-xl border border-[var(--color-border)] bg-black/35 p-1">
              <TabButton active={mainTab === "trade"} onClick={() => setMainTab("trade")} icon={Layers}>
                Giao dịch
              </TabButton>
              <TabButton active={mainTab === "dividend"} onClick={() => setMainTab("dividend")} icon={TrendingUp}>
                Cổ tức & Quyền
              </TabButton>
            </div>

            {mainTab === "trade" && (
              <div className="flex items-center gap-1 overflow-x-auto text-sm">
                <SubTabButton active={tradeSubTab === "single"} onClick={() => setTradeSubTab("single")}>Nhập đơn lẻ</SubTabButton>
                <span className="text-[var(--color-border)]">|</span>
                <SubTabButton active={tradeSubTab === "batch"} onClick={() => setTradeSubTab("batch")}>Nhập hàng loạt</SubTabButton>
              </div>
            )}
          </div>
          <DialogTitle className="hidden shrink-0 text-base font-black text-white xl:block">Thêm giao dịch</DialogTitle>
        </div>

        <div className="max-h-[calc(94vh-4rem)] overflow-y-auto">
          {mainTab === "trade" && tradeSubTab === "single" && (
            <form onSubmit={handleSubmitSingle} className="p-4 sm:p-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="space-y-4 rounded-3xl border border-white/[0.07] bg-white/[0.018] p-4 sm:p-5">
                  <SectionHeading icon={Layers} title="Nhập thông tin giao dịch" subtitle="Ghi nhận dữ kiện khớp lệnh và bằng chứng của quyết định." />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <TradeFieldLabel icon={ArrowUpRight} label="Loại giao dịch" required />
                      <Select value={action} onValueChange={(value) => value && setAction(value as TransactionAction)}>
                        <SelectTrigger className="h-11 w-full border-[var(--color-border)] bg-cell text-sm font-semibold">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                          <SelectItem value="buy" className="text-[var(--color-up)] font-bold">Mua (Buy)</SelectItem>
                          <SelectItem value="sell" className="text-[var(--color-down)] font-bold">Bán (Sell)</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <TradeFieldLabel icon={WalletCards} label="Danh mục" required />
                      {portfolios.length > 0 ? (
                        <Select value={selectedPortfolioId} onValueChange={(value) => value && setSelectedPortfolioId(value)}>
                          <SelectTrigger className="h-11 w-full border-[var(--color-border)] bg-cell text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                            {portfolios.map((portfolio) => (
                              <SelectItem key={portfolio.id} value={portfolio.id}>{portfolio.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value="Danh mục chính" disabled className="h-11" />
                      )}
                    </Field>

                    <Field>
                      <TradeFieldLabel icon={CalendarDays} label="Ngày giao dịch" required />
                      <Input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} className="h-11 font-ticker text-sm" required />
                    </Field>

                    <Field>
                      <TradeFieldLabel icon={Hash} label="Mã cổ phiếu" required />
                      <Input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="VD: MSN, HPG" maxLength={12} className="h-11 font-ticker text-base font-black uppercase" required />
                    </Field>

                    <Field>
                      <TradeFieldLabel icon={Layers} label="Khối lượng" required />
                      <Input type="number" step="any" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="VD: 1.000" className="h-11 font-ticker text-sm tabular-nums" required />
                    </Field>

                    <Field>
                      <TradeFieldLabel icon={BadgeDollarSign} label="Giá thực hiện (k₫)" required />
                      <Input type="number" step="any" min="0" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="VD: 66.5" className="h-11 font-ticker text-base font-bold tabular-nums" required />
                    </Field>

                    <Field>
                      <TradeFieldLabel icon={ReceiptText} label="Phí (%)" />
                      <Input type="number" step="0.01" value={feeRate} onChange={(event) => setFeeRate(event.target.value)} placeholder="0.15" className="h-11 font-ticker text-sm tabular-nums" />
                    </Field>

                    <Field>
                      <TradeFieldLabel icon={ReceiptText} label="Phí & Thuế (k₫)" />
                      <Input type="number" step="any" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0" className="h-11 font-ticker text-sm tabular-nums" />
                    </Field>
                  </div>

                  <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                    <TagPicker
                      icon={Tag}
                      label="Thiết lập (Setup)"
                      tone="setup"
                      open={showSetupPicker}
                      onToggle={() => setShowSetupPicker((current) => !current)}
                      selected={setupTags}
                      presets={PRESET_SETUP_TAGS}
                      onSelect={toggleSetupTag}
                      customTagInput={customTagInput}
                      onCustomTagInput={setCustomTagInput}
                      onAddCustom={() => handleAddCustomTag("setup")}
                    />
                    <TagPicker
                      icon={ShieldAlert}
                      label="Sai lầm (Mistake)"
                      tone="mistake"
                      open={showMistakePicker}
                      onToggle={() => setShowMistakePicker((current) => !current)}
                      selected={mistakeTags}
                      presets={PRESET_MISTAKE_TAGS}
                      onSelect={toggleMistakeTag}
                      customTagInput={customTagInput}
                      onCustomTagInput={setCustomTagInput}
                      onAddCustom={() => handleAddCustomTag("mistake")}
                    />
                  </div>
                </section>

                <section className="space-y-4 rounded-3xl border border-white/[0.07] bg-white/[0.018] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <SectionHeading icon={Target} title="Mục tiêu · Cắt lỗ" subtitle="Đặt các mức kế hoạch trên cùng bối cảnh giá của mã." />
                    {rrRatio && (
                      <span className="rounded-full border border-[var(--color-up)]/25 bg-[var(--color-up)]/10 px-3 py-1 text-xs font-black text-[var(--color-up)]">
                        R:R 1:{rrRatio.ratio} · +{rrRatio.targetGainPct}% / -{rrRatio.slLossPct}%
                      </span>
                    )}
                  </div>

                  <div className="relative flex h-64 flex-col justify-end overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[#090d11] p-3 lg:h-72">
                    {loadingChart ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                        <Loader2 className="h-6 w-6 animate-spin text-purple-300" />
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
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[var(--color-muted-2)]">
                        <TrendingUp className="h-7 w-7 text-purple-300/70" />
                        <span>Nhập mã cổ phiếu để xem đường giá cùng Target / Stop trực quan.</span>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <PriceField icon={Target} label="Giá mục tiêu 1 (k₫)" value={targetPrice1} onChange={setTargetPrice1} tone="up" placeholder="VD: 75" />
                    <PriceField icon={ShieldAlert} label="Giá cắt lỗ 1 (k₫)" value={stopLoss1} onChange={setStopLoss1} tone="down" placeholder="VD: 62" />
                    <PriceField icon={Target} label="Giá mục tiêu 2 (k₫)" value={targetPrice2} onChange={setTargetPrice2} placeholder="0" />
                    <PriceField icon={ShieldAlert} label="Giá cắt lỗ 2 (k₫)" value={stopLoss2} onChange={setStopLoss2} placeholder="0" />
                    <PriceField icon={Target} label="Giá mục tiêu 3 (k₫)" value={targetPrice3} onChange={setTargetPrice3} placeholder="0" />
                    <PriceField icon={ShieldAlert} label="Giá cắt lỗ 3 (k₫)" value={stopLoss3} onChange={setStopLoss3} placeholder="0" />
                  </div>

                  <Field>
                    <TradeFieldLabel icon={StickyNote} label="Ghi chú" />
                    <textarea
                      rows={3}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Ghi lý do vào lệnh, bối cảnh thị trường và kế hoạch xử lý vị thế..."
                      className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-cell px-3.5 py-3 text-sm leading-6 text-foreground placeholder:text-[var(--color-muted)] focus:border-purple-400/40 focus:outline-none"
                    />
                  </Field>
                </section>
              </div>

              {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
              <StickyFooter onCancel={() => onOpenChange(false)} submitting={submitting} submitLabel="Lưu giao dịch" />
            </form>
          )}

          {mainTab === "trade" && tradeSubTab === "batch" && (
            <div className="space-y-5 p-4 sm:p-6">
              <section className="rounded-3xl border border-white/[0.07] bg-white/[0.018] p-4 sm:p-5">
                <SectionHeading icon={Layers} title="Nhập hàng loạt" subtitle="Dán nhiều fills nhưng vẫn giữ nguyên dữ liệu gốc từng giao dịch." />
                <label className="mt-4 block text-sm font-semibold text-slate-300">
                  Định dạng: <code className="text-purple-300">Mã, Mua/Bán, Khối lượng, Giá, Ngày, Phí</code>
                </label>
                <textarea
                  rows={7}
                  value={batchText}
                  onChange={(event) => setBatchText(event.target.value)}
                  placeholder={"HPG, Mua, 1000, 22.25, 2026-08-01, 33\nVCB, Mua, 500, 85.0, 2026-08-10, 60"}
                  className="mt-2 w-full rounded-2xl border border-[var(--color-border)] bg-black/35 p-4 font-mono text-sm text-foreground placeholder:text-[var(--color-muted)] focus:border-purple-400/40 focus:outline-none"
                />
                <Button type="button" variant="outline" onClick={handleParseBatch} className="mt-3 gap-2">
                  <Layers className="h-4 w-4" />
                  Xem trước ({batchPreview.length} dòng hợp lệ)
                </Button>
              </section>

              {batchPreview.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-2xl border border-[var(--color-border)] bg-[#090d11]">
                  <table className="w-full min-w-[640px] text-left text-sm font-ticker">
                    <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[#0d1218] text-[var(--color-muted-2)]">
                      <tr><th className="p-3">Mã</th><th className="p-3">Loại</th><th className="p-3 text-right">Khối lượng</th><th className="p-3 text-right">Giá</th><th className="p-3">Ngày</th></tr>
                    </thead>
                    <tbody>
                      {batchPreview.map((item, index) => (
                        <tr key={`${item.ticker}-${index}`} className="border-b border-white/5 last:border-0">
                          <td className="p-3 font-black uppercase">{item.ticker}</td>
                          <td className="p-3">{item.action === "buy" ? "Mua" : "Bán"}</td>
                          <td className="p-3 text-right tabular-nums">{item.quantity.toLocaleString("vi-VN")}</td>
                          <td className="p-3 text-right tabular-nums">{item.price}</td>
                          <td className="p-3">{item.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
              <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[#0b0f13] px-4 py-4 sm:-mx-6 sm:px-6">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
                <Button type="button" onClick={handleSubmitBatch} disabled={submitting || batchPreview.length === 0} className="bg-gradient-to-r from-purple-600 to-indigo-600 font-bold text-white">
                  {submitting ? "Đang lưu..." : `Lưu tất cả (${batchPreview.length} GD)`}
                </Button>
              </div>
            </div>
          )}

          {mainTab === "dividend" && (
            <form onSubmit={handleSubmitDividend} className="p-4 sm:p-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="space-y-4 rounded-3xl border border-white/[0.07] bg-white/[0.018] p-4 sm:p-5">
                  <SectionHeading icon={TrendingUp} title="Cổ tức & Quyền" subtitle="Ghi nhận sự kiện doanh nghiệp theo đúng dữ kiện thực tế." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <TradeFieldLabel icon={TrendingUp} label="Loại giao dịch" required />
                      <Select value={dividendAction} onValueChange={(value) => value && setDividendAction(value as typeof dividendAction)}>
                        <SelectTrigger className="h-11 w-full border-[var(--color-border)] bg-cell text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                          <SelectItem value="dividend_cash">Cổ tức tiền mặt</SelectItem>
                          <SelectItem value="dividend_stock">Cổ tức cổ phiếu</SelectItem>
                          <SelectItem value="rights">Quyền mua</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <TradeFieldLabel icon={WalletCards} label="Danh mục" required />
                      {portfolios.length > 0 ? (
                        <Select value={selectedPortfolioId} onValueChange={(value) => value && setSelectedPortfolioId(value)}>
                          <SelectTrigger className="h-11 w-full border-[var(--color-border)] bg-cell text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                            {portfolios.map((portfolio) => <SelectItem key={portfolio.id} value={portfolio.id}>{portfolio.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : <Input value="Danh mục chính" disabled className="h-11" />}
                    </Field>
                    <Field>
                      <TradeFieldLabel icon={Hash} label="Mã cổ phiếu" required />
                      <Input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="VD: HPG" className="h-11 font-ticker text-base font-black uppercase" required />
                    </Field>
                    <Field>
                      <TradeFieldLabel icon={CalendarDays} label="Ngày chốt quyền" required />
                      <Input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} className="h-11 font-ticker text-sm" required />
                    </Field>
                    <Field>
                      <TradeFieldLabel icon={Layers} label="Số lượng CP nhận" required />
                      <Input type="number" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="1000" className="h-11 font-ticker text-sm" required />
                    </Field>
                    <Field>
                      <TradeFieldLabel icon={BadgeDollarSign} label={dividendAction === "dividend_cash" ? "Tiền / CP (k₫)" : dividendAction === "rights" ? "Giá phát hành (k₫)" : "Giá vốn (=0)"} />
                      <Input type="number" step="any" value={dividendAction === "dividend_stock" ? "0" : dividendRate} disabled={dividendAction === "dividend_stock"} onChange={(event) => setDividendRate(event.target.value)} placeholder="1.5" className="h-11 font-ticker text-sm" />
                    </Field>
                    {dividendAction === "dividend_cash" && (
                      <>
                        <Field>
                          <TradeFieldLabel icon={ReceiptText} label="Thuế TNCN (%)" />
                          <Input type="number" value={dividendTaxPct} onChange={(event) => setDividendTaxPct(event.target.value)} className="h-11 font-ticker text-sm" />
                        </Field>
                        <div className="rounded-2xl border border-[var(--color-up)]/15 bg-[var(--color-up)]/[0.04] p-4">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tổng tiền nhận</p>
                          <p className="mt-2 font-ticker text-xl font-black text-[var(--color-up)]">
                            {(parseFloat(quantity || "0") * parseFloat(dividendRate || "0") * (1 - parseFloat(dividendTaxPct || "5") / 100)).toFixed(1)} k₫
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/[0.07] bg-white/[0.018] p-4 sm:p-5">
                  <SectionHeading icon={ReceiptText} title="Quy tắc điều chỉnh giá vốn" subtitle="Tóm tắt accounting semantics hiện tại của danh mục." />
                  <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--color-muted-2)]">
                    <RuleCard icon={BadgeDollarSign} title="Cổ tức tiền mặt">Được trừ trực tiếp vào giá vốn bình quân của vị thế, giúp hạ điểm hòa vốn.</RuleCard>
                    <RuleCard icon={TrendingUp} title="Cổ tức cổ phiếu">Tăng số lượng cổ phiếu nắm giữ với chi phí 0, làm cập nhật giá vốn bình quân.</RuleCard>
                    <RuleCard icon={Tag} title="Quyền mua ưu đãi">Tính như một đợt mua mới với giá ưu đãi và cập nhật AVCO theo tỷ trọng mới.</RuleCard>
                  </div>
                </section>
              </div>

              {errorMsg && <ErrorMessage>{errorMsg}</ErrorMessage>}
              <StickyFooter onCancel={() => onOpenChange(false)} submitting={submitting} submitLabel="Lưu quyền & Cổ tức" />
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition-[background-color,border-color,color,transform] duration-150 hover:-translate-y-0.5", active ? "border border-purple-500/35 bg-purple-500/20 text-purple-200" : "border border-transparent text-slate-400 hover:text-white")}>
      <Icon className="h-4 w-4" />{children}
    </button>
  )
}

function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("whitespace-nowrap rounded-lg px-3 py-2 font-bold transition-colors", active ? "bg-white/[0.06] text-white" : "text-slate-500 hover:text-slate-200")}>{children}</button>
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0">{children}</div>
}

function TradeFieldLabel({ icon: Icon, label, required = false, tone = "default" }: { icon: ComponentType<{ className?: string }>; label: string; required?: boolean; tone?: "default" | "up" | "down" }) {
  const toneClass = tone === "up" ? "text-[var(--color-up)]" : tone === "down" ? "text-[var(--color-down)]" : "text-slate-400"
  return (
    <label className={cn("mb-1.5 flex min-h-5 items-center gap-2 text-sm font-semibold", toneClass)}>
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <span>{label}</span>
      {required && <span className="text-[var(--color-down)]">*</span>}
    </label>
  )
}

function SectionHeading({ icon: Icon, title, subtitle }: { icon: ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-border)] pb-3">
      <span className="rounded-xl border border-purple-400/20 bg-purple-400/[0.08] p-2 text-purple-300"><Icon className="h-5 w-5" /></span>
      <div><h3 className="text-sm font-black uppercase tracking-[0.08em] text-white">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p></div>
    </div>
  )
}

function PriceField({ icon, label, value, onChange, placeholder, tone = "default" }: { icon: ComponentType<{ className?: string }>; label: string; value: string; onChange: (value: string) => void; placeholder: string; tone?: "default" | "up" | "down" }) {
  return (
    <Field>
      <TradeFieldLabel icon={icon} label={label} tone={tone} />
      <Input type="number" step="any" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={cn("h-11 font-ticker text-sm font-semibold", tone === "up" && "border-[var(--color-up)]/30", tone === "down" && "border-[var(--color-down)]/30")} />
    </Field>
  )
}

function TagPicker({ icon, label, tone, open, onToggle, selected, presets, onSelect, customTagInput, onCustomTagInput, onAddCustom }: { icon: ComponentType<{ className?: string }>; label: string; tone: "setup" | "mistake"; open: boolean; onToggle: () => void; selected: string[]; presets: string[]; onSelect: (tag: string) => void; customTagInput: string; onCustomTagInput: (value: string) => void; onAddCustom: () => void }) {
  const setup = tone === "setup"
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TradeFieldLabel icon={icon} label={label} />
        <button type="button" onClick={onToggle} className={cn("flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors", setup ? "border-purple-400/20 bg-purple-400/[0.08] text-purple-200 hover:bg-purple-400/[0.14]" : "border-rose-400/20 bg-rose-400/[0.08] text-rose-200 hover:bg-rose-400/[0.14]")}><Plus className="h-3.5 w-3.5" /> Chọn tags</button>
      </div>
      {selected.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{selected.map((tag) => <button key={tag} type="button" onClick={() => onSelect(tag)} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold", setup ? "border-purple-400/25 bg-purple-400/10 text-purple-200" : "border-rose-400/25 bg-rose-400/10 text-rose-200")}>{tag}<X className="h-3 w-3" /></button>)}</div>}
      {open && (
        <div className="mt-2 space-y-2 rounded-2xl border border-[var(--color-border)] bg-[#0f1419] p-3 shadow-xl">
          <div className="flex flex-wrap gap-1.5">{presets.map((tag) => <button key={tag} type="button" onClick={() => onSelect(tag)} className={cn("rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors", selected.includes(tag) ? (setup ? "bg-purple-500 text-white" : "bg-rose-500 text-white") : "bg-white/5 text-slate-400 hover:text-white")}>{tag}</button>)}</div>
          {setup && <div className="flex gap-2"><Input value={customTagInput} onChange={(event) => onCustomTagInput(event.target.value)} placeholder="Tag tự tạo..." className="h-9 text-sm" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAddCustom() } }} /><Button type="button" size="sm" onClick={onAddCustom}>Thêm</Button></div>}
        </div>
      )}
    </div>
  )
}

function StickyFooter({ onCancel, submitting, submitLabel }: { onCancel: () => void; submitting: boolean; submitLabel: string }) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[#0b0f13] px-4 py-4 sm:-mx-6 sm:px-6">
      <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Hủy</Button>
      <Button type="submit" disabled={submitting} className="min-w-36 gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 font-black text-white shadow-[0_0_18px_rgba(147,51,234,0.28)] hover:from-purple-500 hover:to-indigo-500">{submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Đang lưu...</> : submitLabel}</Button>
    </div>
  )
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 rounded-xl border border-[var(--color-down)]/20 bg-[var(--color-down)]/[0.06] px-3 py-2 text-sm font-semibold text-[var(--color-down)]">{children}</p>
}

function RuleCard({ icon: Icon, title, children }: { icon: ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return <div className="flex gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-purple-300" /><div><p className="font-bold text-white">{title}</p><p className="mt-1">{children}</p></div></div>
}

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

const TargetStoplossChart = memo(function TargetStoplossChart({ bars, buyPrice, targetPrice1, targetPrice2, targetPrice3, stopLoss1, stopLoss2, stopLoss3 }: TargetStoplossChartProps) {
  if (bars.length < 2) return null

  const width = 560
  const height = 220
  const padding = { top: 20, bottom: 26, left: 42, right: 100 }
  const closePrices = bars.map((bar) => bar.close)
  const targets = [targetPrice1, targetPrice2, targetPrice3].filter((value): value is number => value != null && Number.isFinite(value) && value > 0)
  const stops = [stopLoss1, stopLoss2, stopLoss3].filter((value): value is number => value != null && Number.isFinite(value) && value > 0)
  const activePrices = [buyPrice, ...targets, ...stops].filter((value): value is number => value != null && Number.isFinite(value) && value > 0)

  let minPrice = Math.min(...closePrices, ...(activePrices.length ? activePrices : closePrices))
  let maxPrice = Math.max(...closePrices, ...(activePrices.length ? activePrices : closePrices))
  const range = maxPrice - minPrice || 1
  minPrice = Math.max(0, minPrice - range * 0.08)
  maxPrice += range * 0.08

  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const getX = (index: number) => padding.left + (index / (bars.length - 1)) * chartWidth
  const getY = (value: number) => padding.top + chartHeight - ((value - minPrice) / (maxPrice - minPrice)) * chartHeight
  const linePoints = bars.map((bar, index) => `${getX(index).toFixed(1)},${getY(bar.close).toFixed(1)}`).join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full select-none overflow-visible" role="img" aria-label="Biểu đồ giá với mục tiêu và cắt lỗ">
      {[0, 0.5, 1].map((fraction) => <line key={fraction} x1={padding.left} y1={padding.top + chartHeight * fraction} x2={width - padding.right} y2={padding.top + chartHeight * fraction} stroke="#ffffff" strokeOpacity={0.06} />)}
      <polyline fill="none" stroke="#3b82f6" strokeWidth={2} points={linePoints} />
      {targets.map((value, index) => <LevelLine key={`target-${index}`} value={value} label={`Mục tiêu ${index + 1}`} color="var(--color-up)" getY={getY} padding={padding} width={width} />)}
      {buyPrice != null && Number.isFinite(buyPrice) && buyPrice > 0 && <LevelLine value={buyPrice} label="Giá vào" color="#f59e0b" getY={getY} padding={padding} width={width} />}
      {stops.map((value, index) => <LevelLine key={`stop-${index}`} value={value} label={`Cắt lỗ ${index + 1}`} color="var(--color-down)" getY={getY} padding={padding} width={width} />)}
      <text x={padding.left} y={height - 7} fill="#8a9ba7" fontSize="9">{bars[0].date}</text>
      <text x={width - padding.right - 52} y={height - 7} fill="#8a9ba7" fontSize="9">{bars[bars.length - 1].date}</text>
    </svg>
  )
})

function LevelLine({ value, label, color, getY, padding, width }: { value: number; label: string; color: string; getY: (value: number) => number; padding: { left: number; right: number }; width: number }) {
  const y = getY(value)
  return <g><line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={color} strokeWidth={1.3} strokeDasharray="4 3" /><text x={width - padding.right + 5} y={y + 3} fill={color} fontSize="9" fontWeight="bold">{label}: {value}</text></g>
}
