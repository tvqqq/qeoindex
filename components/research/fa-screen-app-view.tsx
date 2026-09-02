import type { ComponentProps } from "react"

import { FaScreenApp } from "@/components/research/fa-screen-app"

export default function FaScreenAppView(props: ComponentProps<typeof FaScreenApp>) {
  return <FaScreenApp {...props} />
}
