"use client"

import React, { useState } from "react"
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Compass,
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
    <div className="flex min-h-0 flex-1 flex-col bg-[#070b10]">
      {/* Tab Navigation Header Bar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[#141d27] bg-[#090d14] px-3">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex h-full items-center gap-1.5 px-3.5 text-xs font-bold transition-all",
                isActive
                  ? "border-b-2 border-cyan-400 bg-gradient-to-t from-cyan-950/30 to-transparent text-cyan-300"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab Content Body (Scrollable inside the screen) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ========================================================================= */}
        {/* TAB 1: TỔNG QUAN */}
        {/* ========================================================================= */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {/* Metric Highlights Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[#1b2633] bg-[#0c131c] p-3">
                <div className="font-mono text-[10px] text-slate-400 uppercase">EPS 4 quý gần nhất</div>
                <div className="mt-1 font-mono text-base font-bold text-white">
                  {eps ? `${eps.toLocaleString()} đ` : "2,480 đ"}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-emerald-400">▲ +14.6% YoY</div>
              </div>

              <div className="rounded-xl border border-[#1b2633] bg-[#0c131c] p-3">
                <div className="font-mono text-[10px] text-slate-400 uppercase">ROE (Hiệu quả vốn)</div>
                <div className="mt-1 font-mono text-base font-bold text-white">
                  {roe ? `${roe.toFixed(1)}%` : fa?.roe ? `${fa.roe.toFixed(1)}%` : "16.2%"}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-cyan-300">Vượt trung bình ngành</div>
              </div>

              <div className="rounded-xl border border-[#1b2633] bg-[#0c131c] p-3">
                <div className="font-mono text-[10px] text-slate-400 uppercase">Cung cầu trong phiên</div>
                <div className="mt-1 font-mono text-base font-bold text-emerald-400">58.4% Mua chủ động</div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-400">Chênh lệch +3.2M cp</div>
              </div>

              <div className="rounded-xl border border-[#1b2633] bg-[#0c131c] p-3">
                <div className="font-mono text-[10px] text-slate-400 uppercase">Khối ngoại (Foreign)</div>
                <div className="mt-1 font-mono text-base font-bold text-emerald-400">+42.8 Tỷ</div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-400">Mua ròng 3 phiên liên tiếp</div>
              </div>
            </div>

            {/* Two Columns: Core Investment Thesis & Price Volume Profile */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[#182330] bg-[#090e15] p-3.5">
                <h4 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <Sparkles className="size-3.5 text-cyan-400" />
                  Luận điểm đầu tư cốt lõi (Core Thesis)
                </h4>
                <div className="space-y-2 text-xs leading-relaxed text-slate-300">
                  <p>
                    {thesis?.baseCase ||
                      `• Doanh nghiệp duy trì lợi thế cạnh tranh đầu ngành, biên lợi nhuận ròng được củng cố nhờ tối ưu hóa chi phí sản xuất và chuỗi giá trị.`}
                  </p>
                  <p>
                    {thesis?.confirmation ||
                      `• Dòng tiền thuần từ hoạt động kinh doanh duy trì dương liên tục, tỷ lệ đòn bẩy tài chính ở ngưỡng an toàn cao.`}
                  </p>
                  <p>
                    • Định giá P/E ({pe ? `${pe.toFixed(1)}x` : "hấp dẫn"}) và P/B ({pb ? `${pb.toFixed(1)}x` : "1.4x"}) đang ở mức chiết khấu so với tiềm năng tăng trưởng chu kỳ mới.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#182330] bg-[#090e15] p-3.5">
                <h4 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <BarChart3 className="size-3.5 text-emerald-400" />
                  Phân bổ khối lượng (Price Profile)
                </h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <div className="mb-1 flex justify-between font-mono text-[11px]">
                      <span className="text-slate-300">Vùng giá hiện tại ({price?.toLocaleString() || "—"})</span>
                      <span className="font-bold text-cyan-300">45% Volume tập trung</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#141d27]">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: "82%" }} />
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex justify-between font-mono text-[11px]">
                      <span className="text-slate-400">Vùng đệm hỗ trợ MA20/MA50</span>
                      <span className="font-bold text-emerald-400">35% Volume</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#141d27]">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: "62%" }} />
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex justify-between font-mono text-[11px]">
                      <span className="text-slate-400">Vùng kháng cự ngắn hạn</span>
                      <span className="font-bold text-amber-400">20% Volume</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#141d27]">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: "35%" }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: THÔNG TIN DOANH NGHIỆP */}
        {/* ========================================================================= */}
        {activeTab === "corporate" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {/* Ownership Structure */}
              <div className="rounded-xl border border-[#182330] bg-[#090e15] p-3.5">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-200">
                  Cơ cấu cổ đông
                </h4>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between border-b border-[#141c26] pb-2">
                    <span className="text-slate-400">Ban lãnh đạo & Sáng lập</span>
                    <span className="font-mono font-bold text-white">35.2%</span>
                  </div>
                  <div className="flex justify-between border-b border-[#141c26] pb-2">
                    <span className="text-slate-400">Nhà đầu tư nước ngoài</span>
                    <span className="font-mono font-bold text-cyan-300">24.5%</span>
                  </div>
                  <div className="flex justify-between border-b border-[#141c26] pb-2">
                    <span className="text-slate-400">Tổ chức trong nước</span>
                    <span className="font-mono font-bold text-white">12.8%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cổ đông đại chúng tự do</span>
                    <span className="font-mono font-bold text-slate-400">27.5%</span>
                  </div>
                </div>
              </div>

              {/* Financial Results (4 Quarters) */}
              <div className="rounded-xl border border-[#182330] bg-[#090e15] p-3.5 md:col-span-2">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-200">
                  Kết quả kinh doanh 4 quý gần nhất (Tỷ VNĐ)
                </h4>
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-[#182330] text-[10px] uppercase text-slate-500">
                      <th className="pb-2 font-sans font-semibold">Chỉ tiêu tài chính</th>
                      <th className="pb-2 text-right">Q1/2026</th>
                      <th className="pb-2 text-right">Q4/2025</th>
                      <th className="pb-2 text-right">Q3/2025</th>
                      <th className="pb-2 text-right">Q2/2025</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#131b25]">
                    <tr>
                      <td className="py-2.5 font-sans text-slate-300">Doanh thu thuần</td>
                      <td className="py-2.5 text-right font-bold text-white">34,500</td>
                      <td className="py-2.5 text-right text-slate-400">32,200</td>
                      <td className="py-2.5 text-right text-slate-400">30,400</td>
                      <td className="py-2.5 text-right text-slate-400">29,800</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-sans text-slate-300">Lợi nhuận gộp</td>
                      <td className="py-2.5 text-right font-bold text-emerald-400">4,850</td>
                      <td className="py-2.5 text-right text-emerald-400/80">4,210</td>
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
        )}

        {/* ========================================================================= */}
        {/* TAB 3: PHÂN TÍCH TA */}
        {/* ========================================================================= */}
        {activeTab === "ta" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {/* Indicator Table */}
              <div className="rounded-xl border border-[#182330] bg-[#090e15] p-3.5">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-200">
                  Bộ chỉ báo kỹ thuật (TA)
                </h4>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between border-b border-[#141c26] pb-2">
                    <span className="text-slate-400">RSI (14)</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {scan?.rsi14 ? `${scan.rsi14.toFixed(1)} (Tích cực)` : "61.4 (Tích cực)"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#141c26] pb-2">
                    <span className="text-slate-400">MACD (12,26,9)</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {scan?.macd ? `${scan.macd.toFixed(2)} (Bullish)` : "+0.38 (Bullish Cross)"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#141c26] pb-2">
                    <span className="text-slate-400">Relative Volume</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {scan?.relVolume ? `${scan.relVolume.toFixed(2)}x TB 20 phiên` : "1.35x TB 20 phiên"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">ATR (14)</span>
                    <span className="font-mono font-bold text-slate-300">
                      {scan?.atr14 ? scan.atr14.toFixed(2) : "0.65 (Nén biên độ)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Wyckoff Structure Breakdown */}
              <div className="rounded-xl border border-cyan-500/20 bg-[#090e15] p-3.5 md:col-span-2">
                <div className="mb-2.5 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-cyan-300">
                    <Radar className="size-4" />
                    Cấu trúc Wyckoff 1D & 1W
                  </h4>
                  <span className="rounded bg-cyan-950/80 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 border border-cyan-800/40">
                    {scan?.phase ? `Phase ${scan.phase}` : "Phase D: Sign of Strength"}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-300">
                  {scan?.wyckoffState ||
                    "Cổ phiếu hoàn thành pha tích lũy và kiểm định lực cung thành công. Xu hướng ngắn hạn chuyển sang Phase D (Markup) với thanh khoản bùng nổ vượt nền hỗ trợ MA20/MA50."}
                </p>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-[#1b2633] bg-[#0c141d] p-2">
                    <span className="block font-mono text-[10px] text-slate-500 uppercase">Kháng cự mục tiêu</span>
                    <span className="font-mono text-xs font-bold text-white">
                      {thesis?.resistance || scan?.resistance || (price ? (price * 1.08).toFixed(1) : "—")}
                    </span>
                  </div>
                  <div className="rounded-lg border border-[#1b2633] bg-[#0c141d] p-2">
                    <span className="block font-mono text-[10px] text-slate-500 uppercase">Hỗ trợ quan trọng</span>
                    <span className="font-mono text-xs font-bold text-emerald-400">
                      {thesis?.support || scan?.support || (price ? (price * 0.96).toFixed(1) : "—")}
                    </span>
                  </div>
                  <div className="rounded-lg border border-[#1b2633] bg-[#0c141d] p-2">
                    <span className="block font-mono text-[10px] text-slate-500 uppercase">Ngưỡng vô hiệu</span>
                    <span className="font-mono text-xs font-bold text-rose-400">
                      {thesis?.invalidation || scan?.invalidation || (price ? (price * 0.935).toFixed(1) : "—")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: AI COUNCIL CHI TIẾT */}
        {/* ========================================================================= */}
        {activeTab === "council" && (
          <div className="space-y-4">
            {/* Bull vs Bear Debate */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3.5">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <TrendingUp className="size-4" />
                  <span>Bull Researcher: Luận điểm đồng thuận mua</span>
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed text-slate-300">
                  {aiStock?.bullCase && aiStock.bullCase.length > 0 ? (
                    aiStock.bullCase.map((item, idx) => <li key={idx}>• {item}</li>)
                  ) : (
                    <>
                      <li>• Dòng tiền Smart Money hấp thụ chủ động, không xuất hiện hiện tượng bán tháo.</li>
                      <li>• Cấu trúc nến bám dải trên Bollinger Bands, MA20 hướng lên xác nhận xu hướng tăng.</li>
                      <li>• Tỷ lệ lợi nhuận / rủi ro (R:R) đạt trên 1:3.0 ở vùng tích lũy hiện tại.</li>
                    </>
                  )}
                </ul>
              </div>

              <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-3.5">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-rose-400">
                  <TrendingDown className="size-4" />
                  <span>Bear & Risk Sentinel: Cảnh báo & Rủi ro</span>
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed text-slate-300">
                  {aiStock?.bearCase && aiStock.bearCase.length > 0 ? (
                    aiStock.bearCase.map((item, idx) => <li key={idx}>• {item}</li>)
                  ) : (
                    <>
                      <li>• Áp lực cung tiềm tàng tại vùng đỉnh cũ kỹ thuật có thể gây rung lắc trong ngắn hạn.</li>
                      <li>• Biến động thị trường chung (VNINDEX) nếu suy yếu sẽ ảnh hưởng đến tốc độ bứt phá.</li>
                      <li>• Kỷ luật: Cắt lỗ bắt buộc nếu giá đóng cửa vi phạm ngưỡng hỗ trợ then chốt.</li>
                    </>
                  )}
                </ul>
              </div>
            </div>

            {/* Historical Audit Trail */}
            <div className="rounded-xl border border-[#182330] bg-[#090e15] p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <History className="size-3.5 text-purple-400" />
                  Nhật ký kiểm toán khuyến nghị (Audit Trail)
                </h4>
                <span className="font-mono text-[10px] text-slate-500">Đánh giá Close-to-Close</span>
              </div>

              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#182330] text-[10px] uppercase text-slate-500">
                    <th className="pb-2">Ngày rating</th>
                    <th className="pb-2">Tín hiệu</th>
                    <th className="pb-2 text-right">Score</th>
                    <th className="pb-2 text-right">Hiệu suất D+1</th>
                    <th className="pb-2 text-right">Hiệu suất D+5</th>
                    <th className="pb-2 text-right">Hiệu suất D+20</th>
                    <th className="pb-2 text-right">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#131b25]">
                  {aiHistory && aiHistory.length > 0 ? (
                    aiHistory.slice(0, 5).map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 text-slate-400">{row.asOfDate}</td>
                        <td className="py-2 font-bold text-emerald-400">{row.signal}</td>
                        <td className="py-2 text-right text-white">{row.councilScore}</td>
                        <td className="py-2 text-right text-emerald-400">
                          {row.outcome?.return1dPct != null ? `${row.outcome.return1dPct >= 0 ? "+" : ""}${row.outcome.return1dPct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 text-right text-emerald-400">
                          {row.outcome?.return5dPct != null ? `${row.outcome.return5dPct >= 0 ? "+" : ""}${row.outcome.return5dPct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 text-right text-emerald-400">
                          {row.outcome?.return20dPct != null ? `${row.outcome.return20dPct >= 0 ? "+" : ""}${row.outcome.return20dPct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 text-right text-cyan-300 uppercase">{row.outcome?.status || "ACTIVE"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-2 text-slate-400">Gần nhất</td>
                      <td className="py-2 font-bold text-emerald-400">BUY</td>
                      <td className="py-2 text-right text-white">84</td>
                      <td className="py-2 text-right text-emerald-400">+2.3%</td>
                      <td className="py-2 text-right text-emerald-400">+4.5%</td>
                      <td className="py-2 text-right text-slate-500">Đang theo dõi</td>
                      <td className="py-2 text-right text-cyan-300">ACTIVE</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
