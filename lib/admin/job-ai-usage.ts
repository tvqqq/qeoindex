export type AiCouncilLlmUsageRow = {
  as_of_date: string
  ticker?: string | null
  call_audit?: unknown
  input_tokens?: number | null
  output_tokens?: number | null
  total_tokens?: number | null
  cached_input_tokens?: number | null
  reasoning_tokens?: number | null
  estimated_cost_usd?: number | string | null
}

export type AdminAiUsage = {
  asOfDate: string
  debates: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  estimatedCostUsd: number
  models: string[]
}

function finiteNumber(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function responseModels(callAudit: unknown) {
  if (!Array.isArray(callAudit)) return []
  return callAudit
    .map((entry) => {
      if (!entry || typeof entry !== "object") return ""
      return String((entry as { responseModel?: unknown }).responseModel || "").trim()
    })
    .filter(Boolean)
}

export function formatAdminModelLabel(model: string) {
  const compact = model.match(/^gpt-5\.6-(luna|terra|sol)$/i)?.[1]
  if (compact) return compact.charAt(0).toUpperCase() + compact.slice(1).toLowerCase()
  if (model.toLowerCase() === "gpt-5-mini") return "GPT-5 mini"
  return model
}

export function aggregateAiCouncilUsage(rows: AiCouncilLlmUsageRow[]): Record<string, AdminAiUsage> {
  const result: Record<string, AdminAiUsage> = {}

  for (const row of rows) {
    const asOfDate = String(row.as_of_date || "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) continue

    const current = result[asOfDate] ?? {
      asOfDate,
      debates: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
      models: [],
    }

    current.debates += 1
    current.inputTokens += Math.max(0, finiteNumber(row.input_tokens))
    current.outputTokens += Math.max(0, finiteNumber(row.output_tokens))
    current.totalTokens += Math.max(0, finiteNumber(row.total_tokens))
    current.cachedInputTokens += Math.max(0, finiteNumber(row.cached_input_tokens))
    current.reasoningTokens += Math.max(0, finiteNumber(row.reasoning_tokens))
    current.estimatedCostUsd += Math.max(0, finiteNumber(row.estimated_cost_usd))

    for (const model of responseModels(row.call_audit)) {
      if (!current.models.includes(model)) current.models.push(model)
    }

    result[asOfDate] = current
  }

  for (const usage of Object.values(result)) {
    usage.estimatedCostUsd = Number(usage.estimatedCostUsd.toFixed(6))
  }

  return result
}
