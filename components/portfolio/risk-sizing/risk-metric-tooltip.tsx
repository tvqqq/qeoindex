"use client"

import { CircleHelp } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { RISK_SIZING_TERMS } from "@/modules/portfolio/risk-sizing/terminology"

type RiskSizingTermKey = keyof typeof RISK_SIZING_TERMS

export function RiskMetricTooltip({ term }: { term: RiskSizingTermKey }) {
  const metadata = RISK_SIZING_TERMS[term]

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="inline-flex items-center gap-1.5 text-left font-ticker font-bold text-slate-200"
          aria-label={`${metadata.label}: ${metadata.help}`}
        >
          <span>{metadata.label}</span>
          <CircleHelp className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </TooltipTrigger>
        <TooltipContent className="max-w-sm border border-[#2a2e40] bg-[#10141d] text-xs leading-relaxed text-slate-200">
          <p>{metadata.help}</p>
          {"formula" in metadata && metadata.formula ? (
            <p className="mt-2 font-mono text-[11px] text-purple-200">{metadata.formula}</p>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
