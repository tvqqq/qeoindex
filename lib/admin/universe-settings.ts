import type { AdminSettingDefinition, AdminValidationResult } from "./types.ts"

function finiteNumber(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function integer(value: unknown, min: number, max: number): number | null {
  const parsed = finiteNumber(value, min, max)
  return parsed != null && Number.isInteger(parsed) ? parsed : null
}

export const MARKET_UNIVERSE_SETTING_DEFINITIONS: AdminSettingDefinition[] = [
  {
    key: "market.universe_min_market_cap_billion",
    group: "market",
    label: "Vốn hoá TT tối thiểu",
    description: "Ngưỡng vốn hoá thị trường (tỷ VND) áp dụng cho lần refresh Top Stocks kế tiếp. Điều kiện là > ngưỡng.",
    type: "number",
    source: "runtime",
    defaultValue: 10,
    editable: true,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: false,
    validate(value: unknown): AdminValidationResult {
      const parsed = finiteNumber(value, 0, 10_000_000)
      return parsed == null ? { ok: false, error: "Vốn hoá tối thiểu phải là số từ 0 đến 10.000.000 tỷ VND" } : { ok: true, value: parsed }
    },
  },
  {
    key: "market.universe_min_avg_volume_50d",
    group: "market",
    label: "KLTB 50D tối thiểu",
    description: "Ngưỡng khối lượng trung bình 50 phiên (cổ phiếu) áp dụng cho lần refresh Top Stocks kế tiếp. Điều kiện là > ngưỡng.",
    type: "integer",
    source: "runtime",
    defaultValue: 250_000,
    editable: true,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: false,
    validate(value: unknown): AdminValidationResult {
      const parsed = integer(value, 0, 1_000_000_000)
      return parsed == null ? { ok: false, error: "KLTB 50D phải là số nguyên từ 0 đến 1.000.000.000 cổ phiếu" } : { ok: true, value: parsed }
    },
  },
]

export const MARKET_UNIVERSE_SIZE_DEFINITION: AdminSettingDefinition = {
  key: "market.universe_size",
  group: "market",
  label: "Top Stocks Safety Cap",
  description: "Số mã tối đa trong canonical VN Top Stocks universe.",
  type: "integer",
  source: "code",
  defaultValue: 200,
  editable: false,
  sensitivity: "public",
  impact: "high",
  requiresDeployment: true,
  validate: () => ({ ok: false, error: "Read-only safety contract" }),
}

export function getMarketUniverseSettingDefinition(key: string) {
  if (key === MARKET_UNIVERSE_SIZE_DEFINITION.key) return MARKET_UNIVERSE_SIZE_DEFINITION
  return MARKET_UNIVERSE_SETTING_DEFINITIONS.find((definition) => definition.key === key)
}
