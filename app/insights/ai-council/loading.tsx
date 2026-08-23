import { BrainCircuit } from "lucide-react"

import { TopNav } from "@/components/top-nav"

export default function AiCouncilLoading() {
  return (
    <div className="min-h-screen bg-[#06090d] text-white" aria-busy="true">
      <TopNav />
      <main className="mx-auto max-w-[1720px] px-3 py-4 sm:px-5 lg:px-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08] text-violet-300"><BrainCircuit className="size-[18px]" /></span>
          <div>
            <div className="h-5 w-32 animate-pulse rounded bg-white/[0.08]" />
            <div className="mt-1.5 h-3 w-72 max-w-[70vw] animate-pulse rounded bg-white/[0.05]" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="h-[640px] animate-pulse rounded-2xl border border-white/[0.07] bg-[#080d13]" />
          <div className="space-y-4">
            <div className="h-64 animate-pulse rounded-3xl border border-white/[0.07] bg-[#080d13]" />
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-60 animate-pulse rounded-2xl border border-white/[0.07] bg-[#080d13]" />)}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
