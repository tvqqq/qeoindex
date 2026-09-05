import { TopNav } from "@/components/top-nav"

export default function ResearchReportDetailLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto max-w-[1800px] space-y-5 p-4 lg:p-6" aria-busy="true" aria-live="polite">
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 lg:p-6">
          <div className="h-3 w-48 animate-pulse rounded bg-white/[0.06]" />
          <div className="mt-3 h-7 w-full max-w-4xl animate-pulse rounded bg-white/[0.06]" />
          <div className="mt-3 h-4 w-64 animate-pulse rounded bg-white/[0.06]" />
        </section>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
          <section className="min-h-[560px] animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
          <div className="space-y-5">
            <section className="h-72 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
            <section className="h-72 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
          </div>
        </div>
        <span className="sr-only">Đang tải báo cáo nghiên cứu…</span>
      </main>
    </div>
  )
}
