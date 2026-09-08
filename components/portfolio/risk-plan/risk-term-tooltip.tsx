"use client"

import { CircleHelp } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const RISK_PLAN_LABEL_VI: Record<string, string> = {
  "Risk Profile": "Hồ sơ rủi ro",
  "Discipline Profile": "Hồ sơ kỷ luật",
  "Money Management Plan": "Kế hoạch quản trị vốn",
  "Market Risk": "Rủi ro thị trường",
  "12-Month Active Trading Return": "Lợi nhuận giao dịch chủ động 12 tháng",
  "Win Ratio": "Tỷ lệ giao dịch thắng",
  "Personal Risk Tolerance": "Mức chấp nhận rủi ro cá nhân",
  "Trading Experience": "Kinh nghiệm giao dịch",
  "Payoff Ratio": "Tỷ lệ lãi/lỗ bình quân",
  "Punctuality": "Tính đúng giờ",
  "Diet Self-Control": "Khả năng tự kiểm soát ăn uống",
  "Record Keeping": "Thói quen ghi chép",
  "Office Clutter": "Mức độ ngăn nắp nơi làm việc",
  "Bills & Expenses": "Kỷ luật hóa đơn & chi tiêu",
  "Exercise Routine": "Thói quen tập luyện",
  "Risk per Trade": "Rủi ro mỗi giao dịch",
  "Max Active Risk": "Rủi ro đang hoạt động tối đa",
  "Account Drawdown": "Mức sụt giảm tài khoản",
  "Drawdown Reduce Threshold": "Ngưỡng sụt giảm để giảm rủi ro",
  "Risk Reduction Factor": "Hệ số giảm rủi ro",
  "Drawdown Pause Threshold": "Ngưỡng sụt giảm để tạm dừng",
  "Consecutive Stop-Outs": "Số lần dừng lỗ liên tiếp",
  "Rolling Trade Loss Window": "Cửa sổ giao dịch thua lỗ",
  "Daily Trading Holiday": "Quy tắc nghỉ giao dịch theo ngày",
  "Daily Losing Trades": "Số giao dịch thua trong ngày",
  "Daily Loss Percent": "Mức lỗ trong ngày",
  "Weekly Trading Holiday": "Quy tắc nghỉ giao dịch theo tuần",
  "Weekly Losing Trades": "Số giao dịch thua trong tuần",
  "Weekly Loss Percent": "Mức lỗ trong tuần",
  "Monthly Trading Holiday": "Quy tắc nghỉ giao dịch theo tháng",
  "Monthly Losing Trades": "Số giao dịch thua trong tháng",
  "Monthly Loss Percent": "Mức lỗ trong tháng",
  "Define Initial Stop-Loss Exit": "Xác định mức dừng lỗ ban đầu",
  "Honor Stop When Hit": "Tuân thủ mức dừng lỗ khi bị chạm",
  "Market/System Stop Rules": "Quy tắc dừng lỗ theo thị trường/hệ thống",
  "Trailing Stops": "Dừng lỗ kéo theo",
  "Emotional Stop Movement": "Không dời dừng lỗ theo cảm xúc",
  "Recalculate Risk When Scaling In": "Tính lại rủi ro khi gia tăng vị thế",
  "Daily Record Keeping": "Ghi chép giao dịch hằng ngày",
  "Scale In Only To Winning Position": "Chỉ gia tăng vị thế đang có lãi",
  "Doubling Down": "Không bình quân giá xuống",
  "Scale-Out Mode": "Cách giảm vị thế",
  "Custom Scale-Out Percentages": "Tỷ lệ giảm vị thế tùy chỉnh",
  "Diversification Limits": "Giới hạn đa dạng hóa",
  "Max Sector Risk": "Rủi ro ngành tối đa",
  "Concentration Warning": "Cảnh báo tập trung",
  "Risk Capital Policy": "Quy tắc vốn chịu rủi ro",
  "Risk Capital Value": "Giá trị vốn chịu rủi ro",
  "Plan Notes": "Ghi chú kế hoạch",
  "Advanced Risk Acknowledgement": "Xác nhận mức rủi ro nâng cao",
  "Reduce Risk at Drawdown": "Giảm rủi ro khi tài khoản sụt giảm",
  "Pause Live Trading at Drawdown": "Tạm dừng giao dịch thật khi tài khoản sụt giảm",
}

export function RiskTermTooltip({
  label,
  help,
}: {
  label: string
  help: string
}) {
  const labelEn = label
  const labelVi = RISK_PLAN_LABEL_VI[labelEn] ?? labelEn

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="inline-flex items-center gap-1.5 text-left font-ticker font-bold text-slate-100"
          aria-label={`${labelVi}. Thuật ngữ gốc: ${labelEn}. ${help}`}
        >
          <span>{labelVi}</span>
          <CircleHelp className="h-3.5 w-3.5 text-slate-500" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs border border-[#2a2e40] bg-[#10141d] text-xs leading-relaxed text-slate-200">
          <p className="font-bold text-slate-100">Thuật ngữ gốc: {labelEn}</p>
          <p className="mt-1.5">{help}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
