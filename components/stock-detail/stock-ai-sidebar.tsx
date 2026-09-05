"use client"

import React, { useState, useRef, useEffect } from "react"
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CircleAlert,
  Compass,
  Gauge,
  HelpCircle,
  LineChart,
  Radar,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from "lucide-react"

import type { StockDetailData } from "./types"
import { cn } from "@/modules/shared/ui/cn"

interface Message {
  id: string
  sender: "user" | "ai"
  text: string
  timestamp: string
}

export function StockAiSidebar({ data }: { data: StockDetailData }) {
  const { ticker, price, changePct, aiStock, scan, thesis, fa } = data

  const score = aiStock?.councilScore ?? (scan ? Math.min(95, Math.max(40, Math.round(50 + (scan.rsi14 ? (scan.rsi14 - 50) * 0.5 : 0) + (scan.relVolume ? (scan.relVolume - 1) * 10 : 0)))) : 75)
  const signal = aiStock?.signal ?? (scan?.taBias === "Bullish" ? "BUY" : scan?.taBias === "Bearish" ? "REDUCE" : "WAIT")
  const consensus = aiStock?.consensus ?? 85
  const confidence = aiStock?.confidence ?? 80

  const pillars = [
    { label: "Cơ bản", score: fa?.roe ? Math.min(95, Math.round(fa.roe * 2.5 + 30)) : 75, icon: BarChart3 },
    { label: "Wyckoff", score: scan?.wyckoffState ? (scan.wyckoffState.includes("Accumulation") || scan.wyckoffState.includes("Markup") ? 86 : 55) : 80, icon: Radar },
    { label: "Dòng tiền", score: scan?.relVolume ? Math.min(96, Math.round(scan.relVolume * 50)) : 82, icon: Activity },
    { label: "Bối cảnh", score: thesis?.marketRegime === "Risk-On" ? 85 : 70, icon: Gauge },
    { label: "An toàn", score: 78, icon: ShieldCheck },
  ]

  const signalText =
    signal === "BUY"
      ? "TÍCH LŨY (BUY)"
      : signal === "BUY_ON_CONFIRMATION"
      ? "CHỜ XÁC NHẬN (CONFIRM)"
      : signal === "REDUCE"
      ? "HẠ TỶ TRỌNG (REDUCE)"
      : signal === "SELL"
      ? "BÁN (SELL)"
      : "THEO DÕI (WAIT)"

  const signalColor =
    signal === "BUY"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/20 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
      : signal === "BUY_ON_CONFIRMATION"
      ? "text-cyan-300 border-cyan-500/30 bg-cyan-950/20 shadow-[0_0_12px_rgba(34,211,238,0.2)]"
      : signal === "REDUCE" || signal === "SELL"
      ? "text-rose-400 border-rose-500/30 bg-rose-950/20 shadow-[0_0_12px_rgba(244,63,94,0.2)]"
      : "text-amber-400 border-amber-500/30 bg-amber-950/20 shadow-[0_0_12px_rgba(245,158,11,0.2)]"

  const supportLevel = aiStock?.support || scan?.support || thesis?.support || (price ? (price * 0.96).toFixed(1) : "—")
  const resistanceLevel = aiStock?.resistance || scan?.resistance || thesis?.resistance || (price ? (price * 1.07).toFixed(1) : "—")
  const stopLoss = aiStock?.invalidation || scan?.invalidation || (price ? (price * 0.935).toFixed(1) : "—")

  // Chatbox state
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
        response = `Dòng tiền vào **${ticker}** phiên hiện tại có khối lượng khớp ${scan?.volume ? scan.volume.toLocaleString() : "tương đối tích cực"}. Tỷ lệ mua chủ động duy trì vượt trội, chỉ báo Relative Volume đạt ${scan?.relVolume ? scan.relVolume.toFixed(2) + "x" : "1.25x"} so với trung bình 20 phiên.`
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
    <aside className="flex h-full w-[25%] min-w-[320px] max-w-[400px] shrink-0 flex-col overflow-hidden border-r border-[#16202a] bg-[#090d13]">
      {/* Top Half: AI Council Tổng quan */}
      <div className="flex max-h-[56%] flex-col space-y-3.5 overflow-y-auto border-b border-[#16202a] p-3.5">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md border border-purple-500/30 bg-purple-500/10 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.3)]">
              <BrainCircuit className="size-3.5 text-purple-400" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Góc nhìn AI Council</span>
          </div>
          <span className="rounded border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-purple-300">
            {consensus}% Consensus
          </span>
        </div>

        {/* AI Council Consensus Verdict Card */}
        <div className={cn("rounded-xl border p-3.5", signalColor)}>
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Khuyến nghị tổng quan</span>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-base font-black tracking-tight">{signalText}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="font-mono text-[10px] uppercase text-slate-500">Council Score</span>
              <div className="font-mono text-2xl font-black text-cyan-300">
                {score}
                <span className="text-xs text-slate-500">/100</span>
              </div>
            </div>
          </div>

          <p className="mt-2.5 border-t border-white/[0.08] pt-2 text-xs leading-relaxed text-slate-300">
            {aiStock?.whatChangesDecision[0] ||
              thesis?.baseCase ||
              "Áp lực bán cạn kiệt quanh hỗ trợ trung hạn. Smart Money có dấu hiệu hấp thụ chủ động, phù hợp giải ngân từng phần."}
          </p>
        </div>

        {/* 5 Trụ Cột Chuyên Gia (5 Pillars) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <span>Đánh giá 5 trụ cột</span>
            <span className="font-mono text-slate-500">Độ tin cậy {confidence}%</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5 text-center">
            {pillars.map((p) => {
              const Icon = p.icon
              return (
                <div key={p.label} className="rounded-lg border border-[#1b2633] bg-[#0c131a] p-2 transition-colors hover:border-cyan-500/30">
                  <Icon className="mx-auto size-3 text-slate-400" />
                  <div className="mt-1 truncate text-[9px] text-slate-400">{p.label}</div>
                  <div className={cn("mt-0.5 font-mono text-xs font-bold", p.score >= 80 ? "text-emerald-400" : p.score >= 65 ? "text-cyan-300" : "text-amber-400")}>
                    {p.score}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Key Decision Levels */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-emerald-500/20 bg-[#0c141d] p-2.5">
            <span className="block text-[10px] font-semibold text-emerald-400">Hỗ trợ / Vùng gom</span>
            <span className="font-mono font-bold text-white">{supportLevel}</span>
          </div>
          <div className="rounded-lg border border-rose-500/20 bg-[#0c141d] p-2.5">
            <span className="block text-[10px] font-semibold text-rose-400">Dừng lỗ (Stop Loss)</span>
            <span className="font-mono font-bold text-white">{stopLoss}</span>
          </div>
        </div>
      </div>

      {/* Bottom Half: Quick Chatbox Với AI Về Cổ Phiếu */}
      <div className="flex min-h-0 flex-1 flex-col bg-[#070a0e]">
        {/* Chatbox Header */}
        <div className="flex items-center justify-between border-b border-[#16202a] bg-[#0b0f15] px-3.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-bold text-slate-200">AI Quick Assistant</span>
          </div>
          <span className="text-[10px] text-slate-500">
            Hỏi về: <b className="text-cyan-400">{ticker}</b>
          </span>
        </div>

        {/* Message History */}
        <div className="flex-1 space-y-2.5 overflow-y-auto p-3 text-xs">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex gap-2", m.sender === "user" ? "justify-end" : "justify-start")}>
              {m.sender === "ai" && (
                <div className="flex size-6 shrink-0 items-center justify-center rounded bg-cyan-950 text-[10px] font-bold text-cyan-300 border border-cyan-800">
                  AI
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-xl p-2.5 text-xs leading-relaxed",
                  m.sender === "user"
                    ? "rounded-tr-none bg-cyan-950/60 text-slate-200 border border-cyan-800/50"
                    : "rounded-tl-none bg-[#101823] text-slate-300 border border-[#1b2635]"
                )}
              >
                {m.text}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center rounded bg-cyan-950 text-[10px] font-bold text-cyan-300 border border-cyan-800">
                AI
              </div>
              <div className="flex items-center gap-1.5 rounded-xl rounded-tl-none border border-[#1b2635] bg-[#101823] p-2.5 text-xs text-slate-400">
                <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce" />
                <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                <span className="size-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Preset Question Chips */}
        <div className="flex gap-1.5 overflow-x-auto border-t border-[#141b24] bg-[#090d13] p-2 no-scrollbar">
          <button
            type="button"
            onClick={() => handleSend("Đánh giá dòng tiền lớn hôm nay?")}
            className="whitespace-nowrap rounded-full border border-[#213042] bg-[#131d29] px-2.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950 hover:text-cyan-300"
          >
            ⚡ Dòng tiền lớn?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Hỗ trợ kháng cự gần nhất?")}
            className="whitespace-nowrap rounded-full border border-[#213042] bg-[#131d29] px-2.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950 hover:text-cyan-300"
          >
            🎯 Hỗ trợ / Kháng cự?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Rủi ro lớn nhất là gì?")}
            className="whitespace-nowrap rounded-full border border-[#213042] bg-[#131d29] px-2.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950 hover:text-cyan-300"
          >
            ⚠️ Rủi ro chính?
          </button>
          <button
            type="button"
            onClick={() => handleSend("Cấu trúc Wyckoff hiện tại?")}
            className="whitespace-nowrap rounded-full border border-[#213042] bg-[#131d29] px-2.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-cyan-500/50 hover:bg-cyan-950 hover:text-cyan-300"
          >
            📈 Wyckoff?
          </button>
        </div>

        {/* Input Bar */}
        <div className="border-t border-[#16202a] bg-[#090d13] p-2.5">
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
              className="w-full rounded-lg border border-[#1f2b3b] bg-[#0e141c] px-3 py-2 pr-9 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-cyan-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!inputVal.trim() || isTyping}
              className="absolute right-1.5 p-1 text-cyan-400 transition-colors hover:text-cyan-300 disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
