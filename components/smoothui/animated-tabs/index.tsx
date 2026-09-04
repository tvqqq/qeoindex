"use client"

import { useId, useRef } from "react"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { cn } from "@/modules/shared/ui/cn"

export interface AnimatedTab<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

export function AnimatedTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  ariaLabel = "Tabs",
  variant = "segment",
  className,
  tabClassName,
  indicatorClassName,
}: {
  tabs: AnimatedTab<T>[]
  value: T
  onValueChange: (value: T) => void
  ariaLabel?: string
  variant?: "underline" | "pill" | "segment"
  className?: string
  tabClassName?: string
  indicatorClassName?: string
}) {
  const reducedMotion = useReducedMotion() ?? false
  const indicatorId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function selectIndex(index: number) {
    const tab = tabs[index]
    if (!tab || tab.disabled) return
    onValueChange(tab.value)
    refs.current[index]?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return
    event.preventDefault()

    if (event.key === "Home") {
      const first = tabs.findIndex((tab) => !tab.disabled)
      if (first >= 0) selectIndex(first)
      return
    }
    if (event.key === "End") {
      for (let target = tabs.length - 1; target >= 0; target -= 1) {
        if (!tabs[target].disabled) {
          selectIndex(target)
          return
        }
      }
    }

    const step = event.key === "ArrowRight" ? 1 : -1
    for (let offset = 1; offset <= tabs.length; offset += 1) {
      const target = (index + step * offset + tabs.length) % tabs.length
      if (!tabs[target].disabled) {
        selectIndex(target)
        return
      }
    }
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          "inline-flex items-center gap-0.5",
          variant === "segment" && "rounded-md border border-white/[0.08] bg-[#070b10] p-0.5",
          variant === "pill" && "rounded-full bg-white/[0.035] p-0.5",
          className,
        )}
      >
        {tabs.map((tab, index) => {
          const active = tab.value === value
          return (
            <button
              key={tab.value}
              ref={(node) => { refs.current[index] = node }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => onValueChange(tab.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "relative isolate shrink-0 select-none overflow-hidden text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 disabled:pointer-events-none disabled:opacity-40",
                variant === "underline" ? "px-2.5 py-1.5" : "rounded px-2.5 py-1.5",
                active && "text-cyan-200",
                tabClassName,
              )}
            >
              {active ? (
                <m.span
                  layoutId={`smoothui-tabs-${indicatorId}`}
                  aria-hidden="true"
                  className={cn(
                    "absolute z-[-1]",
                    variant === "underline" && "inset-x-1 bottom-0 h-px rounded-full bg-cyan-300",
                    variant === "pill" && "inset-0 rounded bg-cyan-500/[0.16]",
                    variant === "segment" && "inset-0 rounded border border-cyan-400/20 bg-cyan-500/[0.14]",
                    indicatorClassName,
                  )}
                  transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 0.45 }}
                />
              ) : null}
              <span className="relative z-10">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </LazyMotion>
  )
}
