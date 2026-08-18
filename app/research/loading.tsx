import { TopNav } from "@/components/top-nav"

export default function ResearchLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6" aria-busy="true" aria-live="polite">
        <section className="rounded-xl border border-border bg-panel p-5">
          <div className="h-7 w-56 animate-pulse rounded bg-panel-2" />
          <div className="mt-3 h-4 w-full max-w-3xl animate-pulse rounded bg-panel-2" />
          <div className="mt-2 h-4 w-2/3 max-w-2xl animate-pulse rounded bg-panel-2" />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-border bg-panel p-5">
              <div className="h-4 w-24 animate-pulse rounded bg-panel-2" />
              <div className="mt-4 h-8 w-28 animate-pulse rounded bg-panel-2" />
              <div className="mt-3 h-4 w-full animate-pulse rounded bg-panel-2" />
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-panel">
          <div className="border-b border-border p-4">
            <div className="h-9 w-full max-w-xl animate-pulse rounded bg-panel-2" />
          </div>
          <div className="divide-y divide-border/70">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="grid grid-cols-[100px_1fr_140px] gap-4 p-4">
                <div className="h-5 animate-pulse rounded bg-panel-2" />
                <div className="h-5 animate-pulse rounded bg-panel-2" />
                <div className="h-5 animate-pulse rounded bg-panel-2" />
              </div>
            ))}
          </div>
        </section>
        <span className="sr-only">Đang tải dữ liệu nghiên cứu…</span>
      </main>
    </div>
  )
}
