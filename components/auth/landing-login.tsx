"use client"

import { type FormEvent, useState } from "react"
import { ArrowRight, ArrowUpRight, Eye, EyeOff, LineChart, Radar, RadioTower } from "lucide-react"
import { BRAND } from "@/modules/shared/brand"
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/modules/shared/supabase/client"

const FEATURES = [
  { label: "Bảng điện realtime", icon: LineChart },
  { label: "Wyckoff Insights", icon: Radar },
  { label: "Signal Monitor", icon: RadioTower },
] as const

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes("invalid login credentials")) {
    return "Email hoặc mật khẩu không đúng."
  }
  if (normalized.includes("email not confirmed")) {
    return "Tài khoản chưa được xác nhận."
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Đăng nhập quá nhiều lần. Vui lòng thử lại sau."
  }
  return "Không thể đăng nhập lúc này. Vui lòng thử lại."
}

function BrandLockup() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-300/25 bg-gradient-to-br from-emerald-400/10 via-cyan-400/5 to-amber-300/10 shadow-[0_0_34px_-8px_rgba(34,201,138,0.65),inset_0_1px_0_rgba(255,255,255,0.16)]">
        <div className="absolute inset-1 rounded-xl border border-white/[0.06]" />
        <img src="/brand/stockos-mark.svg" alt="" className="relative h-7 w-7" />
      </div>
      <div className="leading-none">
        <div className="font-ticker text-[18px] font-extrabold italic tracking-[-0.04em] text-white">
          Qeo<span className="animate-title-flow bg-gradient-to-r from-emerald-300 via-cyan-200 to-amber-300 bg-clip-text text-transparent">Index</span>
        </div>
        <div className="mt-1.5 font-ticker text-[10px] font-medium tracking-[-0.01em] text-slate-500">
          {BRAND.slogan}
        </div>
      </div>
    </div>
  )
}

function MarketPulseCard() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#0a1015]/78 p-5 shadow-[0_28px_90px_-44px_rgba(34,201,138,0.75),0_0_0_1px_rgba(34,201,138,0.03)_inset] backdrop-blur-2xl sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-emerald-400/[0.08] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-44 w-44 rounded-full bg-amber-300/[0.06] blur-3xl" />

      <div className="relative flex items-start justify-between gap-4 border-b border-white/[0.07] pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">VN-INDEX / nhịp khớp lệnh</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-ticker text-2xl font-extrabold italic tracking-tight text-white">1.688,42</span>
            <span className="font-mono text-[11px] font-semibold text-emerald-300">+0,82%</span>
          </div>
        </div>
        <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300/80">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]" />
          live
        </span>
      </div>

      <div className="relative mt-5 h-[180px] overflow-hidden rounded-2xl border border-white/[0.055] bg-[#071016]/80">
        <svg viewBox="0 0 560 180" className="h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="qeo-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f4b84b" />
              <stop offset="0.55" stopColor="#6ee7b7" />
              <stop offset="1" stopColor="#67e8f9" />
            </linearGradient>
            <linearGradient id="qeo-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6ee7b7" stopOpacity="0.14" />
              <stop offset="1" stopColor="#6ee7b7" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="#ffffff" strokeOpacity="0.055" strokeWidth="1">
            <line x1="0" y1="35" x2="560" y2="35" />
            <line x1="0" y1="90" x2="560" y2="90" />
            <line x1="0" y1="145" x2="560" y2="145" />
            <line x1="92" y1="0" x2="92" y2="180" />
            <line x1="184" y1="0" x2="184" y2="180" />
            <line x1="276" y1="0" x2="276" y2="180" />
            <line x1="368" y1="0" x2="368" y2="180" />
            <line x1="460" y1="0" x2="460" y2="180" />
          </g>
          <path d="M18 131 C58 125 76 111 108 117 C142 123 158 86 194 94 C229 102 240 78 276 82 C310 86 330 59 365 69 C402 79 414 51 450 58 C482 64 500 47 542 43 L542 180 L18 180 Z" fill="url(#qeo-fill)" />
          <path d="M18 131 C58 125 76 111 108 117 C142 123 158 86 194 94 C229 102 240 78 276 82 C310 86 330 59 365 69 C402 79 414 51 450 58 C482 64 500 47 542 43" fill="none" stroke="url(#qeo-line)" strokeWidth="2.5" strokeLinecap="round" />
          <g strokeWidth="2">
            <line x1="70" y1="104" x2="70" y2="147" stroke="#f4b84b" /><rect x="63" y="116" width="14" height="18" rx="2" fill="#f4b84b" />
            <line x1="136" y1="88" x2="136" y2="128" stroke="#6ee7b7" /><rect x="129" y="99" width="14" height="20" rx="2" fill="#6ee7b7" />
            <line x1="205" y1="72" x2="205" y2="113" stroke="#67e8f9" /><rect x="198" y="84" width="14" height="18" rx="2" fill="#67e8f9" />
            <line x1="275" y1="61" x2="275" y2="104" stroke="#f4b84b" /><rect x="268" y="73" width="14" height="19" rx="2" fill="#f4b84b" />
            <line x1="345" y1="47" x2="345" y2="88" stroke="#6ee7b7" /><rect x="338" y="58" width="14" height="18" rx="2" fill="#6ee7b7" />
            <line x1="414" y1="37" x2="414" y2="78" stroke="#f4b84b" /><rect x="407" y="48" width="14" height="18" rx="2" fill="#f4b84b" />
            <line x1="486" y1="30" x2="486" y2="68" stroke="#6ee7b7" /><rect x="479" y="42" width="14" height="16" rx="2" fill="#6ee7b7" />
          </g>
        </svg>
        <div className="absolute bottom-3 left-4 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-600">07 phiên gần nhất</div>
        <div className="absolute right-4 top-3 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-200/80">momentum mở rộng</div>
      </div>
    </div>
  )
}

export function LandingLogin() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configured = isSupabaseConfigured()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setError("Supabase Auth chưa được cấu hình cho môi trường này.")
      return
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) {
      setError("Nhập email và mật khẩu để tiếp tục.")
      return
    }

    setIsSubmitting(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })
    setIsSubmitting(false)

    if (authError) {
      setError(friendlyAuthError(authError.message))
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05080b] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,201,138,0.09),transparent_31%),radial-gradient(circle_at_78%_23%,rgba(245,184,75,0.07),transparent_27%),radial-gradient(circle_at_52%_76%,rgba(103,232,249,0.045),transparent_33%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.11] [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[24%] top-[18%] h-[68%] w-[56%] rounded-[48%] bg-[radial-gradient(ellipse_at_center,rgba(74,222,128,0.15)_0%,rgba(34,201,138,0.09)_28%,rgba(34,201,138,0.035)_51%,transparent_74%)] blur-[72px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[18%] top-[33%] h-[42%] w-[42%] -rotate-6 rounded-[50%] bg-[linear-gradient(115deg,transparent_10%,rgba(74,222,128,0.08)_34%,rgba(110,231,183,0.16)_49%,rgba(34,201,138,0.055)_63%,transparent_82%)] blur-[56px]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-5 py-5 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4 rounded-[22px] border border-white/[0.08] bg-[#071017]/70 px-4 py-3.5 shadow-[0_14px_50px_-38px_rgba(34,201,138,0.9)] backdrop-blur-2xl sm:px-5">
          <BrandLockup />
          <a
            href="https://qeoqeo.com/"
            className="group flex shrink-0 items-center gap-2 rounded-full border border-emerald-300/20 bg-white/[0.025] px-3.5 py-2 font-ticker text-[11px] font-bold text-slate-300 shadow-[0_0_18px_-12px_rgba(110,231,183,0.8)] transition hover:border-amber-300/35 hover:bg-white/[0.045] hover:text-white hover:shadow-[0_0_24px_-10px_rgba(244,184,75,0.75)] sm:px-4"
            aria-label="Liên hệ qua qeoqeo.com"
          >
            <span>Liên hệ</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-300 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-amber-300" />
          </a>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.12fr_0.88fr] lg:gap-16 lg:py-16">
          <div className="min-w-0">
            <div className="relative isolate py-6 sm:py-8 lg:py-10">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -left-[7%] top-1/2 -z-20 -translate-y-[55%] select-none font-ticker text-[clamp(17rem,31vw,31rem)] font-extrabold italic leading-none text-transparent opacity-30 [-webkit-text-stroke:1.2px_rgba(110,231,183,0.16)] [text-shadow:0_0_18px_rgba(110,231,183,0.16),0_0_56px_rgba(34,201,138,0.1),0_0_96px_rgba(244,184,75,0.055)]"
              >
                O
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -left-[2%] top-1/2 -z-30 h-[min(31vw,29rem)] w-[min(31vw,29rem)] min-h-[17rem] min-w-[17rem] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,transparent_49%,rgba(110,231,183,0.035)_51%,rgba(244,184,75,0.022)_57%,transparent_69%)] blur-[3px]"
              />

              <h1 className="relative max-w-[780px] py-3 font-ticker text-[clamp(3rem,13vw,5.2rem)] font-extrabold italic leading-[1.02] tracking-[-0.045em] text-[#f1eee5] lg:text-[clamp(4.8rem,6.3vw,6.4rem)]">
                <span className="block">Đọc thị trường.</span>
                <span className="mt-1 block bg-gradient-to-r from-amber-300 via-[#f4b84b] to-emerald-300 bg-clip-text pb-1 text-transparent drop-shadow-[0_0_30px_rgba(244,184,75,0.1)]">
                  Giữ kỷ luật.
                </span>
              </h1>

              <p className="relative mt-6 max-w-xl font-ticker text-[15px] font-medium leading-7 text-slate-400 sm:text-base">
                Một workspace gọn cho bảng điện realtime, Wyckoff insights và tín hiệu liên thị trường.
              </p>

              <div className="relative mt-7 flex flex-wrap gap-2.5">
                {FEATURES.map(({ label, icon: Icon }) => (
                  <div key={label} className="flex items-center gap-2 rounded-full border border-white/[0.075] bg-white/[0.025] px-3.5 py-2 text-[11px] font-semibold text-slate-300 backdrop-blur-xl">
                    <Icon className="h-3.5 w-3.5 text-emerald-300/80" />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 hidden max-w-[610px] lg:block">
              <MarketPulseCard />
            </div>
          </div>

          <div className="mx-auto w-full max-w-[500px] lg:mx-0 lg:justify-self-end">
            <div className="relative overflow-hidden rounded-[30px] border border-emerald-300/20 bg-[#091118]/84 p-1 shadow-[0_40px_110px_-46px_rgba(34,201,138,0.72),0_0_55px_-38px_rgba(244,184,75,0.85)] backdrop-blur-3xl">
              <div className="pointer-events-none absolute left-8 right-8 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/80 to-amber-300/70" />
              <div className="pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full bg-emerald-300/[0.08] blur-3xl" />

              <div className="relative rounded-[26px] border border-white/[0.055] bg-[#081017]/78 px-6 py-7 sm:px-8 sm:py-9">
                <div className="mb-8">
                  <h2 className="font-ticker text-2xl font-extrabold italic tracking-[-0.035em] text-white sm:text-[28px]">Đăng nhập QeoIndex</h2>
                  <p className="mt-2 text-sm text-slate-500">Truy cập bảng điện và workspace cá nhân.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  <div>
                    <label htmlFor="qeo-email" className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Email</label>
                    <input
                      id="qeo-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      className="h-12 w-full rounded-xl border border-white/[0.09] bg-[#050b10]/80 px-4 font-ticker text-sm font-semibold text-white outline-none transition placeholder:font-normal placeholder:text-slate-700 focus:border-emerald-300/45 focus:shadow-[0_0_0_3px_rgba(110,231,183,0.07),0_0_25px_-16px_rgba(110,231,183,0.8)]"
                    />
                  </div>

                  <div>
                    <label htmlFor="qeo-password" className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Mật khẩu</label>
                    <div className="relative">
                      <input
                        id="qeo-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="••••••••••••"
                        className="h-12 w-full rounded-xl border border-white/[0.09] bg-[#050b10]/80 px-4 pr-12 font-ticker text-sm font-semibold text-white outline-none transition placeholder:text-slate-700 focus:border-emerald-300/45 focus:shadow-[0_0_0_3px_rgba(110,231,183,0.07),0_0_25px_-16px_rgba(110,231,183,0.8)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-600 transition hover:bg-white/[0.04] hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/40"
                        aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div role="alert" aria-live="polite" className="rounded-xl border border-red-400/15 bg-red-400/[0.055] px-3.5 py-3 text-xs font-medium leading-5 text-red-200/90">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || !configured}
                    className="group flex h-12 w-full items-center justify-between rounded-xl bg-gradient-to-r from-[#a8ff78] via-[#d8f278] to-[#f5c154] px-4 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[#081007] shadow-[0_12px_35px_-16px_rgba(168,255,120,0.8)] transition duration-200 hover:brightness-105 hover:shadow-[0_16px_42px_-15px_rgba(245,193,84,0.75)] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span>{isSubmitting ? "Đang xác thực..." : "Đăng nhập"}</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </button>
                </form>

                {!configured && (
                  <p className="mt-5 border-t border-white/[0.06] pt-4 font-mono text-[9px] leading-5 text-amber-200/65">
                    Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 lg:hidden">
              <MarketPulseCard />
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
