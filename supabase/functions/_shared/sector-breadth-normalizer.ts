export type NormalizedSectorBreadth = {
  name: string
  advances: number
  declines: number
  unchanged: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseCount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null
  }
  if (typeof value !== "string") return null
  const clean = value.trim().replace(/,/g, "")
  if (!clean) return null
  const number = Number(clean)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null
}

function sectorIdentity(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function normalizedRow(
  nameRaw: unknown,
  advancesRaw: unknown,
  declinesRaw: unknown,
  unchangedRaw: unknown,
): NormalizedSectorBreadth | null {
  const name = typeof nameRaw === "string" ? nameRaw.trim() : ""
  const advances = parseCount(advancesRaw)
  const declines = parseCount(declinesRaw)
  const unchanged = parseCount(unchangedRaw)
  if (!name || advances == null || declines == null || unchanged == null) return null
  return { name, advances, declines, unchanged }
}

/**
 * KFSP has emitted sector breadth in two verified shapes:
 * 1) row-oriented: [{ nganh: "...", count_advances: 1, ... }, ...]
 * 2) column-oriented: [{ nganh: ["..."], count_advances: [1], ... }]
 *
 * Any mixed, mismatched, duplicate, negative, or incomplete shape fails closed.
 */
export function normalizeSectorBreadthPayload(payload: unknown): NormalizedSectorBreadth[] {
  const root = Array.isArray(payload) ? payload : [payload]
  if (root.length === 0) return []

  const first = asObject(root[0])
  const isColumnar = root.length === 1 && first && Array.isArray(first.nganh)
  const rows: NormalizedSectorBreadth[] = []

  if (isColumnar) {
    const names = first.nganh as unknown[]
    const advances = first.count_advances
    const declines = first.count_declines
    const unchanged = first.count_nochange
    if (!Array.isArray(advances) || !Array.isArray(declines) || !Array.isArray(unchanged)) return []
    if (
      names.length === 0 ||
      advances.length !== names.length ||
      declines.length !== names.length ||
      unchanged.length !== names.length
    ) return []

    for (let index = 0; index < names.length; index += 1) {
      const row = normalizedRow(names[index], advances[index], declines[index], unchanged[index])
      if (!row) return []
      rows.push(row)
    }
  } else {
    for (const item of root) {
      const obj = asObject(item)
      if (!obj || Array.isArray(obj.nganh)) return []
      const row = normalizedRow(obj.nganh, obj.count_advances, obj.count_declines, obj.count_nochange)
      if (!row) return []
      rows.push(row)
    }
  }

  const identities = rows.map((row) => sectorIdentity(row.name))
  if (identities.some((identity) => !identity) || new Set(identities).size !== rows.length) return []
  return rows
}
