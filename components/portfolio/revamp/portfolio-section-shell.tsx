import type { ReactNode } from "react"

import { cn } from "@/modules/shared/ui/cn"

export type PortfolioSectionShellProps = {
  title: string
  description?: ReactNode
  eyebrow?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function PortfolioSectionShell({
  title,
  description,
  eyebrow,
  action,
  children,
  className,
  contentClassName,
}: PortfolioSectionShellProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-sm",
        className,
      )}
    >
      <header className="flex flex-col gap-4 border-b border-white/8 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300/80">{eyebrow}</p>
          ) : null}
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
          {description ? <div className="max-w-3xl text-sm leading-6 text-slate-400">{description}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={cn("p-5 sm:p-6", contentClassName)}>{children}</div>
    </section>
  )
}
