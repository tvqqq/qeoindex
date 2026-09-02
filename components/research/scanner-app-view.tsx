import type { ComponentProps } from "react"

import { ScannerApp } from "@/components/research/scanner-app"

export default function ScannerAppView(props: ComponentProps<typeof ScannerApp>) {
  return <ScannerApp {...props} />
}
