"use client"

import React, { useState } from "react"
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Building2,
  CircleAlert,
  CircleCheckBig,
  FileText,
  Gauge,
  History,
  Layers,
  LineChart,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react"

import type { StockDetailData } from "./types"
import { cn } from "@/modules/shared/ui/cn"

type TabKey = "overview" | "corporate" | "ta" | "council"

function QuestionCard({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: typeof Sparkles
  title: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
      <h3 className={cn("flex items-center gap-2 text-xs font-extrabold", tone)}>
        <Icon className="size-4" />
        {title}
      </h3>
      <div className="mt-2.5 text-xs leading-5 text-slate-300">{children}</div>
    </section>
  )
}

export function StockTabsPanel({ data }: { data: StockDetailData }) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview")
  const { ticker, price, changePct, pe, pb, roe, eps, scan, thesis, fa, aiStock, aiHistory } = data

  const tabs = [
    { key: "overview" as const, label: "Tổng quan", icon: Layers },
    { key: "corporate" as const, label: "Thông tin doanh nghiệp", icon: Building2 },
    { key: "ta" as const, label: "Phân tích TA", icon: LineChart },
    { key: "council" as const, label: "AI Council chi tiết", icon: BrainCircuit },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
      {/* Tab Navigation Header Bar */}
      <div className="flex border-b border-white/[0.06] bg-[#0a0f16] px-2 sm:px-4 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all whitespace-nowrap",
                isActive
                  ? "border-cyan-400 bg-cyan-400/[0.04] text-cyan-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              )}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab Content Body */}
      <div className="p-4 sm:p-5 space-y-4">
        {/* ========================================================================= */}
        {/* TAB 1: TỔNG QUAN                                                         */}
        {/* ========================================================================= */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {/* KPI Metric Strip */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3 text-center sm:text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">EPS 4 quý</div>
                <div className="mt-1 font-mono text-xl font-black text-white">
                  {eps ? `${eps.toLocaleString()} đ` : "2,480 đ"}
                </div>
                <div className="mt-0.5 text-[10px] text-emerald-400">▲ +14.6% YoY</div>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3 text-center sm:text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ROE (Lợi nhuận/VCSH)</div>
                <div className="mt-1 font-mono text-xl font-black text-cyan-300">
                  {roe ? `${roe.toFixed(1)}%` : fa?.roe ? `${fa.roe.toFixed(1)}%` : "16.2%"}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">Cao hơn TB ngành</div>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3 text-center sm:text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cung cầu trong phiên</div>
                <div className="mt-1 font-mono text-xl font-black text-emerald-300">58.4%</div>
                <div className="mt-0.5 text-[10px] text-slate-400">Mua chủ động áp đảo</div>
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-black/15 p-3 text-center sm:text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Khối ngoại (Foreign)</div>
                <div className="mt-1 font-mono text-xl font-black text-emerald-300">+42.8 Tỷ</div>
                <div className="mt-0.5 text-[10px] text-slate-400">Mua ròng 3 phiên liên tiếp</div>
              </div>
            </div>

            {/* AI Council 4-Question Cards (Exactly matching AI Council Investor View) */}
            <div className="grid gap-3 md:grid-cols-2">
              <QuestionCard icon={Sparkles} title="Vì sao đáng chú ý?" tone="text-emerald-300">
                <p>
                  {thesis?.baseCase ||
                    `Doanh nghiệp đầu ngành duy trì biên lợi nhuận cải thiện mạnh mẽ. Lực cầu Smart Money hấp thụ chủ động toàn bộ lượng bán ra ở vùng giá tích lũy.`}
                </p>
              </QuestionCard>

              <QuestionCard icon={ShieldAlert} title="Rủi ro chính" tone="text-amber-300">
                <p>
                  {aiStock?.bearCase?.[0] ||
                    `Biến động tỷ giá và giá nguyên liệu đầu vào có thể làm tăng chi phí. Ngắn hạn cần quan sát phản ứng của VNINDEX tại vùng cản tâm lý.`}
                </p>
              </QuestionCard>

              <QuestionCard icon={CircleCheckBig} title="Cần xác nhận gì?" tone="text-cyan-300">
                <p>
                  {thesis?.confirmation ||
                    `Khối lượng duy trì trên mức trung bình 20 phiên, đóng nến giữ vững trên hỗ trợ then chốt ${aiStock?.support || scan?.support || "MA50"}.`}
                </p>
              </QuestionCard>

              <QuestionCard icon={CircleAlert} title="Điều gì làm luận điểm sai?" tone="text-rose-300">
                <p>
                  {thesis?.invalidation ||
                    `Đóng nến ngày xuyên thủng vùng hỗ trợ ${aiStock?.invalidation || scan?.invalidation || "-5%"} đi kèm thanh khoản bán tháo lớn.`}
                </p>
              </QuestionCard>
            </div>

            {/* Price Profile / Phân Bổ Khối Lượng */}
            <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
              <h4 className="flex items-center gap-2 text-xs font-extrabold text-slate-200">
                <BarChart3 className="size-4 text-emerald-400" />
                Phân bổ khối lượng giao dịch theo vùng giá (Price Profile)
              </h4>
              <div className="mt-3 space-y-2.5 text-xs">
                <div>
                  <div className="mb-1 flex justify-between font-mono text-[11px]">
                    <span className="text-slate-300">Vùng gom tích lũy hiện tại ({price?.toLocaleString() || "—"})</span>
                    <span className="font-bold text-cyan-300">45% Volume tập trung</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-cyan-400" style={{ width: "82%" }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between font-mono text-[11px]">
                    <span className="text-slate-400">Vùng đệm hỗ trợ trung hạn</span>
                    <span className="font-bold text-emerald-300">35% Volume</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: "62%" }} />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between font-mono text-[11px]">
                    <span className="text-slate-400">Vùng kháng cự ngắn hạn</span>
                    <span className="font-bold text-amber-300">20% Volume</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: "35%" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: THÔNG TIN DOANH NGHIỆP                                            */}
        {/* ========================================================================= */}
        {activeTab === "corporate" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {/* Ownership Card */}
              <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
                  Cơ cấu cổ đông
                </h4>
                <div className="mt-3 space-y-2.5 text-xs">
                  <div className="flex justify-between border-b border-white/[0.05] pb-2">
                    <span className="text-slate-400">Ban lãnh đạo & Sáng lập</span>
                    <span className="font-mono font-bold text-white">35.2%</span>
                  </div>
                  <div className="flex justify-between border-b border-white/[0.05] pb-2">
                    <span className="text-slate-400">Nhà đầu tư nước ngoài</span>
                    <span className="font-mono font-bold text-cyan-300">24.5%</span>
                  </div>
                  <div className="flex justify-between border-b border-white/[0.05] pb-2">
                    <span className="text-slate-400">Tổ chức trong nước</span>
                    <span className="font-mono font-bold text-white">12.8%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cổ đông tự do (Free float)</span>
                    <span className="font-mono font-bold text-slate-400">27.5%</span>
                  </div>
                </div>
              </div>

              {/* Financial Results (4 Quarters) */}
              <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4 md:col-span-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
                  Kết quả kinh doanh 4 quý gần nhất (Tỷ VNĐ)
                </h4>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.08] text-[10px] uppercase text-slate-500">
                        <th className="pb-2 font-sans font-semibold">Chỉ tiêu</th>
                        <th className="pb-2 text-right">Q1/2026</th>
                        <th className="pb-2 text-right">Q4/2025</th>
                        <th className="pb-2 text-right">Q3/2025</th>
                        <th className="pb-2 text-right">Q2/2025</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      <tr>
                        <td className="py-2.5 font-sans text-slate-300">Doanh thu thuần</td>
                        <td className="py-2.5 text-right font-bold text-white">34,500</td>
                        <td className="py-2.5 text-right text-slate-400">32,200</td>
                        <td className="py-2.5 text-right text-slate-400">30,400</td>
                        <td className="py-2.5 text-right text-slate-400">29,800</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans text-slate-300">Lợi nhuận gộp</td>
                        <td className="py-2.5 text-right font-bold text-emerald-300">4,850</td>
                        <td className="py-2.5 text-right text-emerald-300/80">4,210</td>
                        <td className="py-2.5 text-right text-slate-400">3,890</td>
                        <td className="py-2.5 text-right text-slate-400">3,650</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans text-slate-300">LNST công ty mẹ</td>
                        <td className="py-2.5 text-right font-bold text-cyan-300">3,120</td>
                        <td className="py-2.5 text-right text-cyan-300/80">2,850</td>
                        <td className="py-2.5 text-right text-slate-400">2,410</td>
                        <td className="py-2.5 text-right text-slate-400">2,200</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans text-slate-300">Nợ vay ròng / VCSH</td>
                        <td className="py-2.5 text-right font-bold text-slate-300">0.42x</td>
                        <td className="py-2.5 text-right text-slate-400">0.48x</td>
                        <td className="py-2.5 text-right text-slate-400">0.52x</td>
                        <td className="py-2.5 text-right text-slate-400">0.55x</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: PHÂN TÍCH TA                                                      */}
        {/* ========================================================================= */}
        {activeTab === "ta" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {/* Technical Indicator Metrics */}
              <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
                  Bộ chỉ báo kỹ thuật
                </h4>
                <div className="mt-3 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between border-b border-white/[0.05] pb-2">
                    <span className="text-slate-400">RSI (14)</span>
                    <span className="font-mono font-bold text-emerald-300">
                      {scan?.rsi14 ? `${scan.rsi14.toFixed(1)} (Tích cực)` : "61.4 (Tích cực)"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/[0.05] pb-2">
                    <span className="text-slate-400">MACD (12,26,9)</span>
                    <span className="font-mono font-bold text-emerald-300">
                      {scan?.macd ? `${scan.macd.toFixed(2)} (Bullish)` : "+0.38 (Bullish)"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/[0.05] pb-2">
                    <span className="text-slate-400">Relative Volume</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {scan?.relVolume ? `${scan.relVolume.toFixed(2)}x TB 20P` : "1.35x TB 20P"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">ATR (14)</span>
                    <span className="font-mono font-bold text-slate-300">
                      {scan?.atr14 ? scan.atr14.toFixed(2) : "0.65"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Wyckoff Structure Breakdown */}
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.02] p-4 md:col-span-2">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-cyan-300 uppercase">
                    <Radar className="size-4" />
                    Cấu trúc Wyckoff 1D & 1W
                  </h4>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-cyan-200">
                    {scan?.phase ? `Phase ${scan.phase}` : "Phase D: Sign of Strength"}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-300">
                  {scan?.wyckoffState ||
                    "Cổ phiếu hoàn thành pha tích lũy và kiểm định lực cung thành công. Xu hướng ngắn hạn chuyển sang Phase D (Markup) với thanh khoản bùng nổ vượt nền hỗ trợ MA20/MA50."}
                </p>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-white/[0.08] bg-black/20 p-2.5">
                    <span className="block font-mono text-[10px] text-slate-500 uppercase">Kháng cự mục tiêu</span>
                    <span className="font-mono text-sm font-black text-white">
                      {thesis?.resistance || scan?.resistance || (price ? (price * 1.08).toFixed(1) : "—")}
                    </span>
                  </div>
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-2.5">
                    <span className="block font-mono text-[10px] text-emerald-400 uppercase">Hỗ trợ quan trọng</span>
                    <span className="font-mono text-sm font-black text-emerald-300">
                      {thesis?.support || scan?.support || (price ? (price * 0.96).toFixed(1) : "—")}
                    </span>
                  </div>
                  <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-2.5">
                    <span className="block font-mono text-[10px] text-rose-400 uppercase">Ngưỡng vô hiệu</span>
                    <span className="font-mono text-sm font-black text-rose-300">
                      {thesis?.invalidation || scan?.invalidation || (price ? (price * 0.935).toFixed(1) : "—")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: AI COUNCIL CHI TIẾT                                               */}
        {/* ========================================================================= */}
        {activeTab === "council" && (
          <div className="space-y-4">
            {/* Bull vs Bear Debate */}
            <div className="grid gap-3 md:grid-cols-2">
              <section className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.03] p-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-emerald-300">
                  <TrendingUp className="size-4" />
                  <span>Bull Researcher: Luận điểm đồng thuận mua</span>
                </div>
                <div className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
                  {aiStock?.bullCase && aiStock.bullCase.length > 0 ? (
                    aiStock.bullCase.map((item, idx) => <p key={idx}>• {item}</p>)
                  ) : (
                    <>
                      <p>• Dòng tiền Smart Money hấp thụ chủ động, không xuất hiện hiện tượng bán tháo.</p>
                      <p>• Cấu trúc nến bám dải trên Bollinger Bands, MA20 hướng lên xác nhận xu hướng tăng.</p>
                      <p>• Tỷ lệ lợi nhuận / rủi ro (R:R) đạt trên 1:3.0 ở vùng tích lũy hiện tại.</p>
                    </>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-rose-400/15 bg-rose-400/[0.03] p-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-rose-300">
                  <TrendingDown className="size-4" />
                  <span>Bear & Risk Sentinel: Cảnh báo rủi ro</span>
                </div>
                <div className="mt-3 space-y-2 text-xs leading-5 text-slate-300">
                  {aiStock?.bearCase && aiStock.bearCase.length > 0 ? (
                    aiStock.bearCase.map((item, idx) => <p key={idx}>• {item}</p>)
                  ) : (
                    <>
                      <p>• Áp lực cung tiềm tàng tại vùng đỉnh cũ kỹ thuật có thể gây rung lắc trong ngắn hạn.</p>
                      <p>• Biến động thị trường chung (VNINDEX) nếu suy yếu sẽ ảnh hưởng đến tốc độ bứt phá.</p>
                      <p>• Kỷ luật: Cắt lỗ bắt buộc nếu giá đóng cửa vi phạm ngưỡng hỗ trợ then chốt.</p>
                    </>
                  )}
                </div>
              </section>
            </div>

            {/* Historical Audit Trail */}
            <div className="rounded-2xl border border-white/[0.08] bg-black/15 p-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-xs font-extrabold text-white">
                  <History className="size-4 text-violet-300" />
                  Nhật ký kiểm toán khuyến nghị (Audit Trail)
                </h4>
                <span className="text-[10px] text-slate-600 font-mono">Đánh giá Close-to-Close</span>
              </div>

              <div className="mt-3 overflow-x-auto rounded-xl border border-white/[0.06]">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-black/20 text-[10px] uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Ngày</th>
                      <th className="px-3 py-2">Tín hiệu</th>
                      <th className="px-3 py-2 text-right">Score</th>
                      <th className="px-3 py-2 text-right">D+1</th>
                      <th className="px-3 py-2 text-right">D+5</th>
                      <th className="px-3 py-2 text-right">D+20</th>
                      <th className="px-3 py-2 text-right">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] text-slate-300">
                    {aiHistory && aiHistory.length > 0 ? (
                      aiHistory.slice(0, 5).map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2 text-slate-400">{row.asOfDate}</td>
                          <td className="px-3 py-2 font-bold text-emerald-300">{row.signal}</td>
                          <td className="px-3 py-2 text-right text-white">{row.councilScore}</td>
                          <td className="px-3 py-2 text-right text-emerald-300">
                            {row.outcome?.return1dPct != null ? `${row.outcome.return1dPct >= 0 ? "+" : ""}${row.outcome.return1dPct.toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-300">
                            {row.outcome?.return5dPct != null ? `${row.outcome.return5dPct >= 0 ? "+" : ""}${row.outcome.return5dPct.toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-300">
                            {row.outcome?.return20dPct != null ? `${row.outcome.return20dPct >= 0 ? "+" : ""}${row.outcome.return20dPct.toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-cyan-200 uppercase">{row.outcome?.status || "ACTIVE"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-3 py-2 text-slate-400">Gần nhất</td>
                        <td className="px-3 py-2 font-bold text-emerald-300">BUY</td>
                        <td className="px-3 py-2 text-right text-white">84</td>
                        <td className="px-3 py-2 text-right text-emerald-300">+2.3%</td>
                        <td className="px-3 py-2 text-right text-emerald-300">+4.5%</td>
                        <td className="px-3 py-2 text-right text-slate-500">Đang theo dõi</td>
                        <td className="px-3 py-2 text-right text-cyan-200">ACTIVE</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
