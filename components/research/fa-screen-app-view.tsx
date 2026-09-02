"use client"

import nextDynamic from "next/dynamic"

const FaScreenApp = nextDynamic(() =>
  import("@/components/research/fa-screen-app").then((mod) => mod.FaScreenApp),
)

export default function FaScreenAppView() {
  return <FaScreenApp />
}
