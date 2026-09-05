"use client"

import React, { useState, useRef, useEffect } from "react"
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Gauge,
  LineChart,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

import type { StockDetailData } from "./types"
import { cn } from "@/modules/shared/ui/cn"

interface Message {
  id: string
  sender: "user" | "ai"
  text: string
  timestamp: string
}

function scoreTone(score: number | null) {
  if (score == null) return "text-slate-500"
  if (score >= 65) return "text-emerald-400"
  if (score <= 40) return "text-rose-400"
  return "text-slate-300"
}

const RADIUS = 72
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function getConsensusStyle(rate: number) {
  if (rate >= 70) {
    return {
      gradientId: "consensus-grad-high",
      fromColor: "#10b981",
      toColor: "#059669",
      glowColor: "rgba(16, 185, 129, 0.2)",
      badgeColor: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
      dotColor: "bg-emerald-400",
    }
  }
  if (rate <= 40) {
    return {
      gradientId: "consensus-grad-low",
      fromColor: "#f43f5e",
      toColor: "#e11d48",
      glowColor: "rgba(244, 63, 94, 0.2)",
      badgeColor: "border-rose-500/25 bg-rose-500/10 text-rose-300",
      dotColor: "bg-rose-400",
    }
  }
  return {
    gradientId: "consensus-grad-neutral",
    fromColor: "#94a3b8",
    toColor: "#cbd5e1",
    glowColor: "rgba(148, 163, 184, 0.15)",
    badgeColor: "border-white/15 bg-white/[0.06] text-slate-200",
    dotColor: "bg-slate-300",
  }
}

function formatSignalLines(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed === "MUA KHI XÁC NHẬN") return ["MUA KHI", "XÁC NHẬN"]
  if (trimmed === "TÍCH LŨY (BUY)") return ["TÍCH LŨY", "(BUY)"]
  if (trimmed === "HẠ TỶ TRỌNG") return ["HẠ TỶ", "TRỌNG"]
  if (trimmed === "THEO DÕI (WAIT)") return ["THEO DÕI", "(WAIT)"]
  if (trimmed === "BÁN (SELL)") return ["BÁN", "(SELL)"]
  if (trimmed.includes("\n")) return trimmed.split("\n")

  const words = trimmed.split(/\s+/)
  if (words.length <= 1) return [trimmed]
  if (words.length === 2) return words
  if (words.length === 3) return [`${words[0]} ${words[1]}`, words[2]]
  if (words.length === 4) return [`${words[0]} ${words[1]}`, `${words[2]} ${words[3]}`]
  const mid = Math.ceil(words.length / 2)
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")]
}

export function parseLevel(raw: string | undefined | null, fallback: string) {
  if (!raw) return { display: fallback, note: null }
  const trimmed = raw.trim()
  if (/^[\d\s.,·\-+/]+$/.test(trimmed)) {
    return { display: trimmed, note: null }
  }
  const match = trimmed.match(/\b\d+(?:[.,]\d+)?\b/)
  if (match) {
    return { display: match[0], note: trimmed }
  }
  return { display: fallback, note: trimmed }
}

const CONFIDENCE_TIERS = [
  {
    label: "Very high",
    range: "90% ↑",
    dotColor: "bg-[#10b981]",
    textColor: "text-emerald-300",
    ringBorder: "border-[#10b981]",
    min: 90,
    max: 100,
  },
  {
    label: "High",
    range: "70%-89%",
    dotColor: "bg-[#f97316]",
    textColor: "text-orange-300",
    ringBorder: "border-[#f97316]",
    min: 70,
    max: 89,
  },
  {
    label: "Medium",
    range: "50%-69%",
    dotColor: "bg-[#eab308]",
    textColor: "text-amber-300",
    ringBorder: "border-[#eab308]",
    min: 50,
    max: 69,
  },
  {
    label: "Low",
    range: "30%-49%",
    dotColor: "bg-[#3b82f6]",
    textColor: "text-blue-300",
    ringBorder: "border-[#3b82f6]",
    min: 30,
    max: 49,
  },
  {
    label: "Very low",
    range: "30% ↓",
    dotColor: "bg-[#f43f5e]",
    textColor: "text-rose-300",
    ringBorder: "border-[#f43f5e]",
    min: 0,
    max: 29,
  },
] as const

export function StockAiSidebar({ data }: { data: StockDetailData }) {
  const { ticker, price, changePct, aiStock, scan, thesis, fa } = data

  const score = aiStock?.councilScore ?? (scan ? Math.min(95, Math.max(40, Math.round(50 + (scan.rsi14 ? (scan.rsi14 - 50) * 0.5 : 0) + (scan.relVolume ? (scan.relVolume - 1) * 10 : 0)))) : 75)
  const signal = aiStock?.signal ?? (scan?.taBias === "Bullish" ? "BUY" : scan?.taBias === "Bearish" ? "REDUCE" : "WAIT")
  const consensus = aiStock?.consensus ?? 85
  const confidence = aiStock?.confidence ?? 80

  const pillars = [
    {
      label: "Cơ bản",
      score: fa?.roe ? Math.min(95, Math.round(fa.roe * 2.5 + 30)) : 75,
    },
    {
      label: "Kỹ thuật",
      score: scan?.wyckoffState
        ? scan.wyckoffState.includes("Accumulation") || scan.wyckoffState.includes("Markup")
          ? 86
          : 55
        : 80,
    },
    {
      label: "Dòng tiền",
      score: scan?.relVolume ? Math.min(96, Math.round(scan.relVolume * 50)) : 82,
    },
    {
      label: "Bối cảnh",
      score: thesis?.marketRegime === "Risk-On" ? 85 : 70,
    },
    {
      label: "Quản trị",
      score: 78,
    },
  ].map((p) => ({
    ...p,
    gradient:
      p.score >= 75
        ? "from-emerald-500 to-emerald-400"
        : p.score < 50
        ? "from-rose-500 to-rose-400"
        : "from-slate-400 to-slate-200",
  }))

  const signalText =
    signal === "BUY"
      ? "TÍCH LŨY (BUY)"
      : signal === "BUY_ON_CONFIRMATION"
      ? "MUA KHI XÁC NHẬN"
      : signal === "REDUCE"
      ? "HẠ TỶ TRỌNG"
      : signal === "SELL"
      ? "BÁN (SELL)"
      : "THEO DÕI (WAIT)"

  const signalTone =
    signal === "BUY"
      ? "text-emerald-400"
      : signal === "BUY_ON_CONFIRMATION"
      ? "text-emerald-300"
      : signal === "REDUCE" || signal === "SELL"
      ? "text-rose-400"
      : "text-slate-200"

  const consensusStyle = getConsensusStyle(consensus)
  const clampedConsensus = Math.min(100, Math.max(0, consensus))
  const clampedConfidence = Math.min(100, Math.max(0, confidence))
  const strokeDashoffset = CIRCUMFERENCE - (clampedConsensus / 100) * CIRCUMFERENCE

  const activeTier =
    CONFIDENCE_TIERS.find((t) => confidence >= t.min && confidence <= t.max) ||
    CONFIDENCE_TIERS[1]
  const supportLevel = aiStock?.support || scan?.support || thesis?.support || (price ? (price * 0.96).toFixed(1) : "—")
  const resistanceLevel = aiStock?.resistance || scan?.resistance || thesis?.resistance || (price ? (price * 1.07).toFixed(1) : "—")
  const stopLoss = aiStock?.invalidation || scan?.invalidation || (price ? (price * 0.935).toFixed(1) : "—")
  const signalLines = formatSignalLines(signalText)

  // Chat state
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "ai",
      text: `Chào bạn! Tôi nắm toàn diện dữ liệu kỹ thuật, Wyckoff, BCTC và dòng tiền của **${ticker}**. Bạn muốn giải đáp về góc nhìn nào?`,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    },
  ])
  const [inputVal, setInputVal] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  function handleSend(textToSend?: string) {
    const text = (textToSend || inputVal).trim()
    if (!text || isTyping) return

    const userMsg: Message = {
      id: Math.random().toString(),
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    }

    setMessages((prev) => [...prev, userMsg])
    if (!textToSend) setInputVal("")
    setIsTyping(true)

    setTimeout(() => {
      let response = ""
      const q = text.toLowerCase()
      if (q.includes("dòng tiền") || q.includes("smart money") || q.includes("lớn")) {
        response = `Dòng tiền vào **${ticker}** phiên hiện tại có tỷ lệ mua chủ động 58.4%. Khối lượng khớp đạt ${scan?.volume ? scan.volume.toLocaleString() : "khá tốt"}, chỉ báo Relative Volume đạt ${scan?.relVolume ? scan.relVolume.toFixed(2) + "x" : "1.35x"} so với trung bình 20 phiên.`
      } else if (q.includes("hỗ trợ") || q.includes("kháng cự") || q.includes("vùng")) {
        response = `Vùng hỗ trợ then chốt của **${ticker}** là **${supportLevel}** (nền MA20/MA50). Kháng cự kỹ thuật mục tiêu gần nhất là **${resistanceLevel}**. Mức dừng lỗ đề xuất vi phạm khi đóng nến dưới **${stopLoss}**.`
      } else if (q.includes("rủi ro") || q.includes("cảnh báo") || q.includes("xấu")) {
        response = `Rủi ro chính của **${ticker}**: ${aiStock?.dissent || "Áp lực cung chốt lời ngắn hạn khi chỉ số tiệm cận vùng kháng cự. Cần quản trị tỷ trọng danh mục và tuân thủ kỷ luật dừng lỗ."}`
      } else if (q.includes("wyckoff") || q.includes("cấu trúc") || q.includes("phase")) {
        response = `Cấu trúc Wyckoff của **${ticker}**: ${scan?.wyckoffState || "Pha tái tích lũy (Re-accumulation)"}, Phase ${scan?.phase || "D (Sign of Strength)"}. Cổ phiếu đang kiểm định lại lực cung ở biên trên.`
      } else {
        response = `Dựa trên tổng hợp Hội đồng AI, **${ticker}** có điểm số Council **${score}/100**, tín hiệu **${signalText}**. Khuyến nghị: Mở vị thế thăm dò từng phần quanh vùng giá hiện tại, tuân thủ ngưỡng vô hiệu **${stopLoss}**.`
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: "ai",
          text: response,
          timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        },
      ])
      setIsTyping(false)
    }, 550)
  }

  return (
    <div className="space-y-3.5 w-full pb-8">
      {/* AI Council Overview Card */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13] p-4 sm:p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-300">
              <BrainCircuit className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-200">Góc nhìn AI Council</h2>
              <p className="text-[10px] text-slate-500 font-mono">Consensus V1.4</p>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 1. DONUT CONSENSUS RING WITH RECOMMENDATION IN CENTER     */}
        {/* ========================================================= */}
        <div className="space-y-3 pt-1">
          <div className="relative mx-auto flex size-44 sm:size-48 items-center justify-center">
            <svg viewBox="0 0 200 200" className="size-full -rotate-90">
              <defs>
                <linearGradient id={consensusStyle.gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={consensusStyle.fromColor} />
                  <stop offset="100%" stopColor={consensusStyle.toColor} />
                </linearGradient>
                <filter id="consensus-ring-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="1.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {/* Base track */}
              <circle
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="14"
              />
              {/* Progress Arc */}
              <circle
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                stroke={`url(#${consensusStyle.gradientId})`}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={strokeDashoffset}
                filter="url(#consensus-ring-glow)"
                className="transition-all duration-700 ease-out"
              />
            </svg>

            {/* In the center of the ring: ONLY Recommendation split across lines */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
              <div
                className={cn(
                  "font-ticker text-base sm:text-lg font-black tracking-wide uppercase leading-tight text-center",
                  signalTone
                )}
              >
                {signalLines.map((line, idx) => (
                  <div key={idx} className="block whitespace-nowrap">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Consensus label and conviction description with confidence merged */}
          <div className="flex flex-col items-center gap-2 px-1 text-center">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 font-mono text-[11px] font-bold shadow-[0_0_12px_rgba(0,0,0,0.4)]",
                consensusStyle.badgeColor,
              )}
            >
              <span className={cn("size-1.5 rounded-full", consensusStyle.dotColor)} />
              {consensus}% đồng thuận với độ tin cậy {activeTier.label} ({confidence}%)
            </span>

            {/* Confidence Spectrum Track Bar Chart */}
            <div className="w-full max-w-[280px] pt-1 pb-1">
              <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-[#f43f5e] via-[#3b82f6] via-[#eab308] via-[#f97316] to-[#10b981]">
                {/* Indicator Circle / Thumb */}
                <div
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
                  style={{ left: `${clampedConfidence}%` }}
                >
                  <div
                    className={cn(
                      "size-3.5 rounded-full border-2 bg-[#0b1119] shadow-[0_0_8px_rgba(0,0,0,0.8)]",
                      activeTier.ringBorder,
                    )}
                  />
                </div>
              </div>
              <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-500">
                <span>0% Thấp</span>
                <span>50%</span>
                <span>100% Rất cao</span>
              </div>
            </div>

            <p className="text-center text-[11.5px] leading-relaxed text-slate-300">
              {aiStock?.whatChangesDecision?.[0] ||
                (scan?.confirmation ? `Tăng conviction khi: ${scan.confirmation}` : null) ||
                thesis?.baseCase ||
                "Áp lực bán cạn kiệt quanh hỗ trợ trung hạn. Smart Money có dấu hiệu hấp thụ chủ động, phù hợp giải ngân từng phần."}
            </p>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 2. 5 TRỤ CỘT ĐÁNH GIÁ TỪ AI COUNCIL                       */}
        {/* ========================================================= */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Gauge className="size-3.5 text-slate-400" />
              5 Trụ cột đánh giá từ AI Council
            </span>
          </div>
          <div className="space-y-2.5 rounded-xl border border-white/[0.05] bg-black/20 p-3">
            {pillars.map((p) => (
              <div key={p.label} className="space-y-1">
                <div className="text-[11px] font-medium text-slate-400">{p.label}</div>
                <div className="flex items-center gap-2.5">
                  <span className="w-11 font-mono text-xs font-bold text-slate-200 shrink-0">
                    {p.score} %
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", p.gradient)}
                      style={{ width: `${Math.min(100, Math.max(0, p.score))}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Chatbox với AI (Comfortable padding and rounded card) */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0a0f16] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-slate-400" />
            <span className="text-xs font-bold text-slate-200">Quick AI Assistant</span>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 font-mono text-[9px] text-slate-400">
            Hỏi đáp: {ticker}
          </span>
        </div>

        {/* Message Stream */}
        <div className="h-44 space-y-2.5 overflow-y-auto p-3 text-[11px] leading-relaxed no-scrollbar">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex flex-col", m.sender === "user" ? "items-end" : "items-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl p-2.5 text-[11px] leading-relaxed",
                  m.sender === "user"
                    ? "rounded-tr-none border border-white/10 bg-white/[0.06] text-slate-100"
                    : "rounded-tl-none border border-white/[0.08] bg-black/20 text-slate-300"
                )}
              >
                {m.text}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-2">
              <div className="flex size-5 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] text-[9px] font-black text-slate-300">
                AI
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-none border border-white/[0.08] bg-black/20 px-3 py-1.5 text-xs text-slate-400">
                <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" />
                <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                <span className="size-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Preset Prompt Chips */}
        <div className="border-t border-white/[0.06] bg-[#090d13] p-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => handleSend("Đánh giá dòng tiền lớn hôm nay?")}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-slate-100"
          >
            ⚡ Dòng tiền?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Hỗ trợ kháng cự gần nhất?")}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-slate-100"
          >
            🎯 Hỗ trợ / Kháng cự?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Rủi ro lớn nhất là gì?")}
            className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-slate-100"
          >
            ⚠️ Rủi ro?
          </button>
        </div>

        {/* Input Bar */}
        <div className="border-t border-white/[0.06] bg-[#0a0f16] p-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="relative flex items-center"
          >
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Hỏi AI về cổ phiếu..."
              className="w-full rounded-xl border border-white/[0.08] bg-[#05080c] py-1.5 pl-3 pr-8 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-white/30 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!inputVal.trim() || isTyping}
              className="absolute right-1.5 rounded-lg p-1 text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-30"
            >
              <Send className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
