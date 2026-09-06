import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

export const QEO_CHART_DB_CAPACITY_WARN_BYTES = 350 * 1024 * 1024
export const QEO_CHART_DB_CAPACITY_HARD_BYTES = 400 * 1024 * 1024

export type ChartStorageCapacityLevel = "OK" | "WARN" | "HARD_STOP"

export interface ChartStorageCapacity {
  databaseBytes: number
  hotHeapBytes: number
  hotIndexBytes: number
  hotTotalBytes: number
  hotRows: number
  partitionCount: number
  oldestHotSession: string | null
  newestHotSession: string | null
  level: ChartStorageCapacityLevel
  bootstrapAllowed: boolean
}

function finiteNonNegative(value: unknown, field: string) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid chart storage capacity field: ${field}`)
  return number
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function capacityLevel(databaseBytes: number, projectedWriteBytes = 0): ChartStorageCapacityLevel {
  const projected = databaseBytes + Math.max(0, projectedWriteBytes)
  if (projected >= QEO_CHART_DB_CAPACITY_HARD_BYTES) return "HARD_STOP"
  if (projected >= QEO_CHART_DB_CAPACITY_WARN_BYTES) return "WARN"
  return "OK"
}

export async function readChartStorageCapacity(supabase: SupabaseClient): Promise<ChartStorageCapacity> {
  const { data, error } = await supabase.rpc("qeo_chart_storage_capacity")
  if (error) throw new Error(`Chart storage capacity RPC failed: ${error.message}`)
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const databaseBytes = finiteNonNegative(raw.databaseBytes, "databaseBytes")
  const level = capacityLevel(databaseBytes)
  return {
    databaseBytes,
    hotHeapBytes: finiteNonNegative(raw.hotHeapBytes, "hotHeapBytes"),
    hotIndexBytes: finiteNonNegative(raw.hotIndexBytes, "hotIndexBytes"),
    hotTotalBytes: finiteNonNegative(raw.hotTotalBytes, "hotTotalBytes"),
    hotRows: finiteNonNegative(raw.hotRows, "hotRows"),
    partitionCount: finiteNonNegative(raw.partitionCount, "partitionCount"),
    oldestHotSession: nullableString(raw.oldestHotSession),
    newestHotSession: nullableString(raw.newestHotSession),
    level,
    bootstrapAllowed: level !== "HARD_STOP",
  }
}

export function assertChartBootstrapCapacity(
  capacity: ChartStorageCapacity,
  input: { projectedWriteBytes?: number } = {},
) {
  const projectedWriteBytes = Math.max(0, Number(input.projectedWriteBytes ?? 0))
  if (!Number.isFinite(projectedWriteBytes)) throw new Error("Invalid projected chart bootstrap write size")
  const level = capacityLevel(capacity.databaseBytes, projectedWriteBytes)
  if (level === "HARD_STOP") {
    throw new Error(
      `QEO-108 chart capacity hard-stop: projected database bytes ${Math.ceil(capacity.databaseBytes + projectedWriteBytes)} exceed ${QEO_CHART_DB_CAPACITY_HARD_BYTES}`,
    )
  }
  return { ...capacity, level, bootstrapAllowed: true }
}
