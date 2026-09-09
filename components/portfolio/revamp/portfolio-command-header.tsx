import type { ReactNode } from "react"

export type PortfolioCommandHeaderProps = {
  selector: ReactNode
  actions: ReactNode
}

export function PortfolioCommandHeader({ selector, actions }: PortfolioCommandHeaderProps) {
  return (
    <section className="relative mb-6 rounded-3xl border border-[#2b2e40] bg-gradient-to-r from-[#0d1017] via-[#131724] to-[#0d1017] px-6 py-6 shadow-xl">
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-400 font-ticker">
            <span className="h-2 w-2 rounded-full bg-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.9)]" />
            Portfolio &amp; Risk Management
          </div>
          <h1 className="font-ticker text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Nhật ký đầu tư &amp;{" "}
            <span className="italic bg-gradient-to-r from-purple-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              Quản trị rủi ro
            </span>
          </h1>
          <p className="mt-1 font-ticker text-xs font-medium text-[var(--color-muted-2)] sm:text-sm">
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
