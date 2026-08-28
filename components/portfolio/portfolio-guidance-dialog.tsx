"use client"

import React from "react"
import { BookOpen, Target, ShieldAlert, Sparkles, TrendingUp } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface PortfolioGuidanceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PortfolioGuidanceDialog({ open, onOpenChange }: PortfolioGuidanceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-[var(--color-border)] bg-[#0b0f13] text-foreground p-6 max-h-[85vh] overflow-y-auto">
        <DialogHeader className="border-b border-[var(--color-border)] pb-3">
          <div className="flex items-center gap-2 text-purple-400">
            <BookOpen className="h-5 w-5" />
            <DialogTitle className="text-base font-bold text-white">
              Cẩm Nang Ghi Nhật Ký Giao Dịch & Quản Trị Vốn Hiệu Quả
            </DialogTitle>
          </div>
          <p className="text-xs text-[var(--color-muted-2)]">
            Quy chuẩn quản trị danh mục chuyên nghiệp kết hợp phương pháp Wyckoff & Position Sizing chuẩn phố Wall.
          </p>
        </DialogHeader>

        <div className="space-y-6 pt-3 text-xs leading-relaxed text-slate-300">
          {/* Quy tắc 1 */}
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-purple-300">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <span>1. Xác định Setup & Lý do vào lệnh (Tagging)</span>
            </div>
            <p>
              Tuyệt đối không mua vì cảm tính hay tin đồn. Luôn gắn ít nhất một <strong>Thẻ Thiết lập (Setup tag)</strong> chuẩn kỹ thuật khi nhập lệnh:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-[11px] text-[var(--color-muted-2)]">
              <li><strong className="text-white">Nền giá phẳng / VCP:</strong> Mua tại điểm co hẹp biến động kiệt khối lượng.</li>
              <li><strong className="text-white">Spring Wyckoff (Pha C):</strong> Cú rũ bỏ thủng hỗ trợ sau đó kéo ngược thần tốc.</li>
              <li><strong className="text-white">Test Cung MA20:</strong> Cổ phiếu điều chỉnh thanh khoản thấp về vùng hỗ trợ động.</li>
              <li><strong className="text-white">Breakout KL lớn:</strong> Điểm vượt đỉnh kèm dòng tiền tổ chức xác nhận.</li>
            </ul>
          </div>

          {/* Quy tắc 2 */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
              <Target className="h-4 w-4 text-emerald-400" />
              <span>2. Kế hoạch Risk/Reward (Tối thiểu R:R = 1:2.5)</span>
            </div>
            <p>
              Trước khi xuống tiền mua bất kỳ cổ phiếu nào, bạn bắt buộc phải nhập sẵn <strong>Mục tiêu (Target 1-3)</strong> và <strong>Cắt lỗ (Stop Loss 1-3)</strong>:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1">
              <div className="p-2 rounded-lg bg-black/40 border border-white/5">
                <span className="text-[var(--color-down)] font-bold">Cắt lỗ (Stop Loss):</span>
                <p className="text-[var(--color-muted-2)]">Luôn đặt dưới đáy gần nhất hoặc tối đa 5% - 7%. Vi phạm là bán ngay, không do dự.</p>
              </div>
              <div className="p-2 rounded-lg bg-black/40 border border-white/5">
                <span className="text-[var(--color-up)] font-bold">Chốt lời từng phần:</span>
                <p className="text-[var(--color-muted-2)]">Chốt 1/3 tại Target 1, nâng Stoploss lên giá vốn (hòa vốn), và thả trôi 2/3 còn lại theo xu hướng.</p>
              </div>
            </div>
          </div>

          {/* Quy tắc 3 */}
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-300">
              <TrendingUp className="h-4 w-4 text-blue-400" />
              <span>3. Công thức Phân bổ vốn 1-2% NAV (Position Sizing)</span>
            </div>
            <p>
              Sử dụng tab <strong>Phân bổ vốn</strong> để xác định chính xác số lượng cổ phiếu được mua:
            </p>
            <div className="rounded-lg bg-black/40 p-3 font-mono text-[11px] text-blue-200 border border-blue-500/20">
              Số tiền giải ngân = (Tổng NAV × % Rủi ro cho phép) / % Cắt lỗ deal
            </div>
            <p className="text-[11px] text-[var(--color-muted-2)]">
              Ví dụ: Tài khoản 1 tỷ, chấp nhận rủi ro 1.5% NAV (= 15 triệu), Stoploss deal là 7.5% → Bạn giải ngân tối đa: 15 tr / 7.5% = <strong>200 triệu</strong> (20% NAV). Dù deal này bị chạm cắt lỗ, bạn chỉ mất đúng 1.5% NAV, bảo toàn 98.5% vốn để chiến đấu tiếp.
            </p>
          </div>

          {/* Quy tắc 4 */}
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-rose-300">
              <ShieldAlert className="h-4 w-4 text-rose-400" />
              <span>4. Ghi nhận Sai lầm & Tối ưu Kỷ luật</span>
            </div>
            <p>
              Thành công trong trading đến từ việc hạn chế lặp lại sai lầm. Hãy dũng cảm gắn <strong>Thẻ Sai lầm (Mistake tag)</strong> khi một lệnh thất bại:
            </p>
            <p className="text-[11px] text-[var(--color-muted-2)]">
              Định kỳ cuối mỗi tháng, xem lại các lệnh bị gắn thẻ <em>FOMO mua đuổi, Bắt đáy sớm, Không theo kế hoạch</em> để nhận diện điểm yếu tâm lý và cải thiện tỷ lệ thắng theo thời gian.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
