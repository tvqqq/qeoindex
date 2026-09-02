"use client"

import type { ComponentProps } from "react"
import nextDynamic from "next/dynamic"

type ScannerAppProps = ComponentProps<typeof import("@/components/research/scanner-app").ScannerApp>

const ScannerApp = nextDynamic(() =>
  import("@/components/research/scanner-app").then((mod) => mod.ScannerApp),
)

export default function ScannerAppView(props: ScannerAppProps) {
  return <ScannerApp {...props} />
}
