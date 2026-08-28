"use client"

import React, { useState, useEffect, useCallback } from "react"
import { PlusCircle, Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { TransactionAction } from "@/lib/portfolio/pnl"

interface AddTransactionDialogProps {
  portfolioId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  initialTicker?: string
}

const ACTION_OPTIONS: Array<{ value: TransactionAction; label: string }> = [
  { value: "buy", label: "Mua (Buy)" },
  { value: "sell", label: "Bán (Sell)" },
  { value: "dividend_cash", label: "Cổ tức tiền mặt (Cash Dividend)" },
  { value: "dividend_stock", label: "Cổ tức cổ phiếu (Stock Dividend)" },
  { value: "rights", label: "Quyền mua (Rights Issue)" },
]

export function AddTransactionDialog({
  portfolioId,
  open,
  onOpenChange,
  onSuccess,
  initialTicker = "",
}: AddTransactionDialogProps) {
  const [action, setAction] = useState<TransactionAction>("buy")
  const [ticker, setTicker] = useState(initialTicker)
  const [transactionDate, setTransactionDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split("T")[0]
  })
  const [quantity, setQuantity] = useState<string>("")
  const [price, setPrice] = useState<string>("")
  const [fee, setFee] = useState<string>("0")
  const [targetPrice, setTargetPrice] = useState<string>("")
  const [stopLoss, setStopLoss] = useState<string>("")
  const [note, setNote] = useState<string>("")
  const [tagsInput, setTagsInput] = useState<string>("")

  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string>("")

  useEffect(() => {
    if (open) {
      if (initialTicker) setTicker(initialTicker)
      setErrorMsg("")
    }
  }, [open, initialTicker])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
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
      if (isNaN(parsedFee) || parsedFee < 0) {
        setErrorMsg("Phí không hợp lệ.")
        return
      }

      const parsedTarget = targetPrice ? parseFloat(targetPrice) : null
      const parsedStopLoss = stopLoss ? parseFloat(stopLoss) : null

      const tags = tagsInput
        ? tagsInput
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : []

      setSubmitting(true)
      try {
        const res = await fetch(`/api/portfolio/${portfolioId}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ticker: cleanTicker,
            action,
            quantity: parsedQty,
            price: parsedPrice,
            fee: parsedFee,
            transaction_date: transactionDate,
            note: note.trim() || null,
            tags,
            target_price: parsedTarget,
            stop_loss: parsedStopLoss,
          }),
        })

        const data = await res.json()
        if (!res.ok || !data.ok) {
          setErrorMsg(data.error || "Thêm giao dịch thất bại.")
          return
        }

        // Reset form
        setQuantity("")
        setPrice("")
        setFee("0")
        setTargetPrice("")
        setStopLoss("")
        setNote("")
        setTagsInput("")
        onSuccess()
      } catch {
        setErrorMsg("Lỗi kết nối. Vui lòng thử lại.")
      } finally {
        setSubmitting(false)
      }
    },
    [
      portfolioId,
      action,
      ticker,
      transactionDate,
      quantity,
      price,
      fee,
      targetPrice,
      stopLoss,
      note,
      tagsInput,
      onSuccess,
    ],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[var(--color-border)] bg-[#0b0f13] text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-white">
            <PlusCircle className="h-4 w-4 text-[var(--color-up)]" />
            Thêm giao dịch mới
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          {/* Loại giao dịch & Mã CP */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Loại giao dịch <span className="text-[var(--color-down)]">*</span>
              </label>
              <Select value={action} onValueChange={(val) => setAction(val as TransactionAction)}>
                <SelectTrigger className="w-full border-[var(--color-border)] bg-cell text-xs">
                  <SelectValue placeholder="Chọn loại GD" />
                </SelectTrigger>
                <SelectContent className="border-[var(--color-border)] bg-[#0f1418]">
                  {ACTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Mã cổ phiếu <span className="text-[var(--color-down)]">*</span>
              </label>
              <Input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="VD: VCB, FPT"
                maxLength={12}
                className="font-ticker uppercase text-xs"
                required
              />
            </div>
          </div>

          {/* Ngày giao dịch & Khối lượng */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Ngày thực hiện <span className="text-[var(--color-down)]">*</span>
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
                Khối lượng (CP) <span className="text-[var(--color-down)]">*</span>
              </label>
              <Input
                type="number"
                step="any"
                min="0.0001"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="VD: 1000"
                className="font-ticker text-xs"
                required
              />
            </div>
          </div>

          {/* Giá & Phí */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Giá (k₫ / CP) {action !== "dividend_stock" && <span className="text-[var(--color-down)]">*</span>}
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                value={action === "dividend_stock" ? "0" : price}
                disabled={action === "dividend_stock"}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="VD: 85.5"
                className="font-ticker text-xs"
                required={action !== "dividend_stock"}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Phí & Thuế (k₫)
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="VD: 15"
                className="font-ticker text-xs"
              />
            </div>
          </div>

          {/* Target & Stoploss */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Mục tiêu (k₫)
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="VD: 95.0"
                className="font-ticker text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Cắt lỗ (k₫)
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="VD: 80.0"
                className="font-ticker text-xs"
              />
            </div>
          </div>

          {/* Ghi chú & Tags */}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Thẻ phân loại (cách nhau bằng dấu phẩy)
              </label>
              <Input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="VD: Vượt đỉnh, Sóng ngành, Trung hạn"
                className="text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted-2)]">
                Lý do vào lệnh / Ghi chú tâm lý
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi lại lý do mua/bán, kỳ vọng hoặc bài học rút ra..."
                className="w-full rounded-md border border-[var(--color-border)] bg-cell px-3 py-2 text-xs text-foreground placeholder:text-[var(--color-muted)] focus:border-[var(--color-ring)] focus:outline-none"
              />
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-[var(--color-down)]">{errorMsg}</p>
          )}

          <DialogFooter className="gap-2 pt-2 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="text-xs"
            >
              Hủy
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="gap-1.5 bg-[var(--color-up)] text-black hover:bg-[var(--color-up)]/90 text-xs font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                "Lưu giao dịch"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
