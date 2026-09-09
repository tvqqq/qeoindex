"use client"

import React from "react"
import { BookOpen, ClipboardCheck, ShieldAlert, Tags, Target, TrendingUp } from "lucide-react"

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

const chapters = [
  { id: "setup", label: "Luận điểm", icon: Tags },
  { id: "levels", label: "Mức giá", icon: Target },
  { id: "sizing", label: "Khối lượng", icon: TrendingUp },
  { id: "discipline", label: "Kỷ luật", icon: ShieldAlert },
]

export function PortfolioGuidanceDialog({ open, onOpenChange }: PortfolioGuidanceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-5xl overflow-hidden border-[var(--color-border)] bg-[#0b0f13] p-0 text-foreground sm:w-[calc(100vw-2rem)]">
        <DialogHeader className="border-b border-[var(--color-border)] px-5 py-5 sm:px-7">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl border border-purple-500/25 bg-purple-500/10 p-2 text-purple-300">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-black text-white sm:text-xl">
                Cẩm nang Portfolio Field Manual
              </DialogTitle>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-muted-2)] sm:text-base">
                Checklist vận hành cho việc ghi nhận luận điểm, mức giá, khối lượng và bằng chứng kỷ luật trong danh mục.
                Các giới hạn rủi ro phải lấy từ Money Management Plan hiện tại của chính danh mục, không dùng mặc định chung.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 md:grid-cols-[210px_minmax(0,1fr)]">
          <nav className="flex gap-2 overflow-x-auto border-b border-[var(--color-border)] px-4 py-3 md:flex-col md:border-b-0 md:border-r md:px-4 md:py-5" aria-label="Chương cẩm nang">
            {chapters.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#guidance-${id}`}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-sm font-bold text-slate-300 transition-colors hover:border-purple-400/30 hover:bg-purple-400/[0.08] hover:text-white"
              >
                <Icon className="h-4 w-4 text-purple-300" />
                {label}
              </a>
            ))}
          </nav>

          <div className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-300 sm:px-7 sm:py-6 sm:text-base">
            <ManualChapter
              id="guidance-setup"
              icon={<Tags className="h-5 w-5" />}
              title="1. Ghi luận điểm trước khi ghi giao dịch"
            >
              <p>
                Ghi rõ setup, lý do vào lệnh và bằng chứng kỹ thuật có thể kiểm tra lại. Setup tag là nhãn mô tả giao dịch;
                nó không tự biến thành tín hiệu mua, mức conviction hay dự báo xác suất thắng.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[var(--color-muted-2)]">
                <li>Ghi cấu trúc đang quan sát, ví dụ nền giá, breakout, spring/test hoặc hỗ trợ động khi thực sự có bằng chứng.</li>
                <li>Tách dữ kiện quan sát được khỏi diễn giải của người dùng.</li>
                <li>Dùng Mistake tag sau giao dịch để lưu sai lệch khỏi kế hoạch thay vì viết lại lịch sử.</li>
              </ul>
            </ManualChapter>

            <ManualChapter
              id="guidance-levels"
              icon={<Target className="h-5 w-5" />}
              title="2. Xác định Entry, Stop và Target bằng dữ liệu cụ thể"
            >
              <p>
                Stop và target phải đến từ luận điểm giao dịch cụ thể. Hệ thống không áp một khoảng stop, tỷ lệ Risk/Reward hay quy tắc chốt lời cố định cho mọi cổ phiếu.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Callout title="Stop" tone="down">
                  Ghi mức vô hiệu hóa luận điểm và nguồn của mức giá đó. Nếu chưa có stop hợp lệ, trạng thái rủi ro cần tiếp tục hiển thị chưa đủ bằng chứng.
                </Callout>
                <Callout title="Target" tone="up">
                  Ghi vùng mục tiêu nếu luận điểm có cơ sở định lượng hoặc cấu trúc. Target là kế hoạch, không phải cam kết giá sẽ đạt tới.
                </Callout>
              </div>
            </ManualChapter>

            <ManualChapter
              id="guidance-sizing"
              icon={<TrendingUp className="h-5 w-5" />}
              title="3. Tính khối lượng từ kế hoạch quản trị vốn hiện hành"
            >
              <p>
                Tab Phân bổ vốn sử dụng Account Equity, Risk per Trade, Max Active Risk và các giới hạn diversification từ Money Management Plan hiện tại.
                Những giá trị này là dữ liệu cấu hình của người dùng, không phải product default.
              </p>
              <div className="mt-3 rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-4">
                <p className="font-bold text-blue-200">Quy trình planned trade</p>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-[var(--color-muted-2)]">
                  <li>Nhập ticker, entry và stop dự kiến.</li>
                  <li>Đọc khối lượng gợi ý từ calculator hiện hữu và kiểm tra Active Risk sau giao dịch dự kiến.</li>
                  <li>Đọc concentration/diversification projection trước khi quyết định lưu Trade dự kiến.</li>
                  <li>Nếu chủ động vượt rule cấu hình, ghi lý do override để journal/audit giữ nguyên dấu vết quyết định.</li>
                </ol>
              </div>
              <p className="mt-3 text-[var(--color-muted-2)]">
                Ví dụ số học, nếu được dùng khi trao đổi, chỉ là minh họa. Giá trị áp dụng thực tế luôn là giá trị cấu hình trong kế hoạch hiện hành và input của giao dịch dự kiến.
              </p>
            </ManualChapter>

            <ManualChapter
              id="guidance-discipline"
              icon={<ShieldAlert className="h-5 w-5" />}
              title="4. Giữ bằng chứng kỷ luật và review quyết định"
            >
              <p>
                Sau giao dịch, dùng Journal để ghi lại việc tuân thủ stop, scale-in/scale-out, thay đổi luận điểm và các sai lầm có thể quan sát được.
                Không sửa dữ liệu quá khứ để làm cho quyết định cũ trông hợp lý hơn.
              </p>
              <div className="mt-3 flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
                <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                <p className="text-[var(--color-muted-2)]">
                  Review định kỳ nên so sánh kế hoạch trước lệnh với hành động thực tế: mức stop, khối lượng, Active Risk, diversification và lý do override nếu có.
                </p>
              </div>
            </ManualChapter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ManualChapter({
  id,
  icon,
  title,
  children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-3xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-2 text-purple-300">
        {icon}
        <h3 className="text-base font-black text-white sm:text-lg">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function Callout({ title, tone, children }: { title: string; tone: "up" | "down"; children: React.ReactNode }) {
  const classes = tone === "up"
    ? "border-[var(--color-up)]/20 bg-[var(--color-up-dim)]"
    : "border-[var(--color-down)]/20 bg-[var(--color-down-dim)]"

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="font-bold text-white">{title}</p>
      <p className="mt-1 text-[var(--color-muted-2)]">{children}</p>
    </div>
  )
}
