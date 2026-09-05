import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, BookOpenText, CalendarDays, Search } from "lucide-react"

import { LandingLogin } from "@/components/auth/landing-login"
import { TopNav } from "@/components/top-nav"
import { getServerAuthContext } from "@/modules/auth/server"
import {
  getResearchReportCatalog,
  type ResearchReportCatalogItem,
  type ResearchReportCatalogQuery,
} from "@/modules/research-reports"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Báo cáo Research — QeoIndex",
  description: "Báo cáo vĩ mô, chiến lược và ngành đã được QeoIndex ingest, phân loại và phân tích có trích dẫn.",
  alternates: { canonical: "/insights/reports" },
}

type SearchParams = {
  category?: string | string[]
  q?: string | string[]
  source?: string | string[]
  from?: string | string[]
  to?: string | string[]
  page?: string | string[]
}

const CATEGORY_TABS = [
  { value: null, label: "Tất cả" },
  { value: "macro", label: "Vĩ mô tiền tệ" },
  { value: "strategy", label: "Chiến lược" },
  { value: "sector", label: "Ngành" },
] as const

function categoryLabel(category: ResearchReportCatalogItem["category"]) {
  if (category === "macro") return "Vĩ mô tiền tệ"
  if (category === "strategy") return "Chiến lược"
  if (category === "sector") return "Ngành"
  return "Khác"
}

function dateLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed)
}

function syncLabel(value: string | null) {
  if (!value) return "Chưa có dữ liệu đồng bộ"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}

function targetPriceLabel(value: number | null) {
  if (value === null) return null
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}

function statusView(item: ResearchReportCatalogItem) {
  if (item.ingestionStatus === "needs_ocr") return { label: "Cần OCR", className: "border-amber-400/25 bg-amber-400/10 text-amber-200" }
  if (item.ingestionStatus === "unsupported") return { label: "Không hỗ trợ", className: "border-slate-400/20 bg-slate-400/10 text-slate-300" }
  if (item.ingestionStatus === "failed") return { label: "Đọc PDF lỗi", className: "border-rose-400/25 bg-rose-400/10 text-rose-200" }
  if (item.analysisStatus === "ready") return { label: "Đã phân tích", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" }
  if (item.analysisStatus === "processing") return { label: "Đang xử lý", className: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200" }
  if (item.analysisStatus === "failed") return { label: "Phân tích lỗi", className: "border-rose-400/25 bg-rose-400/10 text-rose-200" }
  return { label: "Chưa phân tích", className: "border-white/10 bg-white/[0.04] text-slate-300" }
}

function catalogHref(query: ResearchReportCatalogQuery, patch: Partial<ResearchReportCatalogQuery>) {
  const next = { ...query, ...patch }
  const params = new URLSearchParams()
  if (next.category) params.set("category", next.category)
  if (next.search) params.set("q", next.search)
  if (next.source) params.set("source", next.source)
  if (next.fromDate) params.set("from", next.fromDate)
  if (next.toDate) params.set("to", next.toDate)
  if (next.page > 1) params.set("page", String(next.page))
  const suffix = params.toString()
  return suffix ? `/insights/reports?${suffix}` : "/insights/reports"
}

export default async function ResearchReportsCatalogPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />

  const rawQuery = searchParams ? await searchParams : {}
  let catalog
  try {
    catalog = await getResearchReportCatalog(
      auth.supabase as unknown as Parameters<typeof getResearchReportCatalog>[0],
      rawQuery,
    )
  } catch {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <TopNav />
        <main className="mx-auto max-w-[1500px] p-4 lg:p-6">
          <section className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.05] p-6">
            <h1 className="text-lg font-bold text-white">Báo cáo Research tạm thời chưa tải được</h1>
            <p className="mt-2 text-sm text-slate-400">Không thể đọc catalog lúc này. Dữ liệu nguồn và báo cáo đã lưu không bị thay đổi.</p>
          </section>
        </main>
      </div>
    )
  }

  const { query } = catalog

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto max-w-[1500px] space-y-5 p-4 lg:p-6">
        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-5 shadow-[0_18px_55px_-35px_rgba(0,0,0,0.9)] lg:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                <BookOpenText className="size-4" />
                Research Reports
              </div>
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Báo cáo phân tích thị trường</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Metadata từ nguồn báo cáo, trạng thái ingest và phân tích AI được hiển thị tách bạch. Khuyến nghị và giá mục tiêu là ý kiến của nguồn báo cáo, không phải khuyến nghị của QeoIndex.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/15 px-4 py-3 text-xs text-slate-400">
              <div className="font-semibold text-slate-300">Đồng bộ metadata gần nhất</div>
              <div className="mt-1 tabular-nums">{syncLabel(catalog.lastSuccessfulSyncAt)}</div>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-white/[0.08] bg-panel/55 p-4 lg:p-5">
          <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Danh mục báo cáo">
            {CATEGORY_TABS.map((tab) => {
              const active = query.category === tab.value
              return (
                <Link
                  key={tab.label}
                  href={catalogHref(query, { category: tab.value, page: 1 })}
                  prefetch={false}
                  className={[
                    "shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors",
                    active
                      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
                      : "border-white/[0.08] bg-black/10 text-slate-400 hover:border-white/15 hover:text-white",
                  ].join(" ")}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>

          <form method="get" action="/insights/reports" className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_minmax(150px,.7fr)_170px_170px_auto]">
            {query.category ? <input type="hidden" name="category" value={query.category} /> : null}
            <label className="relative block">
              <span className="sr-only">Tìm theo tiêu đề, nguồn hoặc ngành</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input
                name="q"
                defaultValue={query.search}
                placeholder="Tìm tiêu đề, nguồn, ngành..."
                className="h-10 w-full rounded-xl border border-white/[0.09] bg-black/15 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400/35"
              />
            </label>
            <label>
              <span className="sr-only">Nguồn báo cáo</span>
              <input
                name="source"
                defaultValue={query.source}
                placeholder="Nguồn, ví dụ ACBS"
                className="h-10 w-full rounded-xl border border-white/[0.09] bg-black/15 px-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400/35"
              />
            </label>
            <label className="relative">
              <span className="sr-only">Từ ngày</span>
              <input name="from" type="date" defaultValue={query.fromDate ?? ""} className="h-10 w-full rounded-xl border border-white/[0.09] bg-black/15 px-3 text-sm text-slate-300 outline-none focus:border-emerald-400/35" />
            </label>
            <label className="relative">
              <span className="sr-only">Đến ngày</span>
              <input name="to" type="date" defaultValue={query.toDate ?? ""} className="h-10 w-full rounded-xl border border-white/[0.09] bg-black/15 px-3 text-sm text-slate-300 outline-none focus:border-emerald-400/35" />
            </label>
            <button type="submit" className="h-10 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 text-xs font-black text-emerald-200 hover:bg-emerald-400/15">
              Lọc báo cáo
            </button>
          </form>
        </section>

        {catalog.hasDegradedRows ? (
          <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] px-4 py-3 text-xs leading-5 text-amber-100/80">
            Một số báo cáo trong trang này chưa xử lý hoàn tất hoặc đã fail-closed. Metadata vẫn được giữ để có thể mở nguồn/detail và kiểm tra trạng thái rõ ràng.
          </div>
        ) : null}

        <section aria-live="polite">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500"><span className="font-bold text-slate-300">{catalog.total}</span> báo cáo phù hợp</p>
            <p className="text-xs tabular-nums text-slate-500">Trang {query.page}/{catalog.totalPages}</p>
          </div>

          {catalog.items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.1] bg-panel/35 p-10 text-center">
              <CalendarDays className="mx-auto size-6 text-slate-600" />
              <h2 className="mt-3 text-sm font-bold text-slate-300">Không có báo cáo phù hợp</h2>
              <p className="mt-1 text-xs text-slate-500">Thử đổi danh mục, từ khóa, nguồn hoặc khoảng ngày.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {catalog.items.map((item) => {
                const status = statusView(item)
                const target = targetPriceLabel(item.targetPrice)
                return (
                  <article key={item.id} className="group flex min-w-0 flex-col rounded-2xl border border-white/[0.075] bg-panel/60 p-4 transition-colors hover:border-emerald-300/20 hover:bg-panel/80 sm:p-5">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full border border-white/[0.08] bg-black/15 px-2 py-1 font-bold text-slate-300">{categoryLabel(item.category)}</span>
                      <span className={`rounded-full border px-2 py-1 font-bold ${status.className}`}>{status.label}</span>
                      {item.code ? <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.05] px-2 py-1 font-black text-cyan-200">{item.code}</span> : null}
                    </div>

                    <h2 className="mt-3 text-base font-black leading-6 text-white sm:text-lg">{item.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="font-semibold text-slate-300">{item.sourceName}</span>
                      <span>{dateLabel(item.publishDate)}</span>
                      {item.sectorName ? <span>{item.sectorName}</span> : null}
                    </div>

                    {(item.recommendation || target) ? (
                      <div className="mt-4 flex flex-wrap gap-2 rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-3 text-xs">
                        <span className="font-bold text-amber-200/80">Ý kiến nguồn</span>
                        {item.recommendation ? <span className="text-slate-300">Khuyến nghị: <strong>{item.recommendation}</strong></span> : null}
                        {target ? <span className="text-slate-300">Giá mục tiêu: <strong>{target}</strong></span> : null}
                      </div>
                    ) : null}

                    <div className="mt-auto pt-4">
                      <Link href={`/research/reports/${item.id}`} prefetch={false} className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-300 hover:text-emerald-200">
                        Mở báo cáo
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <nav className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4" aria-label="Phân trang báo cáo">
          {query.page > 1 ? (
            <Link href={catalogHref(query, { page: query.page - 1 })} prefetch={false} className="rounded-xl border border-white/[0.09] bg-panel/60 px-3.5 py-2 text-xs font-bold text-slate-300 hover:text-white">
              Trang trước
            </Link>
          ) : <span />}
          {query.page < catalog.totalPages ? (
            <Link href={catalogHref(query, { page: query.page + 1 })} prefetch={false} className="rounded-xl border border-white/[0.09] bg-panel/60 px-3.5 py-2 text-xs font-bold text-slate-300 hover:text-white">
              Trang sau
            </Link>
          ) : <span />}
        </nav>
      </main>
    </div>
  )
}
