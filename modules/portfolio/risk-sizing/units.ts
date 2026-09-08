export const KVND_TO_VND = 1000

export function kvndToVnd(value: number): number {
  return value * KVND_TO_VND
}

export function vndToKvnd(value: number): number {
  return value / KVND_TO_VND
}
