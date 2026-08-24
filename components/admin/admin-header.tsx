import Link from "next/link"
import { ArrowLeft, ShieldCheck, Terminal } from "lucide-react"

export interface AdminHeaderProps {
  actorUserId: string
}

export function AdminHeader({ actorUserId }: AdminHeaderProps) {
  const shortId = actorUserId.length > 12 ? `${actorUserId.slice(0, 8)}...${actorUserId.slice(-4)}` : actorUserId

  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.08] bg-[#090d13] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          prefetch={false}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.03] text-slate-300 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
          title="Quay lại Bảng điện"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-purple-500/20 text-emerald-400">
          <Terminal className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">Root Admin Control Plane</h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              <ShieldCheck className="h-3 w-3" />
              ROOT
            </span>
          </div>
          <p className="text-xs text-slate-400">Quản trị toàn diện runtime, telemetry tác vụ, và audit log</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="rounded-lg border border-white/[0.08] bg-[#0c1016] px-3 py-1.5 text-xs text-slate-300">
          <span className="text-slate-400">UID: </span>
          <span className="font-mono font-medium text-emerald-400" title={actorUserId}>
            {shortId}
          </span>
        </div>
      </div>
    </div>
  )
}
