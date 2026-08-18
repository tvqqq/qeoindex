import { Suspense } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"
import Link from "next/link"

import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { TopNav } from "@/components/top-nav"
import {
  AnalysisBodySection,
  AnalysisBodySkeleton,
  MetricCardsSection,
  MetricCardsSkeleton,
  MultiTimeframeSection,
  MultiTimeframeSkeleton,
  PriceHistorySection,
  PriceHistorySkeleton,
  PriceSnapshotSection,
  PriceSnapshotSkeleton,
  TickerHeaderSection,
  TickerHeaderSkeleton,
  VnindexResearchSection,
} from "@/components/research/ticker-sections"
import {
  getCachedDailyHistory,
  getCachedHourlyHistory,
  getCachedResearchData,
  getCachedScannerData,
} from "@/lib/request-cache"

export const dynamic = "force-dynamic"

export default async function ResearchTickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const decoded = decodeURIComponent(ticker).toUpperCase()
  const isIndex = decoded === "VNINDEX"

  // Kick off ALL data fetches immediately — don't await any of them.
  // React cache() ensures each unique call is deduplicated: every Suspense section
  // that calls getCachedResearchData() / getCachedScannerData() / etc. gets the
  // same in-flight Promise, so no duplicate network requests are made.
  getCachedResearchData()
  getCachedScannerData()
  if (!isIndex) {
    getCachedDailyHistory(decoded)
    getCachedHourlyHistory(decoded)
  }

  if (isIndex) {
    return (
      <div className="min-h-screen bg-background text-[15px]">
        <TopNav />
        <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
          <FinhayLiveControl indexes={[decoded]} />
        </div>
        <Suspense fallback={<div className="flex h-64 items-center justify-center text-sm text-foreground/50">Đang tải nghiên cứu VNINDEX...</div>}>
          <VnindexResearchSection ticker={decoded} />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-[15px]">
      <TopNav />

      <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
        <FinhayLiveControl symbols={[decoded]} />
      </div>

      {/* Header band — streams in as soon as Notion responds */}
      <Suspense fallback={<TickerHeaderSkeleton ticker={decoded} />}>
        <TickerHeaderSection ticker={decoded} />
      </Suspense>

      <main className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6">
        {/* Price snapshot + VNINDEX banner — Notion data, fast */}
        <Suspense fallback={<PriceSnapshotSkeleton />}>
          <PriceSnapshotSection ticker={decoded} />
        </Suspense>

        {/* MTF Workstation — needs daily + hourly bars, streams in last */}
        <Suspense fallback={<MultiTimeframeSkeleton />}>
          <MultiTimeframeSection ticker={decoded} />
        </Suspense>

        {/* Price history chart — needs daily bars, streams in mid */}
        <Suspense fallback={<PriceHistorySkeleton />}>
          <PriceHistorySection ticker={decoded} />
        </Suspense>

        {/* Metric cards — Notion scanner data only, fast */}
        <Suspense fallback={<MetricCardsSkeleton />}>
          <MetricCardsSection ticker={decoded} />
        </Suspense>

        {/* Analysis body (Wyckoff, thesis, timeline, MA, support…) — Notion, fast */}
        <Suspense fallback={<AnalysisBodySkeleton />}>
          <AnalysisBodySection ticker={decoded} />
        </Suspense>

        <div className="flex items-center justify-between border-t border-border pt-4 text-sm">
          <Link href="/research/scanner" className="inline-flex items-center gap-1.5 text-foreground/60 hover:text-brand">
            <ArrowLeft className="h-4 w-4" /> Quay lại Scanner
          </Link>
          <Link href="/research" className="inline-flex items-center gap-1.5 text-brand">
            Trung tâm Nghiên cứu <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  )
}
