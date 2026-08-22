export default function InsightsLoading() {
  return (
    <div className="min-h-screen bg-background px-6 py-20 font-ticker text-foreground">
      <div className="mx-auto max-w-[1480px] animate-pulse">
        <div className="h-4 w-56 rounded bg-white/[0.06]" />
        <div className="mt-5 h-14 w-[min(520px,80vw)] rounded-xl bg-white/[0.07]" />
        <div className="mt-10 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
          <div className="h-[470px] rounded-2xl border border-white/[0.06] bg-panel" />
          <div className="h-[470px] rounded-2xl border border-white/[0.06] bg-panel" />
        </div>
      </div>
    </div>
  )
}
