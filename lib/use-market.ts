"use client"

import { useSyncExternalStore } from "react"
import { marketStore, type Stock, type MarketIndex, type WSStatus } from "./market-data"

export function useStock(key: string): Stock {
  return useSyncExternalStore(
    (cb) => marketStore.subscribeStock(key, cb),
    () => marketStore.getStock(key),
    () => marketStore.getStock(key),
  )
}

export function useIndices(): MarketIndex[] {
  return useSyncExternalStore(
    (cb) => marketStore.subscribeIndices(cb),
    () => marketStore.getIndices(),
    () => marketStore.getIndices(),
  )
}

export function useWSStatus(): WSStatus {
  return useSyncExternalStore(
    (cb) => marketStore.subscribeStatus(cb),
    () => marketStore.getStatus(),
    () => marketStore.getStatus(),
  )
}
