import type { ComponentProps } from "react"

import { ResearchApp } from "@/components/research/research-app"

export default function ResearchAppView(props: ComponentProps<typeof ResearchApp>) {
  return <ResearchApp {...props} />
}
