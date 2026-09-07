"use client"

import { CircleHelp } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function RiskTermTooltip({
  label,
  help,
}: {
  label: string
  help: string
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="inline-flex items-center gap-1.5 text-left font-ticker font-bold text-slate-100"
          aria-label={`${label}: ${help}`}
        >
          <span>{label}</span>
          <CircleHelp className="h-3.5 w-3.5 text-slate-500" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs border border-[#2a2e40] bg-[#10141d] text-xs leading-relaxed text-slate-200">
          {help}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
