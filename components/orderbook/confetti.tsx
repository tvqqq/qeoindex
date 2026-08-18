"use client"

import { useEffect, useRef, useState } from "react"

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rotation: number
  rotationSpeed: number
  opacity: number
  shape: "rect" | "circle"
}

const COLORS = [
  "#22c98a", // green (buy)
  "#ff6b6b", // red (sell)
  "#ffd43b", // gold
  "#4dabf7", // blue
  "#da77f2", // purple
  "#ff922b", // orange
  "#69db7c", // light green
  "#e599f7", // pink
]

const PARTICLE_COUNT = 80
const DURATION_MS = 2500

export function useWhaleConfetti() {
  const [active, setActive] = useState(false)
  const timerRef = useRef<number | null>(null)

  const fire = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setActive(true)
    timerRef.current = window.setTimeout(() => {
      setActive(false)
      timerRef.current = null
    }, DURATION_MS)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  return { active, fire }
}

export function ConfettiOverlay({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!active) {
      particlesRef.current = []
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.parentElement?.getBoundingClientRect()
    const w = (canvas.width = rect?.width || canvas.parentElement?.clientWidth || 500)
    const h = (canvas.height = rect?.height || canvas.parentElement?.clientHeight || 600)

    // Create particles fanning outward from top of popup
    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => {
      const angle = (Math.random() - 0.5) * Math.PI * 0.9 - Math.PI / 2
      const speed = 4 + Math.random() * 8
      return {
        x: w / 2 + (Math.random() - 0.5) * w * 0.6,
        y: -15 - Math.random() * 20,
        vx: Math.cos(angle) * speed * (0.8 + Math.random() * 0.4),
        vy: Math.abs(Math.sin(angle)) * speed * 0.6 + 2 + Math.random() * 3,
        size: 5 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.25,
        opacity: 1,
        shape: Math.random() > 0.4 ? "rect" : "circle",
      }
    })

    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / DURATION_MS, 1)

      ctx.clearRect(0, 0, w, h)

      for (const p of particlesRef.current) {
        p.x += p.vx
        p.vy += 0.16 // gravity
        p.y += p.vy
        p.vx *= 0.985 // air drag
        p.rotation += p.rotationSpeed
        p.opacity = Math.max(0, 1 - progress * 1.1)

        ctx.save()
        ctx.globalAlpha = p.opacity
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillStyle = p.color

        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5)
        } else {
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.restore()
      }

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [active])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-50 rounded-xl"
      aria-hidden="true"
    />
  )
}
