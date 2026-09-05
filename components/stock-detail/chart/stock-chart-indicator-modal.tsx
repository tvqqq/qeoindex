"use client"

import React from "react"
import { Check, Activity, BarChart2, TrendingUp, Layers, Compass, Sparkles, X } from "lucide-react"
import { cn } from "@/modules/shared/ui/cn"
import type { IndicatorConfig } from "./stock-chart-types"

interface IndicatorModalProps {
  config: IndicatorConfig
  onChange: (updated: IndicatorConfig) => void
  onClose: () => void
}

export function StockChartIndicatorModal({ config, onChange, onClose }: IndicatorModalProps) {
  const indicators: {
    key: keyof IndicatorConfig
    title: string
    code: string
    desc: string
    icon: React.ReactNode
  }[] = [
    {
      key: "showMa",
      title: "Đường trung bình động",
      code: "MA (20, 50, 200)",
      desc: "Xu hướng giá trung bình các mốc then chốt",
      icon: <TrendingUp className="size-3.5 text-emerald-400" />,
    },
    {
      key: "showRsi",
      title: "Chỉ số sức mạnh tương đối",
      code: "RSI (14)",
      desc: "Đo lường vùng quá mua / quá bán (30 - 70)",
      icon: <Activity className="size-3.5 text-purple-400" />,
    },
    {
      key: "showMacd",
      title: "Hội tụ / Phân kỳ trung bình động",
      code: "MACD (12, 26, 9)",
      desc: "Histogram động lượng và đường tín hiệu MACD",
      icon: <BarChart2 className="size-3.5 text-cyan-400" />,
    },
    {
      key: "showIchimoku",
      title: "Hệ thống Mây Ichimoku",
      code: "Ichimoku (9, 26, 52)",
      desc: "Mây Kumo, Tenkan-sen, Kijun-sen định hướng chu kỳ",
      icon: <Layers className="size-3.5 text-amber-400" />,
    },
    {
      key: "showQeoBase129",
      title: "QeoIndex Base Line 129",
      code: "QEO Base (129)",
      desc: "Ichimoku base line 129 — tín hiệu chu kỳ riêng QeoIndex",
      icon: <Sparkles className="size-3.5 text-pink-400" />,
    },
    {
      key: "showBollinger",
      title: "Dải biến động Bollinger Bands",
      code: "BB (20, 2)",
      desc: "Dải trên, dải dưới đo lường độ nén biến động giá",
      icon: <Compass className="size-3.5 text-blue-400" />,
    },
    {
      key: "showVolumeProfile",
      title: "Phân bổ khối lượng & POC",
      code: "Volume Profile (POC)",
      desc: "Điểm thanh khoản lớn nhất trong phạm vi đang xem",
      icon: <BarChart2 className="size-3.5 text-rose-400" />,
    },
  ]

  const toggleIndicator = (key: keyof IndicatorConfig) => {
    onChange({
      ...config,
      [key]: !config[key],
    })
  }

  const enabledCount = Object.values(config).filter(Boolean).length

  return (
    <div className="absolute left-0 top-8 z-50 w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-white/[0.12] bg-[#0b0f15]/98 shadow-[0_18px_52px_rgba(0,0,0,0.82)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
      <div className="flex h-9 items-center justify-between border-b border-white/[0.08] px-2.5">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">Indicators</span>
          <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-slate-500">
            {enabledCount}/{indicators.length} active
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng bảng chỉ báo"
          className="flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="max-h-[400px] space-y-0.5 overflow-y-auto p-1.5">
        {indicators.map((ind) => {
          const isEnabled = Boolean(config[ind.key])
          return (
            <button
              key={ind.key}
              type="button"
              onClick={() => toggleIndicator(ind.key)}
              className={cn(
                "group flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                isEnabled
                  ? "border-cyan-300/20 bg-cyan-300/[0.06] text-slate-100"
                  : "border-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-slate-200",
              )}
            >
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border border-white/[0.07] bg-white/[0.025]">
                {ind.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-slate-200">{ind.code}</span>
                  <div
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                      isEnabled
                        ? "border-cyan-300/50 bg-cyan-300/90 text-[#071016]"
                        : "border-white/15 bg-transparent text-transparent group-hover:border-white/25",
                    )}
                  >
                    <Check className="size-3 stroke-[3]" />
                  </div>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-slate-400">{ind.title}</div>
                <div className="truncate text-[9px] text-slate-600">{ind.desc}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
