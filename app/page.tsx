import Link from "next/link"
import {
  Activity,
  BarChart3,
  BookOpenText,
  Briefcase,
  CandlestickChart,
  FileText,
  LayoutDashboard,
  LineChart,
  Radar,
  SearchCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"

import { LandingLogin } from "@/components/auth/landing-login"
import { TopNav } from "@/components/top-nav"
import { getServerAuthContext } from "@/modules/auth/server"

export const dynamic = "force-dynamic"

type HomeMenuItem = {
  href: string
  title: string
  description: string
  icon: LucideIcon
  miniIcons: readonly [LucideIcon, LucideIcon, LucideIcon]
  borderClassName: string
  glowClassName: string
}

const HOME_MENU_ITEMS: HomeMenuItem[] = [
  {
    href: "/board",
    title: "Bảng điện",
    description: "Theo dõi giá, thanh khoản, sổ lệnh và diễn biến realtime của Top Stocks 200.",
    icon: LayoutDashboard,
    miniIcons: [BarChart3, LineChart, Activity],
    borderClassName: "hover:border-emerald-400/35",
    glowClassName: "from-emerald-400/12 via-cyan-400/5 to-transparent",
  },
  {
    href: "/portfolio",
    title: "Danh mục",
    description: "Quản lý danh mục, kế hoạch giao dịch, hiệu suất và kỷ luật rủi ro trong một workspace.",
    icon: Briefcase,
    miniIcons: [TrendingUp, CandlestickChart, BarChart3],
    borderClassName: "hover:border-violet-400/35",
    glowClassName: "from-violet-400/12 via-fuchsia-400/5 to-transparent",
  },
  {
    href: "/insights",
    title: "Insights thị trường",
    description: "Đọc VNINDEX, Qeo Rating, dòng tiền, Wyckoff và AI Council từ cùng một góc nhìn thị trường.",
    icon: Sparkles,
    miniIcons: [CandlestickChart, Radar, TrendingUp],
    borderClassName: "hover:border-cyan-400/35",
    glowClassName: "from-cyan-400/12 via-emerald-400/5 to-transparent",
  },
  {
    href: "/reports",
    title: "Báo cáo Research",
    description: "Tra cứu báo cáo vĩ mô, chiến lược và ngành cùng trạng thái ingest, phân tích AI và bằng chứng nguồn.",
    icon: FileText,
    miniIcons: [BookOpenText, SearchCheck, BarChart3],
    borderClassName: "hover:border-amber-400/35",
    glowClassName: "from-amber-400/12 via-emerald-400/5 to-transparent",
  },
]

const MINI_ICON_CLASS =
  "flex h-10 w-10 scale-[0.78] items-center justify-center rounded-xl border border-[#363b44] bg-[#1b1e24] text-[#b7f64d] opacity-0 shadow-[0_16px_30px_-16px_rgba(0,0,0,0.95)] transition-[opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:scale-100 group-hover/card:opacity-100 motion-reduce:transform-none motion-reduce:transition-none"

function MenuCard({ item }: { item: HomeMenuItem }) {
  const Icon = item.icon
  const [MiniOne, MiniTwo, MiniThree] = item.miniIcons

  return (
    <Link
      href={item.href}
      prefetch={false}
      className={[
        "group/card relative min-h-[250px] overflow-hidden rounded-3xl border border-white/[0.09] bg-panel/60 p-6 shadow-[0_22px_55px_-38px_rgba(0,0,0,0.95)]",
        "transition-[border-color,background-color,transform,opacity,filter] duration-300 ease-out group-hover/home:blur-[2px] group-hover/home:opacity-40 hover:!blur-none hover:!opacity-100 hover:-translate-y-1 hover:bg-panel/80 focus-visible:!blur-none focus-visible:!opacity-100 motion-reduce:transform-none motion-reduce:transition-none",
        item.borderClassName,
      ].join(" ")}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.glowClassName} opacity-70 transition-opacity duration-300 group-hover/card:opacity-100 motion-reduce:transition-none`} />
      <div className="relative flex h-full flex-col sm:flex-row sm:items-center sm:gap-7">
        <div className="relative mb-6 flex h-36 w-40 shrink-0 items-center justify-center sm:mb-0">
          <div
            data-home-mini-anchor
            className="absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2"
            aria-hidden="true"
          >
            <div className={`${MINI_ICON_CLASS} group-hover/card:-translate-x-[3.625rem] group-hover/card:-translate-y-[1.5rem] group-hover/card:-rotate-[12deg]`}>
              <MiniOne className="h-5 w-5" strokeWidth={2.2} />
            </div>
          </div>

          <div
            data-home-mini-anchor
            className="absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2"
            aria-hidden="true"
          >
            <div className={`${MINI_ICON_CLASS} group-hover/card:-translate-y-[3.75rem]`}>
              <MiniTwo className="h-5 w-5" strokeWidth={2.2} />
            </div>
          </div>

          <div
            data-home-mini-anchor
            className="absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2"
            aria-hidden="true"
          >
            <div className={`${MINI_ICON_CLASS} group-hover/card:translate-x-[3.625rem] group-hover/card:-translate-y-[1.5rem] group-hover/card:rotate-[12deg]`}>
              <MiniThree className="h-5 w-5" strokeWidth={2.2} />
            </div>
          </div>

          <div
            className="relative z-10 flex h-[86px] w-[86px] items-center justify-center rounded-[24px] border border-[#9fd32f]/35 bg-gradient-to-br from-[#e3f7a6] via-[#b7e54d] to-[#7bc20c] text-[#111317] shadow-[0_20px_38px_-22px_rgba(0,0,0,0.95)] transition-[transform,box-shadow] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:scale-[1.12] group-hover/card:shadow-[0_26px_48px_-22px_rgba(132,204,22,0.65)] motion-reduce:transform-none motion-reduce:transition-none"
          >
            <Icon className="h-10 w-10" strokeWidth={2} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">{item.title}</h2>
            <span className="text-sm text-slate-600 transition-[color,transform] duration-300 group-hover/card:translate-x-1 group-hover/card:text-slate-300 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true">→</span>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">{item.description}</p>
          <div className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 transition-colors duration-300 group-hover/card:text-slate-300">
            Mở workspace
          </div>
        </div>
      </div>
    </Link>
  )
}

export default async function HomePage() {
  const auth = await getServerAuthContext()
  if (!auth) return <LandingLogin />

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
        <section className="mb-8 max-w-3xl sm:mb-10">
          <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">QeoIndex Workspace</div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Chọn không gian làm việc</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400 sm:text-base">
            Truy cập nhanh bốn khu vực chính của QeoIndex. Mỗi workspace giữ nguyên dữ liệu và luồng công việc chuyên biệt của nó.
          </p>
        </section>

        <section className="group/home grid gap-4 md:grid-cols-2" aria-label="Các khu vực chính">
          {HOME_MENU_ITEMS.map((item) => <MenuCard key={item.href} item={item} />)}
        </section>
      </main>
    </div>
  )
}
