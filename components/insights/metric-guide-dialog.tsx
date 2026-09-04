"use client"

import { useId, useMemo, useState, useEffect } from "react"
import {
  BookOpen,
  Search,
  ShieldAlert,
  Sparkles,
  X,
  ChevronRight,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  INSIGHTS_METRIC_SEMANTICS,
  INSIGHTS_METRIC_GUIDE_VERSION,
  getMetricSemantic,
  type MetricSource,
} from "@/modules/research/insights/metric-semantics"
import { cn } from "@/lib/utils"

export interface MetricGuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMetricKey?: string | null
}

const CATEGORY_TABS: Array<{ id: "all" | "quickstart" | "quality" | "momentum" | "risk_valuation"; label: string }> = [
  { id: "all", label: "Tất cả chỉ số" },
  { id: "quickstart", label: "Bắt đầu trong 60s" },
  { id: "quality", label: "Chất lượng doanh nghiệp" },
  { id: "momentum", label: "Sức mạnh & Luân chuyển" },
  { id: "risk_valuation", label: "Rủi ro, Định giá & Thanh khoản" },
]

const QUICKSTART_STEPS = [
  {
    step: 1,
    title: "1. Thị trường có thuận không?",
    desc: "Xem VNIndex, Độ rộng, Thanh khoản và Risk score để nhận diện môi trường chung.",
    metrics: ["market_risk_score", "market_breadth", "market_liquidity", "vnindex_regime"],
    advice: "Nếu Risk score > 60 hoặc độ rộng giảm chiếm ưu thế, ưu tiên phòng thủ và kiểm soát quy mô giải ngân.",
  },
  {
    step: 2,
    title: "2. Dòng tiền nghiêng về ngành nào?",
    desc: "Xem RS ngành và RRG ngành để tìm các nhóm ngành đang dẫn dắt thị trường.",
    metrics: ["kfsp_sector_rs_score", "kfsp_sector_rrg_state"],
    advice: "Ưu tiên nhóm ngành nằm ở góc phần tư Dẫn dắt hoặc Phục hồi và có điểm RS-S ngành >= 70.",
  },
  {
    step: 3,
    title: "3. Mã có chất lượng và sức mạnh không?",
    desc: "Đối chiếu 4M / CANSLIM với RSs, RSm và RRG cổ phiếu.",
    metrics: ["kfsp_score_4m", "kfsp_canslim_score", "rs_short", "rs_medium", "kfsp_stock_rrg_state"],
    advice: "Mã đạt chuẩn khi có nền tảng cơ bản vững (4M/CANSLIM >= 65) cộng hưởng sức mạnh giá ngắn/trung hạn vượt trội (RSs/RSm >= 70).",
  },
  {
    step: 4,
    title: "4. Điều gì có thể phủ định?",
    desc: "Mở chi tiết để xem Beta, khoảng cách SMA, RSI, MACD, thanh khoản và dòng tiền.",
    metrics: ["beta", "price_vs_sma20_pct", "rsi_14", "volume_vs_previous_session_pct", "kfsp_price_potential"],
    advice: "Kiểm tra rủi ro quá mua (RSI quá cao, kéo dãn quá xa SMA50) hoặc thiếu khối lượng xác nhận ở các điểm bứt phá.",
  },
]

function sourceBadge(source: MetricSource) {
  switch (source) {
    case "kfsp":
      return <Badge variant="outline" className="border-cyan-400/30 bg-cyan-400/10 text-cyan-300 text-[11px]">KFSP</Badge>
    case "qeoindex":
      return <Badge variant="outline" className="border-brand/30 bg-brand/10 text-brand text-[11px]">QeoIndex derived</Badge>
    case "market_feed":
      return <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-amber-300 text-[11px]">Market feed</Badge>
  }
}

export function MetricGuideDialog({ open, onOpenChange, initialMetricKey }: MetricGuideDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"all" | "quickstart" | "quality" | "momentum" | "risk_valuation">("all")
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)

  const scrollToMetric = (key: string) => {
    const el = document.getElementById(`guide-metric-${key}`)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  useEffect(() => {
    if (!open) {
      return
    }
    if (!initialMetricKey) {
      return
    }
    const semantic = getMetricSemantic(initialMetricKey)
    if (semantic) {
      const timer = setTimeout(() => {
        setHighlightedKey(semantic.key)
        setQuery("")
        setActiveTab("all")
        scrollToMetric(semantic.key)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open, initialMetricKey])

  const filteredMetrics = useMemo(() => {
    let list = [...INSIGHTS_METRIC_SEMANTICS]

    if (activeTab === "quality") {
      list = list.filter((m) => m.category === "quality")
    } else if (activeTab === "momentum") {
      list = list.filter((m) => m.category === "momentum" || m.category === "relative_strength" || m.category === "rotation")
    } else if (activeTab === "risk_valuation") {
      list = list.filter((m) => m.category === "risk" || m.category === "valuation" || m.category === "liquidity" || m.category === "market")
    }

    if (!query.trim()) return list

    const q = query.trim().toLowerCase()
    return list.filter((m) => {
      if (m.key.toLowerCase().includes(q)) return true
      if (m.label.toLowerCase().includes(q)) return true
      if (m.aliases.some((a) => a.toLowerCase().includes(q))) return true
      if (m.beginner.what.toLowerCase().includes(q)) return true
      return false
    })
  }, [activeTab, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex h-[92vh] max-h-[92vh] w-full max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden border border-white/10 bg-[#080d19] p-0 font-ticker text-white shadow-[0_24px_80px_-20px_rgba(0,0,0,0.95),0_0_40px_-20px_rgba(34,211,238,0.3)] sm:max-w-[540px] md:max-w-[620px] lg:max-w-[680px]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0c1322] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand">
              <BookOpen className="size-4.5" />
            </div>
            <div>
              <DialogTitle id={titleId} className="text-base font-extrabold text-white sm:text-lg">
                Hướng dẫn đọc chỉ số Insights
              </DialogTitle>
              <DialogDescription id={descriptionId} className="text-xs text-muted-2">
                Hệ thống semantic chuẩn hóa ({INSIGHTS_METRIC_GUIDE_VERSION}) · Đọc thị trường đúng phương pháp
              </DialogDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Đóng hướng dẫn"
            className="size-8 rounded-lg text-muted-2 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4.5" />
          </Button>
        </div>

        {/* Search & Tabs */}
        <div className="shrink-0 border-b border-white/[0.06] bg-[#090e1a] p-4 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (activeTab === "quickstart" && e.target.value.trim()) {
                  setActiveTab("all")
                }
              }}
              placeholder="Tìm chỉ số theo tên hoặc từ khóa (RS, RRG, 4M, CANSLIM, Beta...)"
              aria-label="Tìm kiếm chỉ số"
              className="h-9.5 border-white/10 bg-cell pl-9 text-xs sm:text-sm text-white placeholder:text-muted focus-visible:border-brand/50 focus-visible:ring-brand/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-white"
              >
                Xóa
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id)
                  if (tab.id === "quickstart") setQuery("")
                }}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors",
                  activeTab === tab.id
                    ? "bg-brand/20 text-brand border border-brand/35"
                    : "bg-white/[0.03] text-muted-2 border border-white/[0.06] hover:bg-white/[0.06] hover:text-white",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Quickstart Sequence view */}
          {activeTab === "quickstart" && !query && (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/25 bg-brand/[0.05] p-4 text-xs text-muted-2 leading-5">
                <div className="flex items-center gap-2 font-bold text-brand text-sm mb-1.5">
                  <Sparkles className="size-4 shrink-0" /> Thứ tự đọc chuẩn cho nhà đầu tư
                </div>
                Đọc theo trình tự: <strong>Thị trường → Ngành → Cổ phiếu → Xác nhận/Rủi ro</strong>. Điểm số cao là công cụ đối chiếu tương đối, không phải lệnh mua tự động.
              </div>

              <div className="space-y-3">
                {QUICKSTART_STEPS.map((step) => (
                  <div key={step.step} className="rounded-xl border border-white/[0.08] bg-[#0c1424] p-4">
                    <h3 className="text-sm font-bold text-white flex items-center justify-between">
                      <span>{step.title}</span>
                      <span className="text-[11px] font-mono text-muted-2">Bước {step.step}/4</span>
                    </h3>
                    <p className="mt-1 text-xs text-muted-2">{step.desc}</p>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {step.metrics.map((k) => {
                        const m = getMetricSemantic(k)
                        if (!m) return null
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => {
                              setActiveTab("all")
                              setQuery("")
                              setHighlightedKey(m.key)
                              setTimeout(() => scrollToMetric(m.key), 100)
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-cyan-300 hover:bg-white/[0.08] hover:text-white"
                          >
                            {m.label} <ChevronRight className="size-3 opacity-60" />
                          </button>
                        )
                      })}
                    </div>

                    <div className="mt-3 rounded-lg border border-white/[0.05] bg-black/20 p-2.5 text-[11px] text-muted-2 leading-4.5">
                      <strong className="text-amber-300/90 font-semibold">Lời khuyên thực chiến:</strong> {step.advice}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metric Cards List */}
          {(activeTab !== "quickstart" || query) && (
            <div className="space-y-4">
              {filteredMetrics.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-2">
                  Không tìm thấy chỉ số phù hợp với từ khóa &ldquo;{query}&rdquo;.
                </div>
              ) : (
                filteredMetrics.map((metric) => {
                  const isHighlighted = highlightedKey === metric.key
                  return (
                    <div
                      key={metric.key}
                      id={`guide-metric-${metric.key}`}
                      className={cn(
                        "rounded-xl border bg-[#0b1220] p-4 transition-colors",
                        isHighlighted
                          ? "border-brand/60 bg-brand/[0.04] ring-1 ring-brand/40 shadow-[0_0_24px_-8px_rgba(34,211,238,0.4)]"
                          : "border-white/[0.08] hover:border-white/20",
                      )}
                    >
                      {/* Card Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">{metric.label}</h4>
                          {sourceBadge(metric.source)}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-2 font-mono">
                          {metric.horizon && <span className="rounded bg-white/[0.04] px-1.5 py-0.5">{metric.horizon}</span>}
                          <span className="rounded bg-white/[0.04] px-1.5 py-0.5">{metric.unit}</span>
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="mt-3 space-y-2.5 text-xs">
                        <div>
                          <span className="font-semibold text-cyan-300">Là gì:</span>{" "}
                          <span className="text-foreground/90 leading-5">{metric.beginner.what}</span>
                        </div>

                        <div>
                          <span className="font-semibold text-emerald-300">Cách đọc nhanh:</span>{" "}
                          <span className="text-foreground/90 leading-5">{metric.beginner.read}</span>
                        </div>

                        {metric.beginner.combineWith.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[11px] text-muted-2">Nên kết hợp với:</span>
                            {metric.beginner.combineWith.map((relatedKey) => {
                              const related = getMetricSemantic(relatedKey)
                              return (
                                <button
                                  key={relatedKey}
                                  type="button"
                                  onClick={() => {
                                    if (related) {
                                      setHighlightedKey(related.key)
                                      setTimeout(() => scrollToMetric(related.key), 50)
                                    }
                                  }}
                                  className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-muted-2 hover:bg-white/[0.08] hover:text-white"
                                >
                                  {related?.label || relatedKey}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {/* Anti-meaning warning callout */}
                        <div className="mt-2.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.07] p-2.5 text-[11px] text-rose-200 leading-4.5">
                          <div className="flex items-center gap-1.5 font-bold text-rose-300 mb-0.5">
                            <ShieldAlert className="size-3.5 shrink-0" /> Không có nghĩa là:
                          </div>
                          {metric.beginner.notMeaning}
                        </div>

                        {/* Provenance note */}
                        <div className="text-[10px] text-muted opacity-75 pt-1 border-t border-white/[0.04]">
                          Nguồn &amp; công thức: {metric.provenanceNote}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.08] bg-[#0c1322] px-5 py-3 text-xs text-muted-2">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-emerald-400"></span>
            <span>QeoIndex Standard Semantic Registry</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 border-white/10 text-xs text-white hover:bg-white/10"
          >
            Đã hiểu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
