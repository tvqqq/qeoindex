import { BRAND } from "@/modules/shared/brand"

export function BrandLoadingScreen({
  label,
  detail,
  className = "relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05080b]",
}: {
  label: string
  detail: string
  className?: string
}) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(52,211,153,0.09)_0%,transparent_70%)]"
      />
      <div className="relative flex flex-col items-center gap-4">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/25 bg-[#0a1117]/90 shadow-[0_0_35px_-10px_rgba(34,201,138,0.8)]">
          <img src="/brand/stockos-mark.svg" alt="" className="h-8 w-8" />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.95)] motion-reduce:animate-none" />
        </div>
        <div className="max-w-72 text-center">
          <p className="font-ticker text-lg font-extrabold italic tracking-tight text-white">{BRAND.name}</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-emerald-200/80">{label}</p>
          <p className="mt-1.5 font-mono text-[9px] tracking-[0.08em] text-slate-600">{detail}</p>
        </div>
      </div>
    </div>
  )
}
