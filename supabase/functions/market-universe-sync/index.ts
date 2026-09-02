import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const UNIVERSE_KEY = "vn_top_stocks"
const MAX_SIZE = 200
const DEFAULT_MIN_MARKET_CAP_BILLION = 10
const DEFAULT_MIN_AVG_VOLUME_50D = 250_000
const ACTIVITY_OBSERVATION_DAYS = 5
const MIN_ACTIVE_DAYS = 4
const LOGO_BUCKET = "stock-logo"
const LEGACY_LOGO_BASE = "https://qeoindex.qeoqeo.com/logos"
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Candidate = {
  ticker: string
  company_name: string | null
  exchange: string | null
  sector: string | null
  market_cap_billion: number
  average_volume_50_sessions: number
  as_of_date: string
  activity_observation_days: number
  activity_positive_days: number
  eligible_candidate_count: number
}

type LogoKind = "official" | "generated_fallback"

type LogoProvenance = {
  logo_path: string
  logo_kind: LogoKind
  source: string
}

type ImageCandidate = {
  source: string
  body: Uint8Array
  contentType: string
  width: number
  height: number
  preferred: boolean
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

function bearerToken(req: Request) {
  const header = req.headers.get("authorization") || ""
  return header.startsWith("Bearer ") ? header.slice(7).trim() : ""
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseImageDimensions(buffer: Uint8Array): { width: number; height: number } | null {
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
      if (offset + 4 >= buffer.length) break
      const length = (buffer[offset + 2] << 8) | buffer[offset + 3]
      if (length < 2 || offset + 2 + length > buffer.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: (buffer[offset + 5] << 8) | buffer[offset + 6],
          width: (buffer[offset + 7] << 8) | buffer[offset + 8],
        }
      }
      offset += 2 + length
    }
  }
  return null
}

async function fetchImage(source: string, url: string, preferred: boolean): Promise<ImageCandidate | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 QeoIndex/1.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(4_000),
    })
    if (!response.ok) return null
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength < 500 || body.byteLength > 3_000_000) return null
    const dims = parseImageDimensions(body)
    if (!dims || dims.width <= 0 || dims.height <= 0) return null
    return {
      source,
      body,
      contentType: response.headers.get("content-type")?.split(";")[0] || (body[0] === 0x89 ? "image/png" : "image/jpeg"),
      width: dims.width,
      height: dims.height,
      preferred,
    }
  } catch {
    return null
  }
}

function rankImageCandidates(left: ImageCandidate, right: ImageCandidate) {
  const leftDiff = Math.abs(left.width / left.height - 1)
  const rightDiff = Math.abs(right.width / right.height - 1)
  const leftSquare = leftDiff <= 0.25
  const rightSquare = rightDiff <= 0.25
  if (leftSquare !== rightSquare) return leftSquare ? -1 : 1
  if (Math.abs(leftDiff - rightDiff) > 0.05) return leftDiff - rightDiff
  if (left.preferred !== right.preferred) return left.preferred ? -1 : 1
  return right.body.byteLength - left.body.byteLength
}

const GLYPHS: Record<string, string[]> = {
  A:["01110","10001","10001","11111","10001","10001","10001"],B:["11110","10001","10001","11110","10001","10001","11110"],C:["01111","10000","10000","10000","10000","10000","01111"],D:["11110","10001","10001","10001","10001","10001","11110"],E:["11111","10000","10000","11110","10000","10000","11111"],F:["11111","10000","10000","11110","10000","10000","10000"],G:["01111","10000","10000","10111","10001","10001","01111"],H:["10001","10001","10001","11111","10001","10001","10001"],I:["11111","00100","00100","00100","00100","00100","11111"],J:["00111","00010","00010","00010","10010","10010","01100"],K:["10001","10010","10100","11000","10100","10010","10001"],L:["10000","10000","10000","10000","10000","10000","11111"],M:["10001","11011","10101","10101","10001","10001","10001"],N:["10001","11001","10101","10011","10001","10001","10001"],O:["01110","10001","10001","10001","10001","10001","01110"],P:["11110","10001","10001","11110","10000","10000","10000"],Q:["01110","10001","10001","10001","10101","10010","01101"],R:["11110","10001","10001","11110","10100","10010","10001"],S:["01111","10000","10000","01110","00001","00001","11110"],T:["11111","00100","00100","00100","00100","00100","00100"],U:["10001","10001","10001","10001","10001","10001","01110"],V:["10001","10001","10001","10001","10001","01010","00100"],W:["10001","10001","10001","10101","10101","10101","01010"],X:["10001","10001","01010","00100","01010","10001","10001"],Y:["10001","10001","01010","00100","00100","00100","00100"],Z:["11111","00001","00010","00100","01000","10000","11111"],
  "0":["01110","10001","10011","10101","11001","10001","01110"],"1":["00100","01100","00100","00100","00100","00100","01110"],"2":["01110","10001","00001","00010","00100","01000","11111"],"3":["11110","00001","00001","01110","00001","00001","11110"],"4":["00010","00110","01010","10010","11111","00010","00010"],"5":["11111","10000","10000","11110","00001","00001","11110"],"6":["01110","10000","10000","11110","10001","10001","01110"],"7":["11111","00001","00010","00100","01000","01000","01000"],"8":["01110","10001","10001","01110","10001","10001","01110"],"9":["01110","10001","10001","01111","00001","00001","01110"],
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u32(value: number) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

function chunk(type: string, body: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type)
  const checksum = crc32(concat(typeBytes, body))
  return concat(u32(body.length), typeBytes, body, u32(checksum))
}

async function deterministicTickerPng(ticker: string) {
  const width = 96, height = 96
  let hash = 2166136261
  for (const char of ticker) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  const bg = [45 + (hash & 63), 55 + ((hash >>> 6) & 63), 75 + ((hash >>> 12) & 63)]
  const pixels = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4)
    pixels[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 4
      pixels[p] = bg[0]; pixels[p + 1] = bg[1]; pixels[p + 2] = bg[2]; pixels[p + 3] = 255
    }
  }
  const text = ticker.slice(0, 4).toUpperCase()
  const scale = text.length <= 3 ? 8 : 6
  const glyphWidth = 5 * scale
  const spacing = scale
  const totalWidth = text.length * glyphWidth + Math.max(0, text.length - 1) * spacing
  const startX = Math.max(2, Math.floor((width - totalWidth) / 2))
  const startY = Math.floor((height - 7 * scale) / 2)
  for (let ci = 0; ci < text.length; ci += 1) {
    const glyph = GLYPHS[text[ci]] || GLYPHS["0"]
    for (let gy = 0; gy < 7; gy += 1) for (let gx = 0; gx < 5; gx += 1) {
      if (glyph[gy][gx] !== "1") continue
      for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) {
        const x = startX + ci * (glyphWidth + spacing) + gx * scale + sx
        const y = startY + gy * scale + sy
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        const p = y * (1 + width * 4) + 1 + x * 4
        pixels[p] = 245; pixels[p + 1] = 248; pixels[p + 2] = 255; pixels[p + 3] = 255
      }
    }
  }
  const stream = new Blob([pixels]).stream().pipeThrough(new CompressionStream("deflate"))
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
  const ihdr = concat(u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0]))
  return concat(new Uint8Array([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array()))
}

async function objectExists(supabase: SupabaseClient, path: string) {
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).list("", { limit: 5, search: path })
  if (error) return false
  return Boolean(data?.some((item) => item.name === path))
}

async function readLogoProvenance(supabase: SupabaseClient, ticker: string): Promise<LogoProvenance | null> {
  const { data, error } = await supabase
    .from("market_logo_provenance")
    .select("logo_path,logo_kind,source")
    .eq("ticker", ticker)
    .maybeSingle()
  if (error) throw new Error(`Logo provenance lookup failed for ${ticker}: ${error.message}`)
  if (!data) return null
  if (data.logo_kind !== "official" && data.logo_kind !== "generated_fallback") {
    throw new Error(`Invalid logo provenance kind for ${ticker}: ${String(data.logo_kind)}`)
  }
  return {
    logo_path: String(data.logo_path),
    logo_kind: data.logo_kind,
    source: String(data.source),
  }
}

async function persistLogoProvenance(supabase: SupabaseClient, ticker: string, path: string, kind: LogoKind, source: string) {
  const { error } = await supabase.from("market_logo_provenance").upsert({
    ticker,
    logo_path: path,
    logo_kind: kind,
    source,
    updated_at: new Date().toISOString(),
  }, { onConflict: "ticker" })
  if (error) throw new Error(`Logo provenance persist failed for ${ticker}: ${error.message}`)
}

async function ensureLogo(supabase: SupabaseClient, ticker: string): Promise<{ path: string; kind: LogoKind; source: string }> {
  const path = `${ticker}.png`
  if (await objectExists(supabase, path)) {
    const provenance = await readLogoProvenance(supabase, ticker)
    if (!provenance) throw new Error(`Logo provenance missing for existing storage object ${ticker}`)
    if (provenance.logo_path !== path) {
      throw new Error(`Logo provenance path mismatch for ${ticker}: expected ${path}, got ${provenance.logo_path}`)
    }
    return { path, kind: provenance.logo_kind, source: provenance.source }
  }

  const legacy = await fetchImage("qeoindex-local-legacy", `${LEGACY_LOGO_BASE}/${ticker}.png`, true)
  let best = legacy
  if (!best) {
    const sources = [
      ["ruatichsan-jpeg", `https://ruatichsan.com/images/logos/${ticker}.jpeg`, true],
      ["ruatichsan-png", `https://ruatichsan.com/images/logos/${ticker}.png`, true],
      ["ruatichsan-jpg", `https://ruatichsan.com/images/logos/${ticker}.jpg`, true],
      ["24hmoney-jpg", `https://cdn.24hmoney.vn/upload/images_cr/2021-12-03/partner/images/uploaded/dulieudownload/logodn/${ticker}.jpg`, true],
      ["24hmoney-png", `https://cdn.24hmoney.vn/upload/images_cr/2021-12-03/partner/images/uploaded/dulieudownload/logodn/${ticker}.png`, true],
      ["vietstock", `https://finance.vietstock.vn/image/${ticker}`, false],
    ] as const
    const candidates = (await Promise.all(sources.map(([name, url, preferred]) => fetchImage(name, url, preferred)))).filter((item): item is ImageCandidate => Boolean(item))
    candidates.sort(rankImageCandidates)
    best = candidates[0] || null
  }

  if (best) {
    await persistLogoProvenance(supabase, ticker, path, "official", best.source)
    const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, best.body, { upsert: true, contentType: best.contentType, cacheControl: "2592000" })
    if (error) throw new Error(`Logo upload failed for ${ticker}: ${error.message}`)
    return { path, kind: "official", source: best.source }
  }

  const fallback = await deterministicTickerPng(ticker)
  await persistLogoProvenance(supabase, ticker, path, "generated_fallback", "generated_fallback")
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, fallback, { upsert: true, contentType: "image/png", cacheControl: "2592000" })
  if (error) throw new Error(`Fallback logo upload failed for ${ticker}: ${error.message}`)
  return { path, kind: "generated_fallback", source: "generated_fallback" }
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function runner() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()))
  return results
}

async function loadSetting(supabase: SupabaseClient, key: string, fallback: number) {
  const { data } = await supabase.from("system_settings").select("value").eq("key", key).maybeSingle()
  return positiveNumber(data?.value, fallback)
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  if (!supabaseUrl || !serviceRole) return json({ ok: false, error: "Supabase service environment unavailable" }, 500)
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })

  const token = bearerToken(req)
  const { data: authorized, error: authError } = await supabase.rpc("qeo_verify_eod_scheduler_secret", { p_secret: token })
  if (authError || authorized !== true) return json({ ok: false, error: "Unauthorized" }, 401)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { body = {} }
  const trigger = body.source === "supabase_pg_cron" ? "schedule" : "external"
  const startedAt = new Date().toISOString()
  let telemetryId: string | null = null
  let universeRunId: string | null = null

  try {
    const telemetry = await supabase.from("system_job_runs").insert({
      job_key: "market.universe_monthly", provider: "supabase_edge", trigger, status: "running", started_at: startedAt,
      summary: { universeKey: UNIVERSE_KEY, stage: "select" },
    }).select("id").single()
    telemetryId = telemetry.data?.id || null

    const minMarketCapBillion = await loadSetting(supabase, "market.universe_min_market_cap_billion", DEFAULT_MIN_MARKET_CAP_BILLION)
    const minAverageVolume50d = await loadSetting(supabase, "market.universe_min_avg_volume_50d", DEFAULT_MIN_AVG_VOLUME_50D)

    const latest = await supabase.from("insights_stock_ratings").select("as_of_date")
      .eq("is_published", true).eq("source", "kfsp").order("as_of_date", { ascending: false }).limit(1).maybeSingle()
    if (latest.error || !latest.data?.as_of_date) throw new Error(`No published KFSP snapshot: ${latest.error?.message || "empty"}`)
    const sourceDate = String(latest.data.as_of_date)

    const candidatesQuery = await supabase.rpc("qeo_select_market_universe_candidates", {
      p_source_date: sourceDate,
      p_min_market_cap_billion: minMarketCapBillion,
      p_min_average_volume_50d: Math.floor(minAverageVolume50d),
      p_max_size: MAX_SIZE,
    })
    if (candidatesQuery.error) throw new Error(`Candidate selection failed: ${candidatesQuery.error.message}`)
    const candidates = (candidatesQuery.data || []) as Candidate[]
    if (candidates.length === 0) throw new Error("Universe selector produced no publishable daily-traded rows")

    const candidateCount = Number(candidates[0]?.eligible_candidate_count || candidates.length)
    if (!Number.isInteger(candidateCount) || candidateCount < candidates.length) {
      throw new Error(`Universe selector returned invalid eligible candidate count: ${candidateCount}`)
    }
    for (const candidate of candidates) {
      const tradingObservationDays = Number(candidate.activity_observation_days)
      const tradingActiveDays = Number(candidate.activity_positive_days)
      if (tradingObservationDays !== ACTIVITY_OBSERVATION_DAYS || tradingActiveDays < MIN_ACTIVE_DAYS || tradingActiveDays > tradingObservationDays) {
        throw new Error(`Universe selector returned non-daily-traded candidate ${candidate.ticker}: activity=${tradingActiveDays}/${tradingObservationDays}`)
      }
    }

    const runInsert = await supabase.from("market_universe_runs").insert({
      universe_key: UNIVERSE_KEY, status: "running", source: "kfsp", source_as_of_date: sourceDate,
      max_size: MAX_SIZE, min_market_cap_billion: minMarketCapBillion, min_average_volume_50d: Math.floor(minAverageVolume50d),
      candidate_count: candidateCount, selected_count: 0, started_at: startedAt,
    }).select("id").single()
    if (runInsert.error || !runInsert.data?.id) throw new Error(`Unable to create universe run: ${runInsert.error?.message || "empty"}`)
    universeRunId = String(runInsert.data.id)

    const logoResults = await mapWithConcurrency(candidates, 8, async (candidate) => ({ ticker: candidate.ticker, ...(await ensureLogo(supabase, candidate.ticker)) }))
    const logoMap = new Map(logoResults.map((item) => [item.ticker, item]))
    const rows = candidates.map((candidate, index) => {
      const logo = logoMap.get(candidate.ticker)
      if (!logo) throw new Error(`Logo result missing for ${candidate.ticker}`)
      return {
        run_id: universeRunId,
        universe_key: UNIVERSE_KEY,
        ticker: String(candidate.ticker).toUpperCase(),
        rank: index + 1,
        company_name: candidate.company_name || candidate.ticker,
        exchange: candidate.exchange,
        sector: candidate.sector,
        market_cap_billion: Number(candidate.market_cap_billion),
        average_volume_50d: Number(candidate.average_volume_50_sessions),
        source_as_of_date: candidate.as_of_date,
        logo_path: logo.path,
        logo_kind: logo.kind,
        detail_complete: Boolean(candidate.ticker && candidate.as_of_date && (candidate.company_name || candidate.ticker)),
      }
    })

    for (let i = 0; i < rows.length; i += 50) {
      const inserted = await supabase.from("market_universe_memberships").insert(rows.slice(i, i + 50))
      if (inserted.error) throw new Error(`Membership insert failed: ${inserted.error.message}`)
    }

    const published = await supabase.rpc("qeo_publish_market_universe_run", { p_run_id: universeRunId })
    if (published.error || !published.data) throw new Error(`Universe publish failed: ${published.error?.message || "empty"}`)

    const official = rows.filter((row) => row.logo_kind === "official").length
    const generatedFallback = rows.length - official
    const activitySummary = { activityObservationDays: ACTIVITY_OBSERVATION_DAYS, minActiveDays: MIN_ACTIVE_DAYS }
    if (telemetryId) await supabase.from("system_job_runs").update({
      status: "succeeded", finished_at: new Date().toISOString(),
      summary: { universeKey: UNIVERSE_KEY, runId: universeRunId, sourceDate, candidateCount, selectedCount: rows.length, ...activitySummary, officialLogos: official, generatedFallbackLogos: generatedFallback, detailComplete: rows.length },
    }).eq("id", telemetryId)

    return json({ ok: true, runId: universeRunId, sourceDate, candidateCount, selectedCount: rows.length, ...activitySummary, officialLogos: official, generatedFallbackLogos: generatedFallback })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (universeRunId) await supabase.from("market_universe_runs").update({ status: "failed", error_code: "UNIVERSE_REFRESH_FAILED", error_message: message.slice(0, 1000) }).eq("id", universeRunId)
    if (telemetryId) await supabase.from("system_job_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_code: "UNIVERSE_REFRESH_FAILED", error_message: message.slice(0, 1000), summary: { universeKey: UNIVERSE_KEY, runId: universeRunId } }).eq("id", telemetryId)
    return json({ ok: false, error: message, runId: universeRunId }, 500)
  }
})