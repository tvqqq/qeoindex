"use client"

import { useState } from "react"
import { IndexChartContent } from "@/components/index-chart/index-chart-modal"
import { useIndexCandles } from "@/components/index-chart/use-index-candles"
import type { IndexChartResolution } from "@/modules/market/realtime/index-candles"

export function IndexChartWorkspace() {
  const [resolution, setResolution] = useState<IndexChartResolution>("1")
  const { candles, isLoading, isRefreshing, errors, refresh } = useIndexCandles(true, resolution)

  return (
    <section
      data-market-board-index-chart
      aria-label="Biểu đồ realtime VN-Index và VN30F1M"
      className="flex h-full min-h-[480px] min-w-0 flex-col overflow-hidden border border-white/[0.08] bg-[#070a0e]"
    >
      <IndexChartContent
        resolution={resolution}
        onResolutionChange={setResolution}
        candles={candles}
        isLoading={isLoading}
        errors={errors}
        onRefresh={refresh}
        isRefreshing={isRefreshing}
      />
    </section>
  )
}
