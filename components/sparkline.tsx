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
 * Lightweight SVG sparkline. `data` is a numeric series; it is normalized to the
 * viewport. A trailing dot marks the latest value.
 */
export function Sparkline({
  data,
  refValue,
  color,
  refColor = "#94a3b8",
  width = 78,
  height = 34,
  strokeWidth = 1.5,
  showDot = true,
  fill = false,
  className = "",
}: SparklineProps) {
  if (data.length < 2) return <svg width={width} height={height} aria-hidden="true" className={className} />

  const hasRef = typeof refValue === "number" && Number.isFinite(refValue) && refValue > 0
  const values = hasRef ? [...data, refValue as number] : data
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pad = strokeWidth + 1

  const x = (i: number) => (i / (data.length - 1)) * (width - pad * 2) + pad
  const y = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2)

  const points = data.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`)
  const path = "M" + points.join(" L")

  const lastX = x(data.length - 1)
  const lastY = y(data[data.length - 1])

  const uid = Math.round(x(0) * 100) + "-" + color.replace(/[^a-z0-9]/gi, "")

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={`overflow-visible ${className}`.trim()}
    >
      {/* Đường line đứt nét là giá tham chiếu (màu xám nhạt) */}
      {hasRef && (
        <line
          x1={0}
          x2={width}
          y1={y(refValue as number)}
          y2={y(refValue as number)}
          stroke={refColor}
          strokeOpacity={0.65}
          strokeDasharray="2.5 2"
          strokeWidth={1}
        />
      )}
      {fill && (
        <>
          <defs>
            <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path
            d={`${path} L${lastX.toFixed(2)},${height} L${pad},${height} Z`}
            fill={`url(#g-${uid})`}
            stroke="none"
          />
        </>
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showDot && <circle cx={lastX} cy={lastY} r={strokeWidth + 0.5} fill={color} />}
    </svg>
  )
}
