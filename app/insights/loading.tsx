export default function InsightsLoading() {
  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1580px] animate-pulse space-y-5">
        <div className="h-10 w-72 rounded-xl bg-white/[0.05]" />
        <div className="h-5 w-[min(80vw,620px)] rounded-lg bg-white/[0.035]" />
        <div className="grid gap-4 pt-6 lg:grid-cols-2">
          <div className="h-72 rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
          <div className="h-72 rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
        </div>
        <div className="h-96 rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      </div>
    </div>
  )
}
