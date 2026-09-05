"use client"

export function ReportCitation({
  page,
  excerpt,
  onNavigate,
}: {
  page: number
  excerpt?: string
  onNavigate: (page: number) => void
}) {
  return (
    <button
      type="button"
      aria-label={`Mở trang ${page} của báo cáo`}
      title={excerpt ?? `Trang ${page}`}
      onClick={() => onNavigate(page)}
      className="inline-flex min-h-8 items-center rounded-md border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      Trang {page}
    </button>
  )
}
