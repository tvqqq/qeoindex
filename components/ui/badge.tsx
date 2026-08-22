import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center rounded-full border border-white/[0.09] bg-white/[0.045] px-2.5 py-1 font-ticker text-[11px] font-bold leading-none text-slate-300",
        className,
      )}
      {...props}
    />
  )
}
