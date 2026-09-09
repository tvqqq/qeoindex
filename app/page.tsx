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
  iconClassName: string
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
    iconClassName: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    borderClassName: "hover:border-emerald-400/35",
    glowClassName: "from-emerald-400/12 via-cyan-400/5 to-transparent",
  },
  {
    href: "/portfolio",
    title: "Danh mục",
    description: "Quản lý danh mục, kế hoạch giao dịch, hiệu suất và kỷ luật rủi ro trong một workspace.",
    icon: Briefcase,
    miniIcons: [TrendingUp, CandlestickChart, BarChart3],
    iconClassName: "border-violet-400/25 bg-violet-400/10 text-violet-300",
    borderClassName: "hover:border-violet-400/35",
    glowClassName: "from-violet-400/12 via-fuchsia-400/5 to-transparent",
  },
  {
    href: "/insights",
    title: "Insights thị trường",
    description: "Đọc VNINDEX, Qeo Rating, dòng tiền, Wyckoff và AI Council từ cùng một góc nhìn thị trường.",
    icon: Sparkles,
    miniIcons: [CandlestickChart, Radar, TrendingUp],
    iconClassName: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
    borderClassName: "hover:border-cyan-400/35",
    glowClassName: "from-cyan-400/12 via-emerald-400/5 to-transparent",
  },
  {
    href: "/reports",
    title: "Báo cáo Research",
    description: "Tra cứu báo cáo vĩ mô, chiến lược và ngành cùng trạng thái ingest, phân tích AI và bằng chứng nguồn.",
    icon: FileText,
    miniIcons: [BookOpenText, SearchCheck, BarChart3],
    iconClassName: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    borderClassName: "hover:border-amber-400/35",
    glowClassName: "from-amber-400/12 via-emerald-400/5 to-transparent",
  },
]

function MenuCard({ item }: { item: HomeMenuItem }) {
  const Icon = item.icon
  const [MiniOne, MiniTwo, MiniThree] = item.miniIcons

  return (
    <Link
      href={item.href}
      prefetch={false}
      className={[
        "group relative min-h-[250px] overflow-hidden rounded-3xl border border-white/[0.09] bg-panel/60 p-6 shadow-[0_22px_55px_-38px_rgba(0,0,0,0.95)]",
        "transition-[border-color,background-color,transform] duration-200 hover:-translate-y-1 hover:bg-panel/80 motion-reduce:transform-none motion-reduce:transition-none",
        item.borderClassName,
      ].join(" ")}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.glowClassName} opacity-70`} />
      <div className="relative flex h-full flex-col sm:flex-row sm:items-center sm:gap-7">
        <div className="relative mb-6 flex h-28 w-28 shrink-0 items-center justify-center sm:mb-0">
          <div className={`relative z-10 flex h-20 w-20 items-center justify-center rounded-3xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${item.iconClassName}`}>
            <Icon className="h-9 w-9" strokeWidth={1.7} />
          </div>

          <div className="absolute left-0 top-0 flex h-9 w-9 -translate-x-1 translate-y-2 items-center justify-center rounded-xl border border-white/[0.12] bg-[#10161e] text-slate-300 opacity-0 shadow-md transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none">
            <MiniOne className="h-4 w-4" />
          </div>
          <div className="absolute right-0 top-1 flex h-9 w-9 translate-x-1 translate-y-2 items-center justify-center rounded-xl border border-white/[0.12] bg-[#10161e] text-slate-300 opacity-0 shadow-md transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none">
            <MiniTwo className="h-4 w-4" />
          </div>
          <div className="absolute bottom-0 right-2 flex h-9 w-9 translate-x-1 translate-y-1 items-center justify-center rounded-xl border border-white/[0.12] bg-[#10161e] text-slate-300 opacity-0 shadow-md transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none">
            <MiniThree className="h-4 w-4" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">{item.title}</h2>
            <span className="text-sm text-slate-600 transition-[color,transform] duration-200 group-hover:translate-x-1 group-hover:text-slate-300 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden="true">→</span>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">{item.description}</p>
          <div className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 transition-colors duration-200 group-hover:text-slate-300">
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

        <section className="grid gap-4 md:grid-cols-2" aria-label="Các khu vực chính">
          {HOME_MENU_ITEMS.map((item) => <MenuCard key={item.href} item={item} />)}
        </section>
      </main>
    </div>
  )
}
