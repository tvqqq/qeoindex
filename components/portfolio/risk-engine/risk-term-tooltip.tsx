"use client"

import { CircleHelp } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export const PORTFOLIO_RISK_TERMS = {
  accountEquity: {
    labelVi: "Vốn chủ tài khoản",
    labelEn: "Account Equity",
    help: "Giá trị vốn hiện tại của danh mục theo tiền mặt ước tính cộng giá trị thị trường. Khi thiếu giá hiện tại, chỉ số được đánh dấu chưa đủ dữ liệu.",
  },
  activeRisk: {
    labelVi: "Rủi ro đang hoạt động",
    labelEn: "Active Risk",
    help: "Rủi ro giảm giá đã biết của các Trade đang mở, tính từ AVCO đến mức dừng lỗ hiện tại. Risk Unknown không bị quy về 0.",
  },
  activeRiskPercent: {
    labelVi: "Tỷ lệ rủi ro đang hoạt động",
    labelEn: "Active Risk %",
    help: "Rủi ro đang hoạt động đã biết chia cho Vốn chủ tài khoản. Nếu coverage chưa đầy đủ, tỷ lệ này chỉ là phần đã biết.",
  },
  maxActiveRisk: {
    labelVi: "Rủi ro hoạt động tối đa",
    labelEn: "Max Active Risk",
    help: "Giới hạn rủi ro hoạt động theo Kế hoạch quản trị vốn hiện hành và Vốn chủ tài khoản hiện tại.",
  },
  remainingRiskBudget: {
    labelVi: "Ngân sách rủi ro còn lại",
    labelEn: "Remaining Risk Budget",
    help: "Chênh lệch giữa Rủi ro hoạt động tối đa và Rủi ro đang hoạt động đã biết. Giá trị âm cho thấy phần đã biết đã vượt giới hạn.",
  },
  initialRisk: {
    labelVi: "Rủi ro ban đầu",
    labelEn: "Initial Risk",
    help: "Snapshot rủi ro tại thời điểm lập/mở Trade. Giá trị lịch sử này không bị ghi đè bởi stop mới.",
  },
  currentStop: {
    labelVi: "Dừng lỗ hiện tại",
    labelEn: "Current Stop",
    help: "Mức stop có hiệu lực mới nhất của Trade theo lịch sử stop chuẩn hóa. Thiếu stop làm rủi ro của Trade ở trạng thái Risk Unknown.",
  },
  drawdown: {
    labelVi: "Mức sụt giảm",
    labelEn: "Drawdown",
    help: "Mức giảm từ đỉnh Vốn chủ tài khoản trên chuỗi equity chuẩn hóa, bắt đầu từ Vốn ban đầu và dùng RAW Daily cho lịch sử.",
  },
  riskState: {
    labelVi: "Trạng thái rủi ro",
    labelEn: "Risk State",
    help: "Trạng thái xác định từ các rule đã lưu và bằng chứng hiện tại: Bình thường, Giảm rủi ro, Tạm dừng & rà soát, hoặc Chưa xác định.",
  },
} as const

export type PortfolioRiskTermKey = keyof typeof PORTFOLIO_RISK_TERMS

export function RiskTermTooltip({ term }: { term: PortfolioRiskTermKey }) {
  const metadata = PORTFOLIO_RISK_TERMS[term]
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="inline-flex items-center gap-1.5 text-left font-ticker font-bold text-slate-300"
          aria-label={`${metadata.labelVi}. Thuật ngữ gốc: ${metadata.labelEn}. ${metadata.help}`}
        >
          <span>{metadata.labelVi}</span>
          <CircleHelp className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </TooltipTrigger>
        <TooltipContent className="max-w-sm border border-[#2a2e40] bg-[#10141d] text-xs leading-relaxed text-slate-200">
          <p className="font-bold text-slate-100">Thuật ngữ gốc: {metadata.labelEn}</p>
          <p className="mt-1.5">{metadata.help}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
