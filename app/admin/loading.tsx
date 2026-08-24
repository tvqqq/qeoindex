export default function AdminLoading() {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-400" />
        <span className="font-mono text-xs text-slate-400">Đang tải dữ liệu Control Plane...</span>
      </div>
    </div>
  )
}
