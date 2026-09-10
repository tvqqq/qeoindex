import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  BookOpenText,
  Building2,
  CalendarDays,
  Compass,
  Factory,
  FileText,
  Landmark,
  Lightbulb,
  Search,
  Sparkles,
} from "lucide-react"

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
  alternates: { canonical: "/reports" },
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

function categoryIcon(category: ResearchReportCatalogItem["category"]) {
  if (category === "macro") return <Landmark className="size-5" aria-hidden="true" />
  if (category === "strategy") return <Compass className="size-5" aria-hidden="true" />
  if (category === "sector") return <Factory className="size-5" aria-hidden="true" />
  return <FileText className="size-5" aria-hidden="true" />
}

function categoryIconClass(category: ResearchReportCatalogItem["category"]) {
  if (category === "macro") return "border-emerald-300/30 bg-emerald-400/[0.08] text-emerald-300"
  if (category === "strategy") return "border-cyan-300/30 bg-cyan-400/[0.08] text-cyan-300"
  if (category === "sector") return "border-amber-300/30 bg-amber-400/[0.08] text-amber-300"
  return "border-violet-300/30 bg-violet-400/[0.08] text-violet-300"
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

function targetPriceLabel(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value)
}

function statusView(item: ResearchReportCatalogItem) {
  if (item.ingestionStatus === "needs_ocr") return { label: "Cần OCR", className: "border-amber-400/30 bg-amber-400/[0.09] text-amber-200" }
  if (item.ingestionStatus === "unsupported") return { label: "Không hỗ trợ", className: "border-slate-400/25 bg-slate-400/[0.07] text-slate-300" }
  if (item.ingestionStatus === "failed") return { label: "Đọc PDF lỗi", className: "border-slate-400/25 bg-slate-400/[0.07] text-slate-300" }
  if (item.analysisStatus === "ready") return { label: "Đã phân tích", className: "border-emerald-400/30 bg-emerald-400/[0.09] text-emerald-200" }
  if (item.analysisStatus === "processing") return { label: "Đang xử lý", className: "border-cyan-400/30 bg-cyan-400/[0.09] text-cyan-200" }
  if (item.analysisStatus === "failed") return { label: "Phân tích lỗi", className: "border-slate-400/25 bg-slate-400/[0.07] text-slate-300" }
  return { label: "Chưa phân tích", className: "border-violet-400/25 bg-violet-400/[0.07] text-violet-200" }
}

function descriptionView(item: ResearchReportCatalogItem) {
  if (item.description) return item.description
  if (item.analysisStatus === "ready") return "Chưa có mô tả tóm tắt cho phiên bản phân tích hiện tại."
  if (item.analysisStatus === "processing") return "Mô tả sẽ hiển thị sau khi AI hoàn tất phân tích báo cáo."
  return "Mô tả sẽ được trích xuất khi báo cáo hoàn tất quy trình phân tích."
}

function recommendationView(item: ResearchReportCatalogItem) {
  const rawRecommendation = item.recommendation?.trim() || "Chưa có"
  const normalized = rawRecommendation.toUpperCase()
  const isTradeAction = /^(MUA|BÁN)$/.test(normalized)
  const primary = isTradeAction && item.code ? `${normalized} ${item.code}` : rawRecommendation
  const target = isTradeAction && item.targetPrice !== null
    ? `Mục tiêu ${targetPriceLabel(item.targetPrice)}`
    : null

  return { primary, target }
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
  return suffix ? `/reports?${suffix}` : "/reports"
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

          <form method="get" action="/reports" className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_minmax(150px,.7fr)_170px_170px_auto]">
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
            <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
              {catalog.items.map((item) => {
                const status = statusView(item)
                const recommendation = recommendationView(item)
                return (
                  <article
                    key={item.id}
                    className="group relative flex h-full min-h-[440px] min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/[0.09] bg-[linear-gradient(145deg,rgba(25,28,31,0.94),rgba(10,14,17,0.98))] p-5 shadow-[0_22px_55px_-38px_rgba(0,0,0,0.95)] transition-colors hover:border-emerald-300/25 sm:p-6"
                  >
                    <Link
                      href={`/research/reports/${item.id}`}
                      prefetch={false}
                      aria-label={`Xem chi tiết báo cáo: ${item.title}`}
                      className="absolute inset-0 z-0 rounded-[28px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300/60"
                    >
                      <span className="sr-only">Xem chi tiết báo cáo</span>
                    </Link>

                    <div className="pointer-events-none relative z-10 flex h-full min-h-0 flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex size-11 shrink-0 items-center justify-center rounded-full border shadow-[inset_0_0_18px_rgba(255,255,255,0.025)] ${categoryIconClass(item.category)}`}>
                            {categoryIcon(item.category)}
                          </span>
                          <span className="truncate rounded-full border border-white/[0.1] bg-black/20 px-3 py-1.5 text-xs font-bold text-slate-200">
                            {categoryLabel(item.category)}
                          </span>
                        </div>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.035] text-slate-400 transition-colors group-hover:border-emerald-300/20 group-hover:text-emerald-200">
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                      </div>

                      <h2 className="mt-5 min-h-[84px] line-clamp-3 text-lg font-black leading-7 tracking-tight text-white sm:text-xl">
                        {item.title}
                      </h2>
                      <p className="mt-3 h-[60px] line-clamp-3 text-sm leading-5 text-slate-400">
                        {descriptionView(item)}
                      </p>

                      <div className="mt-5 grid grid-cols-2 gap-2.5">
                        <div className={`h-[98px] min-w-0 rounded-2xl border p-3.5 ${status.className}`}>
                          <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-75">TRẠNG THÁI AI</div>
                          <div className="mt-2 flex min-w-0 items-center gap-2 text-sm font-black sm:text-base">
                            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
                            <span className="truncate">{status.label}</span>
                          </div>
                        </div>
                        <div className="h-[98px] min-w-0 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] p-3.5 text-amber-100">
                          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200/70">KHUYẾN NGHỊ</div>
                          <div className="mt-2 flex min-w-0 items-center gap-2 text-sm font-black sm:text-base">
                            <Lightbulb className="size-4 shrink-0 text-amber-300" aria-hidden="true" />
                            <span className="truncate">{recommendation.primary}</span>
                          </div>
                          {recommendation.target ? (
                            <div className="mt-1 truncate pl-6 text-[11px] font-semibold text-amber-200/75">{recommendation.target}</div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-auto pt-5">
                        <div className="border-t border-white/[0.075] pt-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/reports?source=${encodeURIComponent(item.sourceName)}`}
                              prefetch={false}
                              aria-label={`Lọc báo cáo từ ${item.sourceName}`}
                              className="pointer-events-auto relative z-20 inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.035] px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.06] hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                            >
                              <Building2 className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                              <span className="truncate">{item.sourceName}</span>
                            </Link>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.035] px-2.5 py-1.5 text-[11px] font-bold tabular-nums text-slate-300">
                              <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                              {dateLabel(item.publishDate)}
                            </span>
                          </div>
                        </div>
                      </div>
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
