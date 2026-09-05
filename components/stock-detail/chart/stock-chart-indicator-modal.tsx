"use client"

import React from "react"
import { Check, Activity, BarChart2, TrendingUp, Layers, Compass } from "lucide-react"
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
    accent: string
  }[] = [
    {
      key: "showMa",
      title: "Đường trung bình động",
      code: "MA (20, 50, 200)",
      desc: "Xu hướng giá trung bình các mốc then chốt",
      icon: <TrendingUp className="size-4 text-emerald-400" />,
      accent: "emerald",
    },
    {
      key: "showRsi",
      title: "Chỉ số sức mạnh tương đối",
      code: "RSI (14)",
      desc: "Đo lường vùng quá mua / quá bán (30 - 70)",
      icon: <Activity className="size-4 text-purple-400" />,
      accent: "purple",
    },
    {
      key: "showMacd",
      title: "Hội tụ / Phân kỳ trung bình động",
      code: "MACD (12, 26, 9)",
      desc: "Histogram động lượng và đường tín hiệu MACD",
      icon: <BarChart2 className="size-4 text-cyan-400" />,
      accent: "cyan",
    },
    {
      key: "showIchimoku",
      title: "Hệ thống Mây Ichimoku",
      code: "Ichimoku (9, 26, 52)",
      desc: "Mây Kumo, Tenkan-sen, Kijun-sen định hướng chu kỳ",
      icon: <Layers className="size-4 text-amber-400" />,
      accent: "amber",
    },
    {
      key: "showBollinger",
      title: "Dải biến động Bollinger Bands",
      code: "BB (20, 2)",
      desc: "Dải trên, dải dưới đo lường độ nén biến động giá",
      icon: <Compass className="size-4 text-blue-400" />,
      accent: "blue",
    },
    {
      key: "showVolumeProfile",
      title: "Phân bổ khối lượng & POC",
      code: "Volume Profile (POC)",
      desc: "Xác định điểm tích lũy thanh khoản lớn nhất (Point of Control)",
      icon: <BarChart2 className="size-4 text-rose-400" />,
      accent: "rose",
    },
  ]

  const toggleIndicator = (key: keyof IndicatorConfig) => {
    onChange({
      ...config,
      [key]: !config[key],
    })
  }

  return (
    <div className="absolute right-0 top-10 z-50 w-80 rounded-2xl border border-white/[0.1] bg-[#0c131c]/98 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.85)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-2 mb-2">
        <span className="text-xs font-bold text-slate-200 tracking-wide font-mono">
          CHỈ BÁO KỸ THUẬT ({Object.values(config).filter(Boolean).length}/6)
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:text-white transition-colors text-xs"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {indicators.map((ind) => {
          const isEnabled = config[ind.key]
          return (
            <button
              key={ind.key}
              type="button"
              onClick={() => toggleIndicator(ind.key)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-xl p-2 text-left transition-colors border",
                isEnabled
                  ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                  : "border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
              )}
            >
              <div className="mt-0.5 shrink-0">{ind.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-slate-200">{ind.code}</span>
                  <div
                    className={cn(
                      "flex size-4 items-center justify-center rounded border transition-colors",
                      isEnabled ? "border-cyan-400 bg-cyan-500 text-black" : "border-white/20",
                    )}
                  >
                    {isEnabled && <Check className="size-3 stroke-[3]" />}
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 truncate">{ind.title}</div>
                <div className="text-[10px] text-slate-500">{ind.desc}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
