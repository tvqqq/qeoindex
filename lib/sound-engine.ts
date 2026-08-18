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
  return localStorage.getItem(SOUND_STORAGE_KEY) === "true"
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "true" : "false")
  if (enabled) {
    getAudioContext()
  }
}

/**
 * Play Golden Whale Alert Chime (Harmonic soft bell for massive trades >= 30,000 shares / >= 1B VND)
 */
export function playWhaleSound(side: "BUY" | "SELL" | "REF" = "BUY"): void {
  if (!isSoundEnabled()) return
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime

    // Base frequencies
    const freq1 = side === "BUY" ? 659.25 : 587.33 // E5 or D5
    const freq2 = side === "BUY" ? 987.77 : 440.00 // B5 or A4

    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()

    osc1.type = "sine"
    osc2.type = "triangle"

    osc1.frequency.setValueAtTime(freq1, now)
    osc1.frequency.exponentialRampToValueAtTime(freq2, now + 0.35)

    osc2.frequency.setValueAtTime(freq1 * 1.5, now)
    osc2.frequency.exponentialRampToValueAtTime(freq2 * 1.5, now + 0.45)

    // Smooth bell envelope (attack: 10ms, decay: 450ms)
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)

    osc1.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)

    osc1.start(now)
    osc2.start(now)
    osc1.stop(now + 0.52)
    osc2.stop(now + 0.52)
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
