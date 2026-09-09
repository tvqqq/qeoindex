import { TopNav } from "@/components/top-nav"

export default function ResearchReportsCatalogLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground" aria-busy="true" aria-live="polite">
      <TopNav />
      <main className="mx-auto max-w-[1500px] space-y-5 p-4 lg:p-6">
        <section className="animate-pulse rounded-2xl border border-white/[0.08] bg-panel/60 p-6">
          <div className="h-4 w-36 rounded bg-white/[0.07]" />
          <div className="mt-4 h-8 w-2/3 max-w-xl rounded bg-white/[0.07]" />
          <div className="mt-3 h-4 w-full max-w-2xl rounded bg-white/[0.05]" />
        </section>
        <section className="animate-pulse rounded-2xl border border-white/[0.08] bg-panel/50 p-5">
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((item) => <div key={item} className="h-9 w-28 rounded-full bg-white/[0.06]" />)}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-10 rounded-xl bg-white/[0.05]" />)}
          </div>
        </section>
        <div className="grid gap-3 lg:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className="animate-pulse rounded-2xl border border-white/[0.07] bg-panel/50 p-5">
              <div className="h-5 w-1/3 rounded bg-white/[0.06]" />
              <div className="mt-4 h-6 w-4/5 rounded bg-white/[0.07]" />
              <div className="mt-3 h-4 w-1/2 rounded bg-white/[0.05]" />
              <div className="mt-5 h-12 rounded-xl bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
