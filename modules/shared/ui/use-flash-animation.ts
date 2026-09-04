"use client"

import { useEffect, useRef, useState } from "react"

export type FlashType = "up" | "down" | "ref" | null

/**
 * Hook to trigger a temporary flash state when a numerical value changes (e.g. volume or count)
 */
export function useFlashAnimation(
  value: number | undefined | null,
  threshold = 0.0001
): FlashType {
  const [flash, setFlash] = useState<FlashType>(null)
  const prevRef = useRef<number | null | undefined>(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (
      prevRef.current !== undefined &&
      prevRef.current !== null &&
      value !== undefined &&
      value !== null
    ) {
      const diff = value - prevRef.current
      if (Math.abs(diff) >= threshold) {
        setFlash(diff > 0 ? "up" : "down")
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          setFlash(null)
        }, 700)
      }
    }
    prevRef.current = value
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [value, threshold])

  return flash
}

/**
 * Hook to trigger a price tick flash animation when stock/quote price changes
 */
export function usePriceFlashAnimation(
  price: number | undefined | null,
  reference?: number | null
): FlashType {
  const [flash, setFlash] = useState<FlashType>(null)
  const prevRef = useRef<number | null | undefined>(price)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (
      prevRef.current !== undefined &&
      prevRef.current !== null &&
      price !== undefined &&
      price !== null
    ) {
      const diff = price - prevRef.current
      if (Math.abs(diff) >= 0.001) {
        if (reference && Math.abs(price - reference) < 0.001) {
          setFlash("ref")
        } else {
          setFlash(diff > 0 ? "up" : "down")
        }
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          setFlash(null)
        }, 700)
      }
    }
    prevRef.current = price
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [price, reference])

  return flash
}
