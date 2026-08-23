import { TopNav } from "@/components/top-nav"

export default function WyckoffChartLoading() {
  return (
    <div className="min-h-screen bg-[#05080d]" aria-busy="true">
      <TopNav />
      <div className="mx-auto max-w-[1920px] animate-pulse p-4 lg:p-5">
        <div className="mb-4 h-24 rounded-2xl bg-white/[0.04]" />
        <div className="grid min-h-[760px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080c12] xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="m-4 rounded-xl bg-white/[0.035]" />
          <div className="border-l border-white/[0.07] p-4"><div className="h-16 rounded-xl bg-white/[0.035]" /><div className="mt-4 h-[620px] rounded-xl bg-white/[0.025]" /></div>
        </div>
      </div>
    </div>
  )
}
