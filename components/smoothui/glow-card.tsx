"use client"

import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"
import styles from "./glow-card.module.css"

/**
 * Local adaptation of SmoothUI's cursor-following Glow Hover Card pattern.
 * Pointer tracking only updates CSS variables on the hovered card; no React
 * state is written during pointer movement.
 */
export function GlowCard({ className, children, onPointerMove, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(styles.root, className)}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        event.currentTarget.style.setProperty("--glow-x", `${event.clientX - rect.left}px`)
        event.currentTarget.style.setProperty("--glow-y", `${event.clientY - rect.top}px`)
        onPointerMove?.(event)
      }}
    >
      <div aria-hidden="true" className={styles.glow} />
      <div className={styles.content}>{children}</div>
    </div>
  )
}
