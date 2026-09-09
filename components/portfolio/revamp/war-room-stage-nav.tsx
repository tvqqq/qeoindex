"use client"

import { cn } from "@/modules/shared/ui/cn"

export type WarRoomStage = "capacity" | "current" | "sizing" | "simulation"

export interface WarRoomStageNavProps {
  stage: WarRoomStage
  onStageChange: (stage: WarRoomStage) => void
}

const stages: Array<{ value: WarRoomStage; label: string; eyebrow: string }> = [
  { value: "capacity", label: "Quân lực", eyebrow: "Sức chứa" },
  { value: "current", label: "Dàn quân", eyebrow: "Hiện tại" },
  { value: "sizing", label: "Lệnh dự kiến", eyebrow: "Khối lượng" },
  { value: "simulation", label: "Simulation", eyebrow: "Sau lệnh" },
]

export function WarRoomStageNav({ stage, onStageChange }: WarRoomStageNavProps) {
  return (
    <nav
      aria-label="Các bước War Room"
      className="flex min-w-0 gap-2 overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/20 p-2"
    >
      {stages.map((item, index) => {
        const active = stage === item.value
        return (
          <button
            key={item.value}
            type="button"
            aria-current={active ? "step" : undefined}
            onClick={() => onStageChange(item.value)}
            className={cn(
              "min-h-10 min-w-[132px] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors",
              active
                ? "border-purple-400/35 bg-purple-400/[0.12] text-white"
                : "border-transparent bg-white/[0.025] text-slate-400 hover:border-white/[0.08] hover:text-slate-200",
            )}
          >
            <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              0{index + 1} · {item.eyebrow}
            </span>
            <span className="mt-0.5 block text-sm font-extrabold">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
