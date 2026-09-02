import { BRAND } from "@/lib/brand"

const ROWS = Array.from({ length: 9 }, (_, index) => index)

export default function MarketBoardLoading() {
  return (
    <main
      className="flex min-h-screen flex-col overflow-hidden bg-[#05080b] text-slate-100"
      aria-live="polite"
      aria-busy="true"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#071017]/95 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05]">
            <img src="/brand/stockos-mark.svg" alt="" className="h-6 w-6" />
          </div>
          <div>
            <p className="font-ticker text-sm font-extrabold italic tracking-tight text-white">{BRAND.name}</p>
            <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-slate-600">Bảng điện realtime</p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-200/80">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
          Đang tải Bảng điện
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-16 rounded-xl border border-white/[0.06] bg-white/[0.025]" />
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-[#071017]/70">
          <div className="grid h-9 grid-cols-[80px_1fr_1fr_1fr_1fr] items-center gap-3 border-b border-white/[0.06] px-3 font-mono text-[8px] uppercase tracking-[0.14em] text-slate-600">
            <span>Mã</span>
            <span>Giá</span>
            <span>Thay đổi</span>
            <span>Khối lượng</span>
            <span>Đồ thị</span>
          </div>
          <div>
            {ROWS.map((row) => (
              <div
                key={row}
                className="grid h-12 grid-cols-[80px_1fr_1fr_1fr_1fr] items-center gap-3 border-b border-white/[0.04] px-3"
              >
                <div className="h-3 w-10 animate-pulse rounded bg-white/[0.08]" />
                <div className="h-2.5 w-14 animate-pulse rounded bg-white/[0.055]" />
                <div className="h-2.5 w-12 animate-pulse rounded bg-white/[0.055]" />
                <div className="h-2.5 w-20 animate-pulse rounded bg-white/[0.055]" />
                <div className="h-5 w-full max-w-28 animate-pulse rounded bg-emerald-300/[0.04]" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
