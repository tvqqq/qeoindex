import Link from "next/link"
import { ArrowLeft, Cpu, Key, ShieldCheck } from "lucide-react"

export interface AdminHeaderProps {
  actorUserId: string
}

export function AdminHeader({ actorUserId }: AdminHeaderProps) {
  const shortId = actorUserId.length > 12 ? `${actorUserId.slice(0, 8)}...${actorUserId.slice(-4)}` : actorUserId

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#070a0f]/95">
      <div className="mx-auto flex max-w-7xl flex-col gap-3.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-3.5">
          <Link
            href="/"
            prefetch={false}
            className="group flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-[#0c1017] text-slate-400 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
            title="Quay lại Bảng điện"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </Link>

          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Cpu className="h-4 w-4" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">QeoIndex</span>
                <span className="text-slate-600">/</span>
                <h1 className="text-sm font-bold tracking-tight text-white sm:text-base">Root Control Plane</h1>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <ShieldCheck className="h-3 w-3" />
                ROOT
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Điều khiển và giám sát toàn diện runtime, telemetry tác vụ, và audit log</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#0a0e14] px-2.5 py-1.5 text-xs text-slate-300">
            <span className="flex h-2 w-2 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[11px] font-medium text-slate-400">Status:</span>
            <span className="font-mono text-[11px] font-semibold text-emerald-400">ACTIVE</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#0a0e14] px-2.5 py-1.5 text-xs text-slate-300">
            <Key className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] text-slate-400">Actor:</span>
            <span className="font-mono text-[11px] font-semibold text-slate-200" title={actorUserId}>
              {shortId}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
