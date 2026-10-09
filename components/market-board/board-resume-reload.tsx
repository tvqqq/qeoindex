"use client"

import { useEffect } from "react"
import { attachBoardResumeReload } from "@/modules/market/board/resume-reload"

export function BoardResumeReload() {
  useEffect(() => attachBoardResumeReload(window, document), [])
  return null
}
