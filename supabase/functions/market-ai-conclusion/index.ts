import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

import {
  buildMarketAiEvidencePacket,
  expectedMissingEvidence,
  hashMarketAiEvidence,
  normalizeMarketAiConclusionReferences,
  validateMarketAiConclusion,
  type MarketAiConclusionPayload,
  type MarketAiSnapshotInput,
} from "../_shared/market-ai-conclusion.ts"

const REASONING_EFFORT = "low"
const MAX_OUTPUT_TOKENS = 1_800
const MAX_COST_USD = 0.03
const MAX_INPUT_CHARS = 36_000
const OPENAI_TIMEOUT_MS = 30_000
const JOB_KEY = "market.ai_conclusion"

type JsonObject = Record<string, unknown>

function jsonResponse(body: JsonObject, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null
}

function serviceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (legacy) return legacy
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS")
  if (!encoded) return ""
  try {
    return String(JSON.parse(encoded)?.default || "")
  } catch {
    return ""
  }
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  let mismatch = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return mismatch === 0
}

function requestToken(req: Request) {
  return (req.headers.get("x-market-ai-secret") || "").trim()
}

function errorCode(error: unknown): string {
  const candidate = (error as { code?: unknown } | null)?.code
  if (typeof candidate === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(candidate)) return candidate
  return "MARKET_AI_RUNTIME_FAILED"
}

function numberOrNull(value: unknown) {
  const number = value == null || value === "" ? null : Number(value)
  return number != null && Number.isFinite(number) ? number : null
}

function integerOrZero(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0
}

function asOfOrNull(value: unknown) {
  const asOf = typeof value === "string" ? value : ""
  return asOf && Number.isFinite(new Date(asOf).getTime()) ? asOf : null
}

function sessionDateValid(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

async function latestSessionDate(supabase: SupabaseClient) {
  const result = await supabase.from("market_insight_daily").select("session_date").order("session_date", { ascending: false }).limit(1).maybeSingle()
  if (result.error) throw Object.assign(new Error("snapshot lookup failed"), { code: "SNAPSHOT_LOOKUP_FAILED" })
  return result.data?.session_date ? String(result.data.session_date) : null
}

async function loadSnapshot(supabase: SupabaseClient, requestedDate: string | null): Promise<MarketAiSnapshotInput | null> {
  const sessionDate = requestedDate || await latestSessionDate(supabase)
  if (!sessionDate) return null

  const [dailyResult, indexesResult, sectorsResult, leadersResult] = await Promise.all([
    supabase.from("market_insight_daily").select("*").eq("session_date", sessionDate).maybeSingle(),
    supabase.from("market_insight_indexes").select("*").eq("session_date", sessionDate),
    supabase.from("market_insight_sectors").select("*").eq("session_date", sessionDate).eq("time_window", "1d"),
    supabase.from("market_insight_leaders").select("*").eq("session_date", sessionDate),
  ])
  if (dailyResult.error || indexesResult.error || sectorsResult.error || leadersResult.error) {
    throw Object.assign(new Error("published snapshot read failed"), { code: "SNAPSHOT_READ_FAILED" })
  }
  const daily = asObject(dailyResult.data)
  if (!daily) return null
  const asOf = asOfOrNull(daily.as_of)
  if (!asOf) throw Object.assign(new Error("published snapshot has invalid timestamp"), { code: "SNAPSHOT_ASOF_INVALID" })
  const syncRunId = typeof daily.sync_run_id === "string" ? daily.sync_run_id : ""
  if (!syncRunId) throw Object.assign(new Error("published snapshot provenance missing"), { code: "SNAPSHOT_PROVENANCE_MISSING" })
  const syncRunResult = await supabase.from("market_insight_sync_runs").select("id,session_date,status,contract_version,payload_checksum,endpoint_coverage,published_counts").eq("id", syncRunId).eq("status", "completed").maybeSingle()
  const syncRun = asObject(syncRunResult.data)
  const coverage = asObject(syncRun?.endpoint_coverage)
  const counts = asObject(syncRun?.published_counts)
  if (syncRunResult.error || !syncRun || String(syncRun.session_date) !== sessionDate || String(syncRun.payload_checksum || "").match(/^[0-9a-f]{64}$/) == null || !Number.isInteger(Number(syncRun.contract_version)) || !coverage || !counts || Object.values(coverage).length === 0 || Object.values(coverage).some((value) => value !== true) || Number(counts.daily) !== 1 || Number(counts.index) !== (indexesResult.data || []).length || Number(counts.sector) !== (sectorsResult.data || []).length || Number(counts.leader) !== (leadersResult.data || []).length || (indexesResult.data || []).some((row) => row.sync_run_id !== syncRunId) || (sectorsResult.data || []).some((row) => row.sync_run_id !== syncRunId) || (leadersResult.data || []).some((row) => row.sync_run_id !== syncRunId)) throw Object.assign(new Error("published snapshot provenance invalid"), { code: "SNAPSHOT_PROVENANCE_INVALID" })

  const indexes = (indexesResult.data || []).map((row) => {
    const item = asObject(row)
    return {
      indexCode: String(item?.index_code || ""),
      value: numberOrNull(item?.value),
      changePct: numberOrNull(item?.change_pct),
      advances: integerOrZero(item?.advances),
      unchanged: integerOrZero(item?.unchanged),
      declines: integerOrZero(item?.declines),
      asOf: asOfOrNull(item?.as_of) || "",
    }
  })
  const sectors = (sectorsResult.data || []).map((row) => {
    const item = asObject(row)
    return {
      sectorKey: String(item?.sector_key || ""),
      rotationState: item?.rotation_state == null ? null : String(item.rotation_state),
      effortPct: numberOrNull(item?.effort_pct),
      resultPct: numberOrNull(item?.result_pct),
      asOf: asOfOrNull(item?.as_of) || "",
    }
  })
  const leaders = (leadersResult.data || []).map((row) => {
    const item = asObject(row)
    return {
      category: String(item?.category || ""),
      rank: integerOrZero(item?.rank),
      ticker: String(item?.ticker || "").trim().toUpperCase(),
      metricValue: numberOrNull(item?.metric_value),
      metricLabel: item?.metric_label == null ? null : String(item.metric_label),
      price: numberOrNull(item?.price),
      asOf: asOfOrNull(item?.as_of) || "",
    }
  })

  if ([...indexes, ...sectors, ...leaders].some((row) => row.asOf !== asOf)) {
    throw Object.assign(new Error("published snapshot timestamps are mixed"), { code: "SNAPSHOT_ASOF_MISMATCH" })
  }

  return {
    sessionDate,
    asOf,
    qualityStatus: String(daily.quality_status || "unknown"),
    daily: {
      sentimentScore: numberOrNull(daily.sentiment_score),
      riskScore: numberOrNull(daily.risk_score),
      aboveMa20Pct: numberOrNull(daily.above_ma20_pct),
      totalTradedValue: numberOrNull(daily.total_traded_value),
      foreignNetValue: numberOrNull(daily.foreign_net_value),
      proprietaryNetValue: numberOrNull(daily.proprietary_net_value),
      missingFields: Array.isArray(daily.missing_fields) ? daily.missing_fields.map(String).slice(0, 80) : [],
    },
    indexes,
    sectors,
    leaders,
    observations: [],
    marketInsightProvenance: {
      syncRunId,
      payloadChecksum: String(syncRun.payload_checksum),
      contractVersion: Number(syncRun.contract_version),
      endpointCoverage: Object.fromEntries(Object.entries(coverage).map(([key, value]) => [key, value === true])),
      publishedCounts: Object.fromEntries(Object.entries(counts).flatMap(([key, value]) => Number.isFinite(Number(value)) ? [[key, Number(value)]] : [])),
    },
  }
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "confidence", "headline", "sessionDate", "asOf", "snapshotId", "evidenceHash", "policyVersion", "promptVersion", "framework", "posture", "conclusion", "risks", "missingEvidence", "effortResult", "dimensions", "citations"],
  properties: {
    schemaVersion: { type: "string" }, confidence: { type: "string", enum: ["low", "medium", "high"] }, headline: { type: "string", maxLength: 240 },
    sessionDate: { type: "string" }, asOf: { type: "string" }, snapshotId: { type: "string" }, evidenceHash: { type: "string" }, policyVersion: { type: "string" }, promptVersion: { type: "string" }, framework: { type: "string", enum: ["canslim_4m_inspired"] }, posture: { type: "string", enum: ["constructive", "constructive_with_caution", "neutral", "defensive", "insufficient_evidence"] }, conclusion: { type: "string", minLength: 1, maxLength: 600 },
    risks: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } }, missingEvidence: { type: "array", maxItems: 8, items: { type: "string", maxLength: 100 } },
    effortResult: { type: "object", additionalProperties: false, required: ["effort", "effortEvidenceRefs", "result", "resultEvidenceRefs", "interpretation"], properties: { effort: { type: "string", maxLength: 140 }, effortEvidenceRefs: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } }, result: { type: "string", maxLength: 140 }, resultEvidenceRefs: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } }, interpretation: { type: "string", maxLength: 220 } } },
    dimensions: { type: "array", minItems: 5, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["key", "stance", "summary", "evidenceRefs"], properties: { key: { type: "string", enum: ["index_breadth", "liquidity_flow", "ma_health", "sector_rotation", "leadership"] }, stance: { type: "string", enum: ["supportive", "mixed", "adverse", "unknown"] }, summary: { type: "string", maxLength: 180 }, evidenceRefs: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } } } } },
    citations: { type: "array", minItems: 2, maxItems: 10, items: { type: "object", additionalProperties: false, required: ["factId", "claim", "riskIndex", "interpretation"], properties: { factId: { type: "string" }, claim: { type: "string", enum: ["conclusion", "risk", "effort_result"] }, riskIndex: { type: ["integer", "null"] }, interpretation: { type: "string", minLength: 1, maxLength: 180 } } } },
  },
} as const

function outputSchema(packet: Awaited<ReturnType<typeof buildMarketAiEvidencePacket>>, evidenceHash: string) {
  return {
    ...OUTPUT_SCHEMA,
    properties: {
      ...OUTPUT_SCHEMA.properties,
      schemaVersion: { type: "string", enum: [packet.packetVersion] },
      sessionDate: { type: "string", enum: [packet.sessionDate] },
      asOf: { type: "string", enum: [packet.asOf] },
      snapshotId: { type: "string", enum: [packet.snapshotId] },
      evidenceHash: { type: "string", enum: [evidenceHash] },
      policyVersion: { type: "string", enum: [packet.policyVersion] },
      promptVersion: { type: "string", enum: [packet.promptVersion] },
      framework: { type: "string", enum: [packet.framework] },
    },
  }
}

function compactInput(packet: unknown) {
  const object = packet as JsonObject
  return {
    ...object,
    facts: Array.isArray(object.facts) ? object.facts.slice(0, 220) : [],
    observations: Array.isArray(object.observations) ? object.observations.slice(0, 8) : [],
  }
}

function buildPrompt(packet: unknown) {
  const input = JSON.stringify(compactInput(packet))
  const prompt = [
    "POINT_IN_TIME_MARKET_EVIDENCE_JSON:", input,
    "\nTASK:", "Viết kết luận thị trường bằng tiếng Việt theo lăng kính CANSLIM / 4M-inspired và effort-result.",
    "\nGUARDRAILS:",
    "Chỉ dùng facts/observations trong JSON; mọi claim phải có factId trong citations.",
    "CANSLIM/4M chỉ là lăng kính diễn giải: không tự tính điểm, không phát minh công thức, không suy ra dữ liệu thiếu.",
    "Không đưa khuyến nghị mua/bán, mục tiêu giá, tỷ trọng hay lời khuyên đầu tư cá nhân.",
    "Giữ nguyên sessionDate, asOf, snapshotId, evidenceHash, policyVersion, promptVersion và framework từ evidence.",
    "missingEvidence phải đúng danh sách bắt buộc; dimensions phải có đủ đúng 5 key; citations claim risk phải đặt riskIndex đúng chỉ số của risks.",
    "Ownership bắt buộc cho dimensions.evidenceRefs: index_breadth chỉ dùng vnindex_close/vnindex_change_pct/advances/unchanged/declines; liquidity_flow chỉ dùng total_traded_value/foreign_net_value/proprietary_net_value; ma_health chỉ dùng above_ma20_pct; sector_rotation chỉ dùng factId bắt đầu sector:; leadership chỉ dùng factId bắt đầu leader:.",
    "citations bắt buộc có ít nhất một claim=conclusion, một claim=effort_result dùng total_traded_value/foreign_net_value/proprietary_net_value/vnindex_change_pct hoặc sector:, và mỗi risks[i] phải có claim=risk với riskIndex=i; mọi claim khác risk phải có riskIndex=null.",
    "Viết súc tích theo giới hạn schema; không lặp evidence. Nếu bằng chứng không đủ, posture phải là insufficient_evidence và nêu rõ phần thiếu.",
  ].join("\n")
  if (prompt.length > MAX_INPUT_CHARS) throw Object.assign(new Error("bounded input exceeded"), { code: "INPUT_TOO_LARGE" })
  return prompt
}

function responseText(payload: unknown) {
  const root = asObject(payload)
  if (typeof root?.output_text === "string" && root.output_text.trim()) return root.output_text.trim()
  for (const output of Array.isArray(root?.output) ? root.output : []) {
    const item = asObject(output)
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      const child = asObject(content)
      if (child?.type === "refusal") throw Object.assign(new Error("model refusal"), { code: "OPENAI_REFUSAL" })
      if (child?.type === "output_text" && typeof child.text === "string" && child.text.trim()) return child.text.trim()
    }
  }
  throw Object.assign(new Error("structured output missing"), { code: "OPENAI_OUTPUT_MISSING" })
}

function usage(payload: unknown) {
  const root = asObject(payload)
  const value = asObject(root?.usage)
  const inputTokens = integerOrZero(value?.input_tokens ?? value?.prompt_tokens)
  const outputTokens = integerOrZero(value?.output_tokens ?? value?.completion_tokens)
  return { inputTokens, outputTokens }
}

function pricingConfig() {
  const inputRate = Number(Deno.env.get("MARKET_AI_INPUT_USD_PER_MILLION") || "")
  const outputRate = Number(Deno.env.get("MARKET_AI_OUTPUT_USD_PER_MILLION") || "")
  const model = Deno.env.get("MARKET_AI_MODEL")?.trim() || ""
  if (!model || Deno.env.get("MARKET_AI_MODEL_API_VALIDATED") !== "true" || !Number.isFinite(inputRate) || inputRate < 0 || !Number.isFinite(outputRate) || outputRate < 0) throw Object.assign(new Error("explicit model/pricing configuration required"), { code: "AI_CONFIG_INVALID" })
  return { model, inputRate, outputRate }
}

function estimateCost(inputTokens: number, outputTokens: number, config: { inputRate: number; outputRate: number }) {
  const cost = (inputTokens * config.inputRate + outputTokens * config.outputRate) / 1_000_000
  return Number(cost.toFixed(6))
}

async function callOpenAi(prompt: string, config: { model: string }, schema: ReturnType<typeof outputSchema>) {
  const key = Deno.env.get("OPENAI_API_KEY") || ""
  if (!key) throw Object.assign(new Error("OpenAI key missing"), { code: "OPENAI_NOT_CONFIGURED" })
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, instructions: "You are a factual market evidence editor. Return only the requested JSON object.", input: prompt, reasoning: { effort: REASONING_EFFORT }, text: { format: { type: "json_schema", name: "market_ai_conclusion", strict: true, schema } }, max_output_tokens: MAX_OUTPUT_TOKENS, store: false, tools: [] }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  })
  const raw = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error("OpenAI request failed"), { code: `OPENAI_HTTP_${response.status}` })
  const text = responseText(raw)
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw Object.assign(new Error("OpenAI JSON invalid"), { code: "OPENAI_JSON_INVALID" }) }
  const tokenUsage = usage(raw)
  return { payload, ...tokenUsage, model: String(asObject(raw)?.model || config.model) }
}

async function complete(supabase: SupabaseClient, id: string, claimToken: string, status: "succeeded" | "failed" | "insufficient_evidence", posture: string, payload: JsonObject, manifest: JsonObject, model: string | null, inputTokens: number | null, outputTokens: number | null, cost: number | null, code: string | null) {
  const result = await supabase.rpc("complete_market_ai_conclusion", { p_id: id, p_claim_token: claimToken, p_status: status, p_posture: posture, p_payload: payload, p_manifest: manifest, p_model: model, p_input_tokens: inputTokens, p_output_tokens: outputTokens, p_cost: cost, p_error_code: code })
  if (result.error || result.data !== true) throw Object.assign(new Error("completion claim rejected"), { code: "COMPLETION_WRITE_FAILED" })
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)
  const expectedSecret = Deno.env.get("MARKET_AI_CONCLUSION_SECRET") || ""
  if (!expectedSecret) return jsonResponse({ ok: false, error: "SYNC_SECRET_NOT_CONFIGURED" }, 503)
  if (!constantTimeEqual(expectedSecret, requestToken(req))) return jsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const supabaseKey = serviceRoleKey()
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ ok: false, error: "SUPABASE_NOT_CONFIGURED" }, 503)
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const body = await req.json().catch(() => ({})) as JsonObject
  const mode = body.mode == null ? "latest" : String(body.mode)
  if (mode !== "latest" && mode !== "session") return jsonResponse({ ok: false, error: "INVALID_MODE" }, 400)
  const requestedDate = mode === "session" ? body.sessionDate : null
  if (mode === "session" && !sessionDateValid(requestedDate)) return jsonResponse({ ok: false, error: "INVALID_SESSION_DATE" }, 400)

  let packetId = ""
  let claimToken = ""
  let modelStarted = false
  let currentManifest: JsonObject | null = null
  try {
    const snapshot = await loadSnapshot(supabase, typeof requestedDate === "string" ? requestedDate : null)
    if (!snapshot) return jsonResponse({ ok: false, error: "SNAPSHOT_NOT_FOUND" }, 404)
    const packet = await buildMarketAiEvidencePacket(snapshot)
    const evidenceHash = await hashMarketAiEvidence(packet)
    const manifest = { packetVersion: packet.packetVersion, snapshotId: packet.snapshotId, sessionDate: packet.sessionDate, asOf: packet.asOf, evidenceHash, mandatoryDimensions: packet.mandatoryDimensions, missingEvidence: expectedMissingEvidence(packet) }
    currentManifest = manifest
    const claim = await supabase.rpc("claim_market_ai_conclusion", { p_snapshot_id: packet.snapshotId, p_session_date: packet.sessionDate, p_as_of: packet.asOf, p_schema_version: packet.packetVersion, p_policy_version: packet.policyVersion, p_prompt_version: packet.promptVersion, p_evidence_hash: evidenceHash, p_evidence_manifest: manifest })
    if (claim.error) throw Object.assign(new Error("claim failed"), { code: "CLAIM_FAILED" })
    const row = Array.isArray(claim.data) ? claim.data[0] as JsonObject | undefined : asObject(claim.data)
    if (!row?.id || !row.status) throw Object.assign(new Error("claim returned no row"), { code: "CLAIM_EMPTY" })
    packetId = String(row.id)
    if (row.status === "succeeded" || row.status === "insufficient_evidence" || row.status === "completion_unknown") return jsonResponse({ ok: true, status: "skipped", session_date: packet.sessionDate, evidence_hash: evidenceHash, reason: "IDEMPOTENT_TERMINAL" })
    if (row.status !== "running" || !row.claim_token) return jsonResponse({ ok: true, status: "in_progress", session_date: packet.sessionDate, evidence_hash: evidenceHash }, 202)
    claimToken = String(row.claim_token)

    const insufficient = packet.qualityStatus !== "healthy" || Object.values(packet.mandatoryDimensions).some((value) => value !== "complete")
    if (insufficient) {
      await complete(supabase, packetId, claimToken, "insufficient_evidence", "insufficient_evidence", {}, manifest, null, null, null, null, null)
      return jsonResponse({ ok: true, status: "insufficient_evidence", session_date: packet.sessionDate, evidence_hash: evidenceHash, missing_evidence: manifest.missingEvidence })
    }

    const prompt = buildPrompt(packet)
    const pricing = pricingConfig()
    const worstCost = estimateCost(Math.ceil(prompt.length / 3), MAX_OUTPUT_TOKENS, pricing)
    if (worstCost > MAX_COST_USD) throw Object.assign(new Error("worst-case model cost bound exceeded"), { code: "COST_BOUND_EXCEEDED" })
    const started = await supabase.rpc("start_market_ai_conclusion_model", { p_id: packetId, p_claim_token: claimToken })
    if (started.error || started.data !== true) throw Object.assign(new Error("model start claim rejected"), { code: "MODEL_START_FAILED" })
    modelStarted = true
    const modelResponse = await callOpenAi(prompt, pricing, outputSchema(packet, evidenceHash))
    const normalizedPayload = normalizeMarketAiConclusionReferences(modelResponse.payload as MarketAiConclusionPayload, packet)
    const validation = validateMarketAiConclusion({ payload: normalizedPayload, packet, evidenceHash, packetHash: evidenceHash })
    if (!validation.valid) throw Object.assign(new Error("model output failed contract"), { code: "OUTPUT_VALIDATION_FAILED", validationErrors: validation.errors.slice(0, 12) })
    const inputCost = estimateCost(modelResponse.inputTokens, modelResponse.outputTokens, pricing)
    if (inputCost > MAX_COST_USD) throw Object.assign(new Error("model cost bound exceeded"), { code: "COST_BOUND_EXCEEDED" })
    const typedPayload = normalizedPayload
    await complete(supabase, packetId, claimToken, "succeeded", typedPayload.posture, typedPayload as unknown as JsonObject, manifest, modelResponse.model, modelResponse.inputTokens, modelResponse.outputTokens, inputCost, null)
    return jsonResponse({ ok: true, status: "succeeded", session_date: packet.sessionDate, evidence_hash: evidenceHash, model: modelResponse.model, input_tokens: modelResponse.inputTokens, output_tokens: modelResponse.outputTokens })
  } catch (error) {
    const code = errorCode(error)
    if (packetId && claimToken) {
      if (modelStarted) {
        try { await supabase.rpc("mark_market_ai_completion_unknown", { p_id: packetId, p_claim_token: claimToken, p_error_code: code }) } catch { /* sanitized best-effort terminal telemetry */ }
      } else if (currentManifest) {
        try { await complete(supabase, packetId, claimToken, "failed", "insufficient_evidence", {}, currentManifest, null, null, null, null, code) } catch { /* sanitized best-effort terminal telemetry */ }
      }
    }
    const validationErrors = (error as { validationErrors?: unknown } | null)?.validationErrors
    return jsonResponse({ ok: false, status: "failed", error: code, ...(Array.isArray(validationErrors) ? { validation_errors: validationErrors } : {}) }, code === "SNAPSHOT_NOT_FOUND" ? 404 : 502)
  }
})
