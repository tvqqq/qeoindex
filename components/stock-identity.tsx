import React from "react"
import {
  Building2,
  Compass,
  Cpu,
  Flame,
  FlaskConical,
  HeartPulse,
  Landmark,
  Layers3,
  LineChart,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Utensils,
  type LucideIcon,
} from "lucide-react"

import { StockLogo } from "@/components/stock-logo"
import { cn } from "@/modules/shared/ui/cn"

export const STOCK_IDENTITY_LOGO_CLASS =
  "shrink-0 rounded-full border-white/40 drop-shadow-[0_0_8px_rgba(255,255,255,0.75)]"

export const STOCK_IDENTITY_TICKER_CLASS =
  "font-ticker text-xl sm:text-2xl font-extrabold italic bg-gradient-to-br from-white via-cyan-100 to-emerald-200 bg-clip-text text-transparent pr-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.2)] tracking-tight shrink-0 select-none"

export function getSectorIcon(sector: string): LucideIcon {
  const normalized = sector.toLowerCase()
  if (normalized.includes("ngân hàng") || normalized.includes("bank")) return Landmark
  if (normalized.includes("chứng khoán") || normalized.includes("tài chính")) return LineChart
  if (normalized.includes("bất động sản") || normalized.includes("xây dựng") || normalized.includes("bđs")) return Building2
  if (normalized.includes("công nghệ") || normalized.includes("it") || normalized.includes("viễn thông")) return Cpu
  if (normalized.includes("bán lẻ") || normalized.includes("tiêu dùng")) return ShoppingBag
  if (normalized.includes("thép") || normalized.includes("vật liệu") || normalized.includes("kim loại") || normalized.includes("thương mại")) return Layers3
  if (normalized.includes("dầu khí") || normalized.includes("năng lượng") || normalized.includes("điện")) return Flame
  if (normalized.includes("thực phẩm") || normalized.includes("đồ uống") || normalized.includes("nông nghiệp")) return Utensils
  if (normalized.includes("y tế") || normalized.includes("dược")) return HeartPulse
  if (normalized.includes("hóa chất") || normalized.includes("phân bón")) return FlaskConical
  if (normalized.includes("vận tải") || normalized.includes("logistics") || normalized.includes("cảng")) return Truck
  if (normalized.includes("bảo hiểm")) return ShieldCheck
  if (normalized.includes("du lịch") || normalized.includes("dịch vụ") || normalized.includes("hàng không")) return Compass
  return Layers3
}

export function SectorIcon({ sector, className }: { sector: string; className?: string }) {
  return React.createElement(getSectorIcon(sector), {
    className: className || "size-3 text-cyan-400/80 shrink-0",
  })
}

export function StockIdentity({
  ticker,
  companyName,
  exchange,
  detail,
  logoSize = 32,
  className,
}: {
  ticker: string
  companyName?: string | null
  exchange?: string | null
  detail?: string | null
  logoSize?: number
  className?: string
}) {
  const normTicker = ticker.trim().toUpperCase()
  let displayCompanyName = companyName?.trim() || ""

  // Defensive cleanup: never repeat ticker or sector inside companyName
  if (
    displayCompanyName.toUpperCase() === normTicker ||
    displayCompanyName.toUpperCase().startsWith(`${normTicker} ·`) ||
    displayCompanyName.toUpperCase().startsWith(`${normTicker} -`)
  ) {
    const afterSeparator = displayCompanyName.split(/·|-/)[1]?.trim()
    if (detail && afterSeparator?.toLowerCase() === detail.toLowerCase()) {
      displayCompanyName = ""
    } else {
      displayCompanyName = afterSeparator || ""
    }
  }
  if (detail && displayCompanyName.toLowerCase() === detail.toLowerCase()) {
    displayCompanyName = ""
  }

  return (
    <div data-stock-identity className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <StockLogo symbol={ticker} size={logoSize} className={STOCK_IDENTITY_LOGO_CLASS} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className={STOCK_IDENTITY_TICKER_CLASS}>{ticker}</span>
          {displayCompanyName ? (
            <span
              className="min-w-0 truncate font-ticker text-sm font-semibold text-slate-300 sm:text-base"
              title={displayCompanyName}
            >
              {displayCompanyName}
            </span>
          ) : null}
        </div>
        {exchange || detail ? (
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-400">
            {exchange ? <span>{exchange}</span> : null}
            {exchange && detail ? <span className="text-slate-600">·</span> : null}
            {detail ? (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <SectorIcon sector={detail} />
                <span>{detail}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
