import { StockLogo } from "@/components/stock-logo"
import { cn } from "@/lib/utils"

export const STOCK_IDENTITY_LOGO_CLASS =
  "shrink-0 rounded-full border-white/40 drop-shadow-[0_0_8px_rgba(255,255,255,0.75)]"

export const STOCK_IDENTITY_TICKER_CLASS =
  "font-ticker text-xl sm:text-2xl font-extrabold italic bg-gradient-to-br from-white via-cyan-100 to-emerald-200 bg-clip-text text-transparent pr-2 drop-shadow-[0_0_15px_rgba(34,211,238,0.2)] tracking-tight shrink-0 select-none"

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
  const meta = [exchange, detail].filter(Boolean).join(" · ")

  return (
    <div data-stock-identity className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <StockLogo symbol={ticker} size={logoSize} className={STOCK_IDENTITY_LOGO_CLASS} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className={STOCK_IDENTITY_TICKER_CLASS}>{ticker}</span>
          {companyName ? (
            <span className="min-w-0 truncate font-ticker text-sm font-semibold text-slate-300 sm:text-base" title={companyName}>
              {companyName}
            </span>
          ) : null}
        </div>
        {meta ? <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{meta}</div> : null}
      </div>
    </div>
  )
}
