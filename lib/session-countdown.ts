export function getVnTimeSeconds(date: Date = new Date()): { dayOfWeek: number; totalSeconds: number } {
  // Convert date to Vietnam Time (UTC+7)
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
  const vnDate = new Date(utcMs + 7 * 3600000)
  const dayOfWeek = vnDate.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const h = vnDate.getHours()
  const m = vnDate.getMinutes()
  const s = vnDate.getSeconds()
  const totalSeconds = h * 3600 + m * 60 + s
  return { dayOfWeek, totalSeconds }
}

export function calculateSessionCountdown(date: Date = new Date()): {
  type: "ATO" | "ATC"
  label: string
  remainingSec: number
} | null {
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(date)
  // Trading days only (Mon-Fri)
  if (dayOfWeek < 1 || dayOfWeek > 5) return null

  // ATO: 09:00:00 -> 09:15:00 (32,400s -> 33,300s)
  if (totalSeconds >= 32400 && totalSeconds < 33300) {
    const remainingSec = 33300 - totalSeconds
    const mins = Math.floor(remainingSec / 60)
    const secs = remainingSec % 60
    return {
      type: "ATO",
      label: `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`,
      remainingSec,
    }
  }

  // ATC: 14:30:00 -> 14:45:00 (52,200s -> 53,100s)
  if (totalSeconds >= 52200 && totalSeconds < 53100) {
    const remainingSec = 53100 - totalSeconds
    const mins = Math.floor(remainingSec / 60)
    const secs = remainingSec % 60
    return {
      type: "ATC",
      label: `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`,
      remainingSec,
    }
  }

  return null
}

export function isTradingSessionOpen(date: Date = new Date()): boolean {
  const { dayOfWeek, totalSeconds } = getVnTimeSeconds(date)
  // Trading days only (Mon-Fri)
  if (dayOfWeek < 1 || dayOfWeek > 5) return false
  // HOSE Trading session: 09:00:00 (32,400s) -> 15:00:00 (54,000s)
  return totalSeconds >= 32400 && totalSeconds <= 54000
}
