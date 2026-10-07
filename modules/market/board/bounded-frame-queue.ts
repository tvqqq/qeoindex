export const BOARD_FRAME_QUEUE_LIMIT = 1024

export function createBoundedFrameQueue<T>(limit = BOARD_FRAME_QUEUE_LIMIT) {
  let frames: T[] = []
  let overflowed = false
  return {
    push(frame: T) {
      if (overflowed) return false
      if (frames.length >= limit) {
        frames = []
        overflowed = true
        return false
      }
      frames.push(frame)
      return true
    },
    drain() {
      const pending = frames
      frames = []
      return pending
    },
    clear() { frames = [] },
    get overflowed() { return overflowed },
    get length() { return frames.length },
  }
}
