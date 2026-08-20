/**
 * Web Audio API Synthesizer for Whale Alerts and Tape Reading.
 * Ultra-lightweight, zero-external-assets audio engine.
 */

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

const SOUND_STORAGE_KEY = "qeoindex_sound_fx_enabled"

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false
  const val = localStorage.getItem(SOUND_STORAGE_KEY)
  if (val === null) return true // Enabled by default
  return val === "true"
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "true" : "false")
  if (enabled) {
    unlockAudioContext()
  }
}

export function unlockAudioContext(): void {
  const ctx = getAudioContext()
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {})
  }
}

/**
 * Play Golden Whale Alert Chime (Harmonic soft bell for massive trades >= 30,000 shares / >= 1B VND)
 */
export function playWhaleSound(side: "BUY" | "SELL" | "REF" = "BUY"): void {
  if (!isSoundEnabled()) return
  const ctx = getAudioContext()
  if (!ctx) return

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {})
  }

  try {
    const now = ctx.currentTime

    if (side === "BUY") {
      // Triumphant ascending harmonic bell arpeggio (E5 -> G#5 -> B5 -> E6)
      const notes = [659.25, 830.61, 987.77, 1318.51]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t = now + idx * 0.08

        osc.type = "sine"
        osc.frequency.setValueAtTime(freq, t)

        gain.gain.setValueAtTime(0.001, t)
        gain.gain.linearRampToValueAtTime(0.15, t + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(t)
        osc.stop(t + 0.6)
      })
    } else {
      // Powerful descending alarm chime for whale sell (F5 -> D5 -> Bb4 -> G4)
      const notes = [698.46, 587.33, 466.16, 392.00]
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t = now + idx * 0.09

        osc.type = "triangle"
        osc.frequency.setValueAtTime(freq, t)

        gain.gain.setValueAtTime(0.001, t)
        gain.gain.linearRampToValueAtTime(0.18, t + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(t)
        osc.stop(t + 0.5)
      })
    }
  } catch {
    // Ignore audio errors gracefully
  }
}

/**
 * Play subtle soft click for standard matched tick (optional subtle feedback)
 */
export function playTickClickSound(): void {
  if (!isSoundEnabled()) return
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = "sine"
    osc.frequency.setValueAtTime(1200, now)
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.03)

    gain.gain.setValueAtTime(0.03, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.045)
  } catch {
    // Ignore
  }
}
