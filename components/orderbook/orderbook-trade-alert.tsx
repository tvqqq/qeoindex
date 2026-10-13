"use client"

import type { ReactNode } from "react"
import { X } from "lucide-react"

type Tone = "BUY" | "SELL" | "REF" | "PUT_THROUGH"

const styles: Record<Tone, { shell: string; icon: string; label: string; badge: string }> = {
  BUY: {
    shell: "border-emerald-400/60 bg-[#102e29]",
    icon: "border-emerald-400/40 bg-emerald-500/20 text-emerald-300",
    label: "text-emerald-300",
    badge: "border-emerald-400/40 bg-emerald-500/20 text-emerald-200",
  },
  SELL: {
    shell: "border-rose-400/60 bg-[#321a22]",
    icon: "border-rose-400/40 bg-rose-500/20 text-rose-300",
    label: "text-rose-300",
    badge: "border-rose-400/40 bg-rose-500/20 text-rose-200",
  },
  REF: {
    shell: "border-slate-400/50 bg-[#1c2733]",
    icon: "border-slate-400/40 bg-slate-500/20 text-slate-200",
    label: "text-slate-200",
    badge: "border-slate-400/40 bg-slate-500/20 text-slate-200",
  },
  PUT_THROUGH: {
    shell: "border-amber-500/50 bg-[#161a20]",
    icon: "border-amber-500/40 bg-amber-500/20 text-amber-400",
    label: "text-amber-300",
    badge: "border-amber-500/35 bg-amber-500/20 text-amber-300",
  },
}

export function OrderbookTradeAlert({
  kind, tone, icon, label, volume, price, value, onActivate, onDismiss,
}: {
  kind: "large" | "putthrough"
  tone: Tone
  icon: ReactNode
  label: string
  volume: string
  price: string
  value?: string
  onActivate: () => void
  onDismiss: () => void
}) {
  const style = styles[tone]
  return (
    <div
      data-orderbook-trade-alert={kind}
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-[0_12px_28px_rgba(0,0,0,0.6)] ${style.shell}`}
    >
      <button
        type="button"
        data-no-drag
        onClick={onActivate}
        title={kind === "putthrough" ? "Xem lệnh thỏa thuận" : "Xem lệnh khớp tương ứng"}
        className="flex min-w-0 items-center gap-2 text-left"
      >
        <span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${style.icon}`}>{icon}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-sans">
          <span className={`font-bold ${style.label}`}>{label}</span>
          <span className="whitespace-nowrap font-mono font-bold text-foreground">{volume} CP</span>
          <span className="text-muted-2">@</span>
          <span className="whitespace-nowrap font-mono font-bold text-foreground">{price}</span>
          {value ? <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[11px] font-bold ${style.badge}`}>{value}</span> : null}
        </span>
      </button>
      <button
        type="button"
        data-no-drag
        onClick={onDismiss}
        aria-label={`Đóng thông báo ${label}`}
        className="shrink-0 rounded-full p-1 text-muted-2 hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
