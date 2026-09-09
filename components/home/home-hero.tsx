import Link from "next/link"
import {
  BarChart3,
  Briefcase,
  PieChart,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react"

import {
  HomeStockSearch,
  type HomeStockSearchStock,
} from "@/components/home/home-stock-search"
import type { HomeHeroData } from "@/modules/home/hero-data"

import styles from "./home-hero.module.css"

function formatIndex(value: number | null) {
  if (value == null) return "—"
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPercent(value: number | null, withSign = false) {
  if (value == null) return "—"
  const sign = withSign && value > 0 ? "+" : ""
  return `${sign}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)}%`
}

function formatVnd(value: number | null) {
  if (value == null) return "—"
  const absolute = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  if (absolute >= 1_000_000_000) {
    return `${sign}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(absolute / 1_000_000_000)} tỷ`
  }
  if (absolute >= 1_000_000) {
    return `${sign}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(absolute / 1_000_000)} tr`
  }
  if (absolute >= 1_000) {
    return `${sign}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(absolute / 1_000)} nghìn`
  }
  return `${sign}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(absolute)} ₫`
}

function formatSessionDate(value: string | null) {
  if (!value) return "snapshot gần nhất"
  const parts = value.split("-")
  if (parts.length !== 3) return value
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function formatSnapshotTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date)
}

function MarketObject({ data }: { data: HomeHeroData["market"] }) {
  const positive = data.changePct != null && data.changePct >= 0
  const ChangeIcon = positive ? TrendingUp : TrendingDown
  const breadthAvailable = data.advances != null && data.declines != null
  const freshTime = formatSnapshotTime(data.snapshotUpdatedAt)

  return (
    <div className={`order-2 flex min-w-0 items-center justify-center lg:order-1 ${styles.marketEnter}`}>
      <div className="w-full max-w-[390px] lg:max-w-none">
        <div className="mb-4 pl-3 lg:pl-8">
          <div className="text-sm font-black tracking-tight text-white sm:text-base">VNINDEX</div>
          <div className="mt-1 text-xs text-slate-500">
            {freshTime ? `Cập nhật ${freshTime} · khi tải trang` : `Market snapshot · ${formatSessionDate(data.sessionDate)}`}
          </div>
        </div>

        <Link
          href="/insights"
          prefetch={false}
          aria-label="Mở Insights thị trường"
          className="group/market relative mx-auto block w-[78%] max-w-[310px] -rotate-[5deg] rounded-[34px] border border-lime-300/25 bg-[#c9fb59] p-1 shadow-[0_42px_80px_-38px_rgba(163,230,53,0.42)] transition-[transform,box-shadow,border-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-2 hover:rotate-0 hover:scale-[1.025] hover:border-lime-200/50 hover:shadow-[0_54px_92px_-38px_rgba(163,230,53,0.58)] focus-visible:rotate-0 motion-reduce:transform-none motion-reduce:transition-none lg:w-[82%]"
        >
          <div className="relative aspect-[0.76] overflow-hidden rounded-[30px] bg-gradient-to-br from-[#e9ffad] via-[#c7f84d] to-[#8bd20d] p-6 text-[#111317] sm:p-7">
            <div aria-hidden="true" className="absolute -right-16 -top-10 h-48 w-48 rounded-full border border-black/10" />
            <div aria-hidden="true" className="absolute -right-8 top-2 h-36 w-36 rounded-full border border-black/10" />
            <div aria-hidden="true" className="absolute bottom-20 left-[-18%] h-px w-[140%] -rotate-[12deg] bg-black/10" />
            <div aria-hidden="true" className="absolute bottom-28 left-[-18%] h-px w-[140%] rotate-[8deg] bg-black/10" />

            <div className="relative flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#111317] text-[#c9fb59]">
                <BarChart3 className="h-5 w-5" strokeWidth={2.4} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-black/45">QEO Market</span>
            </div>

            <div className="relative mt-12">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-black/45">Chỉ số</div>
              <div className="mt-2 text-4xl font-black tracking-[-0.045em] sm:text-5xl">{formatIndex(data.vnindexValue)}</div>
              <div className="mt-3 flex items-center gap-2 text-sm font-bold text-black/65">
                <ChangeIcon className="h-4 w-4" />
                <span>{formatPercent(data.changePct, true)}</span>
              </div>
            </div>

            <div className="absolute bottom-6 left-6 right-6 rounded-2xl border border-black/10 bg-black/[0.08] px-4 py-3 sm:bottom-7 sm:left-7 sm:right-7">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-black/45">Độ rộng</span>
                <span className="text-xs font-black">
                  {breadthAvailable ? `${data.advances} tăng · ${data.declines} giảm` : "Chưa có dữ liệu"}
                </span>
              </div>
            </div>
          </div>

          <div className={`${styles.badgeEnter} absolute -right-8 top-[18%] rounded-2xl border border-white/10 bg-[#202328] px-4 py-3 text-left shadow-[0_18px_38px_-16px_rgba(0,0,0,0.9)] transition-transform duration-500 group-hover/market:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none`}>
            <div className={positive ? "text-base font-black text-emerald-300" : "text-base font-black text-rose-300"}>
              {formatPercent(data.changePct, true)}
            </div>
            <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.13em] text-slate-500">
              {freshTime ? "Lúc refresh" : "Phiên gần nhất"}
            </div>
          </div>

          <div className={`${styles.badgeEnter} absolute -bottom-5 -left-10 max-w-[190px] rounded-2xl border border-white/10 bg-[#202328] px-4 py-3 shadow-[0_18px_38px_-16px_rgba(0,0,0,0.9)] transition-transform duration-500 group-hover/market:-translate-x-1 motion-reduce:transform-none motion-reduce:transition-none`}>
            <div className="text-[9px] font-black uppercase tracking-[0.13em] text-slate-500">Dẫn dắt 1D</div>
            <div className="mt-1 truncate text-xs font-bold text-white">{data.leadingSector ?? "Chưa xác định"}</div>
          </div>
        </Link>
      </div>
    </div>
  )
}

function CenterNarrative({ data, stocks }: { data: HomeHeroData; stocks: readonly HomeStockSearchStock[] }) {
  return (
    <div className={`order-1 flex min-w-0 flex-col items-center justify-center px-1 text-center lg:order-2 ${styles.centerEnter}`}>
      <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-[#d5ff63]" aria-hidden="true" />
        QEO Market Pulse · {formatSessionDate(data.market.sessionDate)}
      </div>

      <h1 id="home-market-pulse-title" className="mt-6 max-w-[720px] text-[clamp(2.7rem,5.5vw,5.25rem)] font-black leading-[0.94] tracking-[-0.065em] text-white">
        {data.headline.split("\n").map((line) => (
          <span key={line} className="block">{line}</span>
        ))}
      </h1>

      <div className="mt-5 text-sm font-bold text-slate-500">
        Market structure <span className="mx-1.5 text-[#d5ff63]">×</span> Portfolio discipline
      </div>

      <div className="mt-9 w-full">
        <h2 className="text-xl font-black tracking-[-0.03em] text-white sm:text-2xl">Bạn muốn hỏi cổ phiếu nào?</h2>
        <HomeStockSearch stocks={stocks} />
      </div>

      <noscript>
        <nav aria-label="Lối tắt khi JavaScript bị tắt" className="hidden">
          <a href="/board">Bảng điện</a>
          <a href="/reports">Research</a>
        </nav>
      </noscript>
    </div>
  )
}

function PortfolioObject({ data }: { data: HomeHeroData["portfolio"] }) {
  const hasExposure = data.exposurePct != null
  const exposureWidth = Math.min(100, Math.max(0, data.exposurePct ?? 0))
  const realizedPositive = (data.realizedPnlVnd ?? 0) >= 0

  return (
    <div className={`order-3 flex min-w-0 items-center justify-center ${styles.portfolioEnter}`}>
      <div className="w-full max-w-[390px] lg:max-w-none">
        <div className="mb-4 pr-3 text-right lg:pr-8">
          <div className="text-sm font-black tracking-tight text-white sm:text-base">My Portfolio</div>
          <div className="mt-1 truncate text-xs text-slate-500">{data.hasPortfolio ? data.name : "Chưa có danh mục"}</div>
        </div>

        <Link
          href="/portfolio"
          prefetch={false}
          aria-label="Mở danh mục đầu tư"
          className="group/portfolio relative mx-auto block w-[78%] max-w-[310px] rotate-[5deg] rounded-[34px] border border-violet-300/25 bg-[#b58cff] p-1 shadow-[0_42px_80px_-38px_rgba(139,92,246,0.46)] transition-[transform,box-shadow,border-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-2 hover:rotate-0 hover:scale-[1.025] hover:border-violet-200/50 hover:shadow-[0_54px_92px_-38px_rgba(139,92,246,0.62)] focus-visible:rotate-0 motion-reduce:transform-none motion-reduce:transition-none lg:w-[82%]"
        >
          <div className="relative aspect-[0.76] overflow-hidden rounded-[30px] bg-gradient-to-br from-[#f2e8ff] via-[#c6a2ff] to-[#8b5cf6] p-6 text-[#111317] sm:p-7">
            <div aria-hidden="true" className="absolute -left-14 -top-14 h-52 w-52 rounded-full border border-black/10" />
            <div aria-hidden="true" className="absolute -left-4 -top-4 h-36 w-36 rounded-full border border-black/10" />
            <div aria-hidden="true" className="absolute bottom-24 right-[-16%] h-px w-[130%] rotate-[13deg] bg-black/10" />

            <div className="relative flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#111317] text-[#c6a2ff]">
                <Briefcase className="h-5 w-5" strokeWidth={2.4} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-black/45">QEO Portfolio</span>
            </div>

            <div className="relative mt-12">
              <div className="max-w-[190px] truncate text-xs font-bold uppercase tracking-[0.14em] text-black/45">{data.name}</div>
              <div className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                {data.hasPortfolio ? formatVnd(data.deployedCapitalVnd) : "Bắt đầu"}
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm font-bold text-black/60">
                <WalletCards className="h-4 w-4" />
                <span>{data.hasPortfolio ? `${data.openPositionCount} vị thế đang mở` : "Tạo danh mục đầu tiên"}</span>
              </div>
            </div>

            <div className="absolute bottom-6 left-6 right-6 sm:bottom-7 sm:left-7 sm:right-7">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.12em] text-black/45">
                <span>Vốn đang dùng</span>
                <span>{hasExposure ? formatPercent(data.exposurePct) : "—"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
                <div className="h-full rounded-full bg-[#111317]" style={{ width: `${exposureWidth}%` }} />
              </div>
            </div>
          </div>

          <div className={`${styles.badgeEnter} absolute -left-8 top-[18%] rounded-2xl border border-white/10 bg-[#202328] px-4 py-3 text-left shadow-[0_18px_38px_-16px_rgba(0,0,0,0.9)] transition-transform duration-500 group-hover/portfolio:-translate-x-1 motion-reduce:transform-none motion-reduce:transition-none`}>
            <div className="text-base font-black text-violet-300">{hasExposure ? formatPercent(data.exposurePct) : "—"}</div>
            <div className="mt-0.5 text-[9px] font-black uppercase tracking-[0.13em] text-slate-500">Exposure</div>
          </div>

          <div className={`${styles.badgeEnter} absolute -bottom-5 -right-10 max-w-[190px] rounded-2xl border border-white/10 bg-[#202328] px-4 py-3 shadow-[0_18px_38px_-16px_rgba(0,0,0,0.9)] transition-transform duration-500 group-hover/portfolio:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none`}>
            {data.largestTicker ? (
              <>
                <div className="text-[9px] font-black uppercase tracking-[0.13em] text-slate-500">Vị thế lớn nhất</div>
                <div className="mt-1 flex items-center gap-2 text-xs font-bold text-white">
                  <PieChart className="h-3.5 w-3.5 text-violet-300" />
                  {data.largestTicker} · {formatPercent(data.largestPositionPct)}
                </div>
              </>
            ) : (
              <>
                <div className="text-[9px] font-black uppercase tracking-[0.13em] text-slate-500">Realized P&amp;L</div>
                <div className={realizedPositive ? "mt-1 text-xs font-bold text-emerald-300" : "mt-1 text-xs font-bold text-rose-300"}>
                  {data.hasPortfolio ? formatVnd(data.realizedPnlVnd) : "Sẵn sàng khi bạn bắt đầu"}
                </div>
              </>
            )}
          </div>
        </Link>
      </div>
    </div>
  )
}

export function HomeHero({ data, stocks }: { data: HomeHeroData; stocks: readonly HomeStockSearchStock[] }) {
  return (
    <section
      aria-labelledby="home-market-pulse-title"
      className="relative border-b border-white/[0.055] py-10 sm:py-14 lg:min-h-[620px] lg:py-16"
    >
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[42%] h-px w-[76%] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      <div className="relative grid items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.95fr)_minmax(0,1fr)] lg:gap-5 xl:gap-8">
        <MarketObject data={data.market} />
        <CenterNarrative data={data} stocks={stocks} />
        <PortfolioObject data={data.portfolio} />
      </div>
    </section>
  )
}
