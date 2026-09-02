import type { ComponentProps } from "react"

import { SignalsApp } from "@/components/research/signals-app"

export default function SignalsAppView(props: ComponentProps<typeof SignalsApp>) {
  return <SignalsApp {...props} />
}
