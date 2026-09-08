"use client"

export const PROFILE_POINTS = [5, 10, 15] as const
export type ProfilePointValue = typeof PROFILE_POINTS[number]

function pointIndex(value: "" | ProfilePointValue) {
  if (value === "") return 1
  return PROFILE_POINTS.indexOf(value)
}

export function PointSlider({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  value: "" | ProfilePointValue
  onChange: (value: ProfilePointValue) => void
  disabled?: boolean
}) {
  const index = pointIndex(value)
  const fill = value === "" ? 0 : index * 50

  return (
    <div className="min-w-0 py-1">
      <input
        type="range"
        min={0}
        max={2}
        step={1}
        value={index}
        disabled={disabled}
        aria-label={`${label} - điểm`}
        aria-valuetext={value === "" ? "Chưa chọn" : `${value} điểm`}
        onChange={(event) => onChange(PROFILE_POINTS[Number(event.target.value)] ?? 10)}
        className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-purple-300 [&::-moz-range-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-purple-300 [&::-webkit-slider-thumb]:bg-purple-500"
        style={{
          background: `linear-gradient(to right, rgb(168 85 247) 0%, rgb(168 85 247) ${fill}%, rgb(52 57 77) ${fill}%, rgb(52 57 77) 100%)`,
        }}
      />
      <div className="mt-2 grid grid-cols-3 gap-1">
        {PROFILE_POINTS.map((point) => {
          const selected = value === point
          return (
            <button
              key={point}
              type="button"
              disabled={disabled}
              onClick={() => onChange(point)}
              className={`rounded-md px-1 py-1 text-center text-[11px] font-bold transition-colors ${
                selected
                  ? "bg-purple-500/10 text-purple-300"
                  : "text-slate-500 hover:text-slate-300"
              } disabled:cursor-not-allowed`}
              aria-pressed={selected}
            >
              {point} điểm
            </button>
          )
        })}
      </div>
    </div>
  )
}
