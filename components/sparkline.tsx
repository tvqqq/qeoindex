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
 * High-performance, GPU-accelerated SVG Sparkline with Dynamic Gradient Fill & Reference Baseline.
 * Memoized with pre-computed paths to guarantee smooth 60fps scrolling across 100 tickers.
 */
export const Sparkline = memo(function Sparkline({
  data,
  refValue,
  color,
  refColor = "rgba(148, 163, 184, 0.45)",
  width = 78,
  height = 34,
  strokeWidth = 1.75,
  showDot = true,
  fill = true,
  className = "",
}: SparklineProps) {
  const hasRef = typeof refValue === "number" && Number.isFinite(refValue) && refValue > 0
  const ref = hasRef ? (refValue as number) : undefined

  const dataKey = data.length > 0 ? `${data.length}-${data[0]}-${data[data.length - 1]}-${ref}` : ""

  const computed = useMemo(() => {
    if (data.length < 2) return null

    const rawMin = Math.min(...data, ...(ref != null ? [ref] : []))
    const rawMax = Math.max(...data, ...(ref != null ? [ref] : []))

    const delta = rawMax - rawMin || (ref ? ref * 0.02 : 1)
    const padding = delta * 0.08
    const min = rawMin - padding
    const max = rawMax + padding
    const range = max - min || 1
    const pad = strokeWidth + 0.5

    const getX = (i: number) => (i / (data.length - 1)) * (width - pad * 2) + pad
    const getY = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2)

    const points = data.map((v, i) => `${getX(i).toFixed(2)},${getY(v).toFixed(2)}`)
    const path = "M" + points.join(" L")

    const lastX = getX(data.length - 1)
    const lastY = getY(data[data.length - 1])
    const refY = ref != null ? getY(ref) : null
    const uid = Math.abs(Math.round(getX(0) * 100)) + "-" + color.replace(/[^a-z0-9]/gi, "")

    return { path, lastX, lastY, refY, pad, uid }
  }, [dataKey, ref, width, height, strokeWidth, color])

  if (!computed) {
    return <svg width={width} height={height} aria-hidden="true" className={className} />
  }

  const { path, lastX, lastY, refY, pad, uid } = computed

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
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="65%" stopColor={color} stopOpacity={0.08} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        )}
      </defs>

      {/* Dotted Reference Baseline */}
      {hasRef && refY != null && (
        <g opacity={0.75}>
          <line
            x1={0}
            x2={width}
            y1={refY}
            y2={refY}
            stroke={refColor}
            strokeDasharray="2 2"
            strokeWidth={1}
          />
        </g>
      )}

      {/* Gradient Area Fill */}
      {fill && (
        <path
          d={`${path} L${lastX.toFixed(2)},${height} L${pad},${height} Z`}
          fill={`url(#spark-grad-${uid})`}
          stroke="none"
        />
      )}

      {/* Main Sparkline Stroke */}
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
          <circle cx={lastX} cy={lastY} r={strokeWidth + 0.4} fill={color} />
        </>
      )}
    </svg>
  )
})
