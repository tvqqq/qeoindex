import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("border-b border-white/[0.08]", className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("border-b border-white/[0.06] transition-colors hover:bg-white/[0.025]", className)} {...props} />
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th data-slot="table-head" className={cn("h-11 px-3 text-left align-middle font-ticker text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500", className)} {...props} />
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("px-3 py-3 align-middle font-ticker text-[13px] text-slate-300", className)} {...props} />
}
