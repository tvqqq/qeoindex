"use client"

import type { DnseMarketFrame } from "@/modules/market/realtime/index-candles"

type DnseMarketFrameListener = (frame: DnseMarketFrame) => void

const listeners = new Set<DnseMarketFrameListener>()

export function publishDnseMarketFrame(frame: DnseMarketFrame) {
  if (!listeners.size) return
  for (const listener of listeners) listener(frame)
}

export function subscribeDnseMarketFrames(listener: DnseMarketFrameListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
