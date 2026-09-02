"use client"

import type { ComponentProps } from "react"
import nextDynamic from "next/dynamic"

type SignalsAppProps = ComponentProps<typeof import("@/components/research/signals-app").SignalsApp>

const SignalsApp = nextDynamic(() =>
  import("@/components/research/signals-app").then((mod) => mod.SignalsApp),
)

export default function SignalsAppView(props: SignalsAppProps) {
  return <SignalsApp {...props} />
}
