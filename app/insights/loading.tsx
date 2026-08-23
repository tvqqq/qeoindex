import { AiLoader } from "@/components/smoothui/ai-loader"
import { TopNav } from "@/components/top-nav"

export default function InsightsLoading() {
  return (
    <div className="min-h-screen bg-background font-ticker text-foreground">
      <TopNav />

      <main className="mx-auto max-w-[1920px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Top bar / status skeleton */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-cyan-400 animate-ping" />
              <div className="h-6 w-48 rounded bg-white/[0.08] animate-pulse" />
            </div>
            <div className="h-4 w-72 rounded bg-white/[0.04] animate-pulse" />
          </div>
          <div className="flex items-center gap-3">
            <AiLoader label="Đang tải dữ liệu Insights & Rating..." />
          </div>
        </div>

        {/* 4 Summary / Metric Cards Skeleton */}
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4" data-insights-metrics>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-white/[0.08] bg-[#07111f] p-4 shadow-sm animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-4 w-28 rounded bg-white/[0.06]" />
                <div className="size-6 rounded-lg bg-white/[0.06]" />
              </div>
              <div className="mt-3.5 h-8 w-36 rounded bg-white/[0.08]" />
              <div className="mt-2.5 h-3.5 w-44 rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>

        {/* Filters / Search Bar Skeleton */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080d17] p-3.5 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-9 w-32 rounded-lg bg-white/[0.08]" />
            <div className="h-9 w-32 rounded-lg bg-white/[0.05]" />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-48 rounded-lg bg-white/[0.06]" />
            <div className="h-9 w-40 rounded-lg bg-white/[0.06]" />
          </div>
        </div>

        {/* Rating Table Skeleton */}
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#07111f] shadow-sm animate-pulse" data-insights-table>
          <div className="border-b border-white/[0.08] bg-white/[0.02] p-4">
            <div className="grid grid-cols-11 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((col) => (
                <div key={col} className="h-4 rounded bg-white/[0.07]" />
              ))}
            </div>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
              <div key={row} className="grid grid-cols-11 gap-3 p-4 items-center">
                <div className="h-6 w-14 rounded bg-cyan-400/10" />
                <div className="h-4 w-20 rounded bg-white/[0.06]" />
                <div className="h-6 w-12 rounded-full bg-white/[0.05]" />
                <div className="h-6 w-12 rounded-full bg-white/[0.05]" />
                <div className="h-6 w-12 rounded-full bg-cyan-400/15" />
                <div className="h-6 w-12 rounded-full bg-purple-400/15" />
                <div className="h-4 w-16 rounded bg-white/[0.06]" />
                <div className="h-4 w-16 rounded bg-white/[0.06]" />
                <div className="h-4 w-16 rounded bg-white/[0.06]" />
                <div className="h-5 w-20 rounded bg-emerald-400/10" />
                <div className="h-7 w-20 rounded-lg bg-cyan-400/15" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
