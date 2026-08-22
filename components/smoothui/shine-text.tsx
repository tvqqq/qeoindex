import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/utils"
import styles from "./shine-text.module.css"

type ShineTextProps = {
  children: ReactNode
  className?: string
  baseColor?: string
  shineColor?: string
  durationMs?: number
}

/**
 * Local, dependency-light adaptation of SmoothUI's Shine Text behavior.
 * Keeps the same clipped-gradient sweep and reduced-motion contract without
 * adding a continuous animation runtime to the data-dense Insights page.
 */
export function ShineText({
  children,
  className,
  baseColor = "#94a3b8",
  shineColor = "#f8fafc",
  durationMs = 3200,
}: ShineTextProps) {
  const style = {
    "--shine-base": baseColor,
    "--shine-color": shineColor,
    "--shine-duration": `${durationMs}ms`,
  } as CSSProperties

  return <span className={cn(styles.shine, className)} style={style}>{children}</span>
}
