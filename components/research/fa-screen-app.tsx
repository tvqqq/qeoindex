"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Database,
  ExternalLink,
  Info,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"

import { TickerResearchLink } from "@/components/ticker-research-link"
import { TopNav } from "@/components/top-nav"
import {
  FA_SCREEN_ROWS,
  FA_SCREEN_SNAPSHOT_DATE,
  FA_SCREEN_SOURCE,
  FA_VALUATION_ORDER,
  type FaScreenRow,
  type FaValuation,
} from "@/lib/fa-screen-data"

type SortKey = "rank" | "ticker" | "pe" | "pb" | "roe" | "grade" | "valuation"
type SortDirection = "asc" | "desc"

const VALUATION_STYLE: Record<FaValuation, string> = {
  "Rất hấp dẫn": "border-up/40 bg-up/12 text-up",
  "Hấp dẫn": "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  "Hợp lý": "border-ref/35 bg-ref/10 text-ref",
  "Khá cao": "border-amber-400/35 bg-amber-400/10 text-amber-300",
  "Đắt–rủi ro": "border-down/35 bg-down/10 text-down",
}

const SUMMARY_STYLE: Record<FaValuation, string> = {
  "Rất hấp dẫn": "border-up/30 bg-up/[0.06]",
  "Hấp dẫn": "border-emerald-500/25 bg-emerald-500/[0.05]",
  "Hợp lý": "border-ref/25 bg-ref/[0.05]",
  "Khá cao": "border-amber-400/25 bg-amber-400/[0.05]",
  "Đắt–rủi ro": "border-down/25 bg-down/[0.05]",
}

const SPECIAL_NOTES: Partial<Record<string, string>> = {
  VIC: "Premium rất cao so với ROE hiện tại; phải đọc bằng SOTP/optionality hơn là P/E thuần.",
  VHM: "P/E thấp và ROE tốt; NAV/SOTP hữu ích hơn P/E, cần haircut cash conversion và related-party risk.",
  MCH: "ROE rất cao nhưng P/B gần 10x; quality premium lớn nên không còn nhiều margin of safety.",
  LPB: "ROE tốt nhưng P/B rất cao; thị trường đã price-in một phần lớn kỳ vọng tăng trưởng.",
  STB: "P/E headline dễ méo; P/B trên 2x trong khi ROE hiện tại chưa đủ cao để gọi là rẻ.",
  HVN: "Turnaround nhưng lịch sử negative equity làm P/B/ROE rất khó đọc; cần ưu tiên balance sheet và normalized earnings.",
  BSR: "P/E thấp nhưng crack spread làm lợi nhuận chu kỳ; không nên capitalize peak earnings.",
  VRE: "P/B quanh 1.1x và ROE cải thiện; attractive nếu leasing cash flow và occupancy bền.",
  TPB: "P/B dưới 1x với ROE gần 18%; hấp dẫn nếu credit cost và NPL không xấu đi.",
  NVL: "P/B thấp không đồng nghĩa rẻ; leverage, pháp lý dự án và cash conversion quan trọng hơn multiple headline.",
  PGV: "P/E thấp, ROE cao; risk/reward tốt nếu fuel mix/PPA không tạo bất ngờ lớn.",
  PNJ: "ROE cao và P/E snapshot thấp; cần xác nhận EPS hiện tại là recurring trước khi coi đây là deep value.",
  DGC: "P/E thấp, P/B gần 1x và ROE >20%; valuation rất hấp dẫn nhưng vẫn phải normalize commodity cycle.",
  SIP: "P/E thấp, ROE cao; nên tách recurring KCN/utility income khỏi one-off trước khi nâng conviction.",
  BMP: "P/B premium nhưng được bù bằng ROE rất cao; cần theo dõi sustainability của margin và dividend.",
  VCG: "P/E cực thấp có thể bị one-off/project recognition làm méo; phải normalize trước khi gọi là undervalued.",
  ORS: "P/B thấp nhưng ROE chỉ quanh 2%; cheap book không đủ để tạo thesis value.",
  HAH: "ROE cao, P/E thấp; attractive nhưng freight cycle có thể đảo nhanh nên dùng mid-cycle earnings.",
}

function scoreOf(valuation: FaValuation) {
  return 5 - FA_VALUATION_ORDER.indexOf(valuation)
}

function analystNote(row: FaScreenRow) {
  const special = SPECIAL_NOTES[row.ticker]
  if (special) return special
  if (row.confidence === "Low–Medium") {
    return "Ratio có khả năng bị méo bởi chu kỳ, one-off hoặc cấu trúc vốn; cần DD sâu trước khi dùng làm tín hiệu định giá."
  }
  if (row.valuation === "Rất hấp dẫn") {
    return "Multiple/ROE cho thấy margin of safety tốt trên snapshot hiện tại; ưu tiên đưa vào danh sách DD sâu."
  }
  if (row.valuation === "Hấp dẫn") {
    return "Valuation có discount hoặc earnings yield tốt; cần xác nhận normalized earnings và chất lượng bảng cân đối."
  }
  if (row.valuation === "Hợp lý") {
    return "Giá đang phản ánh tương đối đầy đủ chất lượng hiện tại; upside cần catalyst hoặc tăng trưởng lợi nhuận mới."
  }
  if (row.valuation === "Khá cao") {
    return "Multiple đang premium; cần tăng trưởng lợi nhuận/ROE cao hơn để justify mức định giá."
  }
  return "Thiếu margin of safety trên earnings/return profile hiện tại hoặc balance-sheet risk đang lớn."
}

function sectorRisk(sector: string) {
  if (sector.includes("Ngân hàng")) return "NPL, credit cost, NIM, CASA"
  if (sector.includes("Chứng khoán")) return "Thanh khoản, tự doanh, margin lending"
  if (sector.includes("BĐS") || sector.includes("KCN")) return "Pháp lý, leverage, timing ghi nhận"
  if (sector.includes("Hàng không")) return "Fuel, FX, lease liabilities"
  if (sector.includes("Thép")) return "ASP, nguyên liệu, chu kỳ xây dựng"
  if (sector.includes("Phân bón") || sector.includes("Hóa chất")) return "Commodity cycle, giá đầu vào"
  if (sector.includes("Điện") || sector.includes("Thủy điện")) return "PPA, fuel/hydrology, EVN receivables"
  if (sector.includes("Bán lẻ") || sector.includes("Tiêu dùng")) return "Sức mua, biên gộp, working capital"
  if (sector.includes("Vận tải") || sector.includes("Logistics") || sector.includes("Cảng")) return "Cước/sản lượng, fleet/capex cycle"
  if (sector.includes("Nông nghiệp")) return "Giá đầu ra, dịch bệnh, feed cost"
  return "Earnings quality, balance sheet, execution"
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />
  return direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
}

function HeaderButton({ label, sortKey, currentKey, direction, onSort }: { label: string; sortKey: SortKey; currentKey: SortKey; direction: SortDirection; onSort: (key: SortKey) => void }) {
  return (
    <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-foreground/65 transition-colors hover:text-foreground">
      {label}
      <SortIcon active={currentKey === sortKey} direction={direction} />
    </button>
  )
}

function formatMultiple(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(2)}x` : "—"
}

function sourceUrl(ticker: string, source: "24h" | "rua") {
  return source === "24h"
    ? `https://24hmoney.vn/stock/${ticker}/financial-indicators`
    : `https://ruatichsan.com/company?symbol=${ticker}`
}

export function FaScreenApp() {
  const [query, setQuery] = useState("")
  const [valuation, setValuation] = useState<FaValuation | "Tất cả">("Tất cả")
  const [grade, setGrade] = useState("Tất cả")
  const [sector, setSector] = useState("Tất cả")
  const [sortKey, setSortKey] = useState<SortKey>("rank")
  const [direction, setDirection] = useState<SortDirection>("asc")

  const sectors = useMemo(() => [...new Set(FA_SCREEN_ROWS.map((row) => row.sector))].sort((a, b) => a.localeCompare(b, "vi")), [])
  const grades = useMemo(() => [...new Set(FA_SCREEN_ROWS.map((row) => row.grade))].sort((a, b) => a.localeCompare(b)), [])

  const counts = useMemo(() => {
    const result = new Map<FaValuation, number>()
    FA_VALUATION_ORDER.forEach((item) => result.set(item, 0))
    FA_SCREEN_ROWS.forEach((row) => result.set(row.valuation, (result.get(row.valuation) ?? 0) + 1))
    return result
  }, [])

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleUpperCase("vi")
    return FA_SCREEN_ROWS.filter((row) => {
      const matchesQuery = !normalized || row.ticker.includes(normalized) || row.sector.toLocaleUpperCase("vi").includes(normalized)
      const matchesValuation = valuation === "Tất cả" || row.valuation === valuation
      const matchesGrade = grade === "Tất cả" || row.grade === grade
      const matchesSector = sector === "Tất cả" || row.sector === sector
      return matchesQuery && matchesValuation && matchesGrade && matchesSector
    }).sort((a, b) => {
      let compared = 0
      if (sortKey === "ticker" || sortKey === "grade") compared = a[sortKey].localeCompare(b[sortKey])
      else if (sortKey === "valuation") compared = scoreOf(a.valuation) - scoreOf(b.valuation)
      else compared = a[sortKey] - b[sortKey]
      return direction === "asc" ? compared : -compared
    })
  }, [direction, grade, query, sector, sortKey, valuation])

  const attractiveCount = (counts.get("Rất hấp dẫn") ?? 0) + (counts.get("Hấp dẫn") ?? 0)
  const lowConfidenceCount = FA_SCREEN_ROWS.filter((row) => row.confidence === "Low–Medium").length

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setDirection(key === "valuation" || key === "roe" ? "desc" : "asc")
  }

  function clearFilters() {
    setQuery("")
    setValuation("Tất cả")
    setGrade("Tất cả")
    setSector("Tất cả")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      <main className="mx-auto max-w-[1800px] px-4 py-6 lg:px-6">
        <section className="rounded-2xl border border-border bg-panel p-5 lg:p-6">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
            <div className="max-w-5xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground lg:text-3xl">FA & Định giá — Top 100 HOSE</h1>
                <span className="rounded-md border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">Snapshot {FA_SCREEN_SNAPSHOT_DATE}</span>
              </div>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-foreground/65">
                Screening nhanh 99 mã, loại MSN vì đã có thesis riêng. Trọng tâm là định giá tương đối theo ngành: P/B + ROE cho bank, normalized earnings cho cyclical, NAV/SOTP cho BĐS và P/E/EV-EBITDA cho doanh nghiệp vận hành.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-foreground/55">
                <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Primary quantitative source: {FA_SCREEN_SOURCE}</span>
                <span className="inline-flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> Đây là research snapshot, không thay thế Notion Top 100 membership.</span>
              </div>
            </div>
            <Link href="/research/msn" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border-strong bg-panel-2 px-4 py-2.5 text-sm font-semibold text-foreground/80 transition-colors hover:border-brand/40 hover:text-brand">
              MSN thesis riêng <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {FA_VALUATION_ORDER.map((item) => {
            const active = valuation === item
            return (
              <button
                key={item}
                type="button"
                onClick={() => setValuation(active ? "Tất cả" : item)}
                className={["rounded-xl border p-4 text-left transition-[color,background-color,border-color,transform] duration-150", SUMMARY_STYLE[item], active ? "ring-1 ring-brand/60" : "hover:-translate-y-0.5 hover:border-border-strong"].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${VALUATION_STYLE[item]}`}>{item}</span>
                  <span className="font-mono text-2xl font-semibold text-foreground">{counts.get(item) ?? 0}</span>
                </div>
                <div className="mt-2 text-xs text-foreground/50">{Math.round(((counts.get(item) ?? 0) / FA_SCREEN_ROWS.length) * 100)}% universe snapshot</div>
              </button>
            )
          })}
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/70"><Sparkles className="h-4 w-4 text-up" /> Attractive+</div>
            <div className="mt-2 font-mono text-2xl font-semibold">{attractiveCount}/99</div>
            <p className="mt-1 text-xs leading-5 text-foreground/50">Rất hấp dẫn + Hấp dẫn. Đây là priority DD queue, không phải danh sách BUY.</p>
          </div>
          <div className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground/70"><ShieldAlert className="h-4 w-4 text-amber-300" /> Confidence thấp hơn</div>
            <div className="mt-2 font-mono text-2xl font-semibold">{lowConfidenceCount}</div>
            <p className="mt-1 text-xs leading-5 text-foreground/50">Các mã có ratio dễ méo bởi one-off, chu kỳ, new listing hoặc cấu trúc vốn.</p>
          </div>
          <div className="rounded-xl border border-border bg-panel p-4">
            <div className="text-sm font-semibold text-foreground/70">Universe snapshot</div>
            <div className="mt-2 font-mono text-2xl font-semibold">99 mã</div>
            <p className="mt-1 text-xs leading-5 text-foreground/50">Rank 23 là MSN và được loại khỏi bảng vì QeoIndex đã có FA thesis riêng.</p>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-border bg-panel p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground/70"><SlidersHorizontal className="h-4 w-4" /> Bộ lọc</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.4fr)_1fr_1fr_1.3fr_auto]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm ticker hoặc ngành…" className="h-10 w-full rounded-lg border border-border-strong bg-panel-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-foreground/35 focus:border-brand/50" />
            </label>
            <select value={valuation} onChange={(event) => setValuation(event.target.value as FaValuation | "Tất cả")} className="h-10 rounded-lg border border-border-strong bg-panel-2 px-3 text-sm text-foreground outline-none focus:border-brand/50">
              <option>Tất cả</option>
              {FA_VALUATION_ORDER.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={grade} onChange={(event) => setGrade(event.target.value)} className="h-10 rounded-lg border border-border-strong bg-panel-2 px-3 text-sm text-foreground outline-none focus:border-brand/50">
              <option>Tất cả</option>
              {grades.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={sector} onChange={(event) => setSector(event.target.value)} className="h-10 rounded-lg border border-border-strong bg-panel-2 px-3 text-sm text-foreground outline-none focus:border-brand/50">
              <option>Tất cả</option>
              {sectors.map((item) => <option key={item}>{item}</option>)}
            </select>
            <button type="button" onClick={clearFilters} className="h-10 rounded-lg border border-border-strong px-4 text-sm font-medium text-foreground/65 transition-colors hover:bg-panel-2 hover:text-foreground">Xóa lọc</button>
          </div>
          <div className="mt-3 text-xs text-foreground/50">Hiển thị <span className="font-mono font-semibold text-foreground/75">{filteredRows.length}</span> / 99 mã</div>
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-border bg-panel">
          <div className="overflow-x-auto">
            <table className="min-w-[1380px] w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-panel-2">
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground/50">
                  <th className="px-4 py-3"><HeaderButton label="Rank" sortKey="rank" currentKey={sortKey} direction={direction} onSort={onSort} /></th>
                  <th className="px-4 py-3"><HeaderButton label="Ticker" sortKey="ticker" currentKey={sortKey} direction={direction} onSort={onSort} /></th>
                  <th className="px-4 py-3">Ngành</th>
                  <th className="px-4 py-3 text-right"><HeaderButton label="P/E" sortKey="pe" currentKey={sortKey} direction={direction} onSort={onSort} /></th>
                  <th className="px-4 py-3 text-right"><HeaderButton label="P/B" sortKey="pb" currentKey={sortKey} direction={direction} onSort={onSort} /></th>
                  <th className="px-4 py-3 text-right"><HeaderButton label="ROE" sortKey="roe" currentKey={sortKey} direction={direction} onSort={onSort} /></th>
                  <th className="px-4 py-3"><HeaderButton label="FA Grade" sortKey="grade" currentKey={sortKey} direction={direction} onSort={onSort} /></th>
                  <th className="px-4 py-3"><HeaderButton label="Định giá" sortKey="valuation" currentKey={sortKey} direction={direction} onSort={onSort} /></th>
                  <th className="px-4 py-3">Quick FA / DD note</th>
                  <th className="px-4 py-3">Risk chính</th>
                  <th className="px-4 py-3">Nguồn</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.ticker} className="border-b border-border/70 align-top transition-colors last:border-b-0 hover:bg-panel-2/55">
                    <td className="px-4 py-3 font-mono text-xs text-foreground/45">#{row.rank}</td>
                    <td className="px-4 py-3">
                      <TickerResearchLink ticker={row.ticker} className="font-mono text-base font-bold text-foreground transition-colors hover:text-brand">{row.ticker}</TickerResearchLink>
                      {row.confidence === "Low–Medium" && <div className="mt-1 text-[11px] font-medium text-amber-300">Low–Medium confidence</div>}
                    </td>
                    <td className="max-w-[180px] px-4 py-3 text-foreground/65">{row.sector}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-foreground/80">{formatMultiple(row.pe)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${row.pb < 0 ? "text-down" : "text-foreground/80"}`}>{formatMultiple(row.pb)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${row.roe < 0 ? "text-down" : row.roe >= 20 ? "text-up" : "text-foreground/80"}`}>{row.roe.toFixed(1)}%</td>
                    <td className="px-4 py-3"><span className="inline-flex min-w-9 items-center justify-center rounded-md border border-border-strong bg-panel-2 px-2 py-1 font-mono text-xs font-bold text-foreground/80">{row.grade}</span></td>
                    <td className="px-4 py-3"><span className={`inline-flex whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold ${VALUATION_STYLE[row.valuation]}`}>{row.valuation}</span></td>
                    <td className="max-w-[360px] px-4 py-3 text-xs leading-5 text-foreground/65">{analystNote(row)}</td>
                    <td className="max-w-[220px] px-4 py-3 text-xs leading-5 text-foreground/55">{sectorRisk(row.sector)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1.5 text-xs">
                        <a href={sourceUrl(row.ticker, "24h")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground/55 hover:text-brand">24HMoney <ExternalLink className="h-3 w-3" /></a>
                        <a href={sourceUrl(row.ticker, "rua")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground/55 hover:text-brand">Rùa Tích Sản <ExternalLink className="h-3 w-3" /></a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredRows.length === 0 && <div className="px-6 py-14 text-center text-sm text-foreground/55">Không có mã nào khớp bộ lọc hiện tại.</div>}
        </section>

        <section className="mt-5 rounded-xl border border-border bg-panel p-5 text-sm leading-6 text-foreground/60">
          <h2 className="font-semibold text-foreground">Cách đọc bảng</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong className="text-foreground/80">Rất hấp dẫn / Hấp dẫn</strong> là priority DD queue, không phải tín hiệu mua tự động.</li>
            <li>Bank ưu tiên P/B + ROE + asset quality; BĐS ưu tiên NAV/SOTP + leverage; cyclical phải normalize earnings thay vì lấy trailing P/E ở peak cycle.</li>
            <li>Low–Medium confidence nghĩa là ratio có rủi ro méo; cần đọc BCTC/IR/broker evidence trước khi nâng conviction.</li>
            <li>Snapshot cố định ngày {FA_SCREEN_SNAPSHOT_DATE}; giá và multiples sẽ thay đổi theo thị trường.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}