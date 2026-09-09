"use client"

import { PortfolioSelector as CorePortfolioSelector } from "./portfolio-selector-core"
import type { PortfolioMeta } from "./portfolio-selector-core"

export type { PortfolioMeta } from "./portfolio-selector-core"

type PortfolioSelectorProps = {
  portfolios: PortfolioMeta[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: (name: string, initialCapital?: number) => Promise<void>
  onUpdate?: (id: string, updates: { name?: string; initial_capital?: number }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function PortfolioSelector(props: PortfolioSelectorProps) {
  return (
    <div className="flex flex-col items-start gap-1">
      <CorePortfolioSelector {...props} />
      <p className="max-w-[360px] pl-2 font-ticker text-[9px] leading-relaxed text-slate-600">
        <strong>Vốn mở đầu (Opening Capital)</strong> chỉ là mốc ban đầu. Sau khi danh mục có hoạt động, mọi lần nạp/rút vốn phải ghi tại <strong>Dòng vốn ngoài</strong> để không làm sai hiệu suất.
      </p>
    </div>
  )
}
