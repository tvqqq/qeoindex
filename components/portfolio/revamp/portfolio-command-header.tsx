import type { ReactNode } from "react"

export type PortfolioCommandHeaderProps = {
  selector: ReactNode
  actions: ReactNode
}

export function PortfolioCommandHeader({ selector, actions }: PortfolioCommandHeaderProps) {
  return (
    <section className="relative mb-6 overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-[#171329] via-[#10131d] to-[#0b0e14] px-5 py-5 shadow-[0_28px_90px_rgba(0,0,0,0.28)] sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300/80">
            <span className="h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_14px_rgba(167,139,250,0.9)]" />
            Portfolio & Risk Management
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Portfolio Command Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
            Theo dõi vị thế, rủi ro và bằng chứng giao dịch từ các nguồn dữ liệu hiện có của danh mục.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
          <div className="min-w-0">{selector}</div>
          <div className="shrink-0">{actions}</div>
        </div>
      </div>
    </section>
  )
}
