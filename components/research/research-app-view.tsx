"use client"

import type { ComponentProps } from "react"
import nextDynamic from "next/dynamic"

type ResearchAppProps = ComponentProps<typeof import("@/components/research/research-app").ResearchApp>

const ResearchApp = nextDynamic(() =>
  import("@/components/research/research-app").then((mod) => mod.ResearchApp),
)

export default function ResearchAppView(props: ResearchAppProps) {
  return <ResearchApp {...props} />
}
