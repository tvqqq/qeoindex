import { memo, useMemo } from "react"

interface SparklineProps {
  data: number[]
  refValue?: number
  color: string
  refColor?: string
  width?: number
  height?: number
  strokeWidth?: number
  showDot?: boolean
  fill?: boolean
  className?: string
}

/**
 * Professional Smooth SVG Sparkline with Dynamic Intraday Auto-Fit Scaling.
 * Uses Monotonic Cubic Spline / Smooth Bézier Curves and Gradient Fill
 * to accurately depict intraday price action, waves, and momentum.
 */
export const Sparkline = memo(function Sparkline({
  data,
  refValue,
  color,
  refColor = "rgba(226, 232, 240, 0.65)",
  width = 64,
  height = 28,
  strokeWidth = 1.6,
  showDot = true,
  fill = true,
  className = "",
}: SparklineProps) {
  const hasRef = typeof refValue === "number" && Number.isFinite(refValue) && refValue > 0
  const ref = hasRef ? (refValue as number) : undefined

  const dataKey = data.length > 0 ? `${data.length}-${data[0]}-${data[data.length - 1]}-${ref}` : ""

  const computed = useMemo(() => {
    const points = data.filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
    if (points.length < 2) return null

    // 1. Dynamic Auto-Fit Range: Scale strictly to actual price action high & low
    const rawMin = Math.min(...points)
    const rawMax = Math.max(...points)
    const delta = rawMax - rawMin

    // Add 15% top & bottom padding so waves are clearly visible without touching boundary
    const padding = delta > 0 ? delta * 0.15 : (rawMin * 0.005 || 0.05)
    const min = rawMin - padding
    const max = rawMax + padding
    const range = max - min || 1

    const padX = strokeWidth + 1
    const padY = strokeWidth + 1
    const usableW = width - padX * 2
    const usableH = height - padY * 2

    const coords: [number, number][] = points.map((v, i) => {
      const x = padX + (i / (points.length - 1)) * usableW
      const y = padY + usableH - ((v - min) / range) * usableH
      return [x, y]
    })

    // 2. Smooth Cubic Spline Bézier Curve Path
    let path = `M ${coords[0][0].toFixed(2)},${coords[0][1].toFixed(2)}`
    for (let i = 0; i < coords.length - 1; i++) {
      const [x0, y0] = coords[i]
      const [x1, y1] = coords[i + 1]
      const midX = (x0 + x1) / 2
      path += ` C ${midX.toFixed(2)},${y0.toFixed(2)} ${midX.toFixed(2)},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`
    }

    const last = coords[coords.length - 1]
    const lastX = last[0]
    const lastY = last[1]

    // 3. Clear Reference Baseline Y (anchored within visible boundary)
    let refY: number | null = null
    if (ref != null) {
      const calculatedRefY = padY + usableH - ((ref - min) / range) * usableH
      refY = Math.max(padY + 1, Math.min(height - padY - 1, calculatedRefY))
    }

    const uid = Math.abs(Math.round(coords[0][0] * 100)) + "-" + color.replace(/[^a-z0-9]/gi, "")

    return { path, lastX, lastY, refY, padX, uid }
  }, [dataKey, ref, width, height, strokeWidth, color])

  if (!computed) {
    return <svg width={width} height={height} aria-hidden="true" className={className} />
  }

  const { path, lastX, lastY, refY, padX, uid } = computed

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      shapeRendering="geometricPrecision"
      className={`overflow-visible select-none ${className}`.trim()}
    >
      <defs>
        {fill && (
          <linearGradient id={`spark-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="65%" stopColor={color} stopOpacity={0.06} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        )}
      </defs>

      {/* Dotted Reference Baseline (Crisp & Visible) */}
      {hasRef && refY != null && (
        <g opacity={0.85}>
          <line
            x1={0}
            x2={width}
            y1={refY}
            y2={refY}
            stroke={refColor}
            strokeDasharray="2.5 2"
            strokeWidth={1.15}
          />
        </g>
      )}

      {/* Gradient Area Fill */}
      {fill && (
        <path
          d={`${path} L ${lastX.toFixed(2)},${height} L ${padX.toFixed(2)},${height} Z`}
          fill={`url(#spark-grad-${uid})`}
          stroke="none"
        />
      )}

      {/* Main Smooth Sparkline Stroke */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* End Point Glow Dot */}
      {showDot && (
        <>
          <circle cx={lastX} cy={lastY} r={strokeWidth + 1.2} fill={color} fillOpacity={0.25} />
          <circle cx={lastX} cy={lastY} r={strokeWidth + 0.3} fill={color} />
        </>
      )}
    </svg>
  )
})
