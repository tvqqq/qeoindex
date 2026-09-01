import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { buildMarketAiEvidencePacket, hashMarketAiEvidence, type MarketAiConclusionPayload } from "@/lib/market-ai-conclusion"
import type { MarketCloseDashboardData } from "@/lib/market-insight-data"

export interface MarketAiConclusionView {
  status: "succeeded" | "pending" | "failed" | "insufficient_evidence" | "completion_unknown" | "stale" | "none"
  payload: MarketAiConclusionPayload | null
  evidence: Array<{ id: string; value: string | number | null; unit: string | null; source: string; asOf: string }>
  asOf: string | null
  evidenceHash: string | null
  message: string
}

export async function loadMarketAiConclusion(admin: SupabaseClient | null, snapshot: MarketCloseDashboardData | null): Promise<MarketAiConclusionView> {
  const fallback = (status: MarketAiConclusionView["status"], message: string): MarketAiConclusionView => ({ status, payload: null, evidence: [], asOf: snapshot?.asOf ?? null, evidenceHash: null, message })
  if (!admin || !snapshot) return fallback("none", "Chưa có snapshot thị trường để đối chiếu AI.")
  let packet
  try {
    packet = buildMarketAiEvidencePacket(snapshot)
  } catch {
    return fallback("none", "Published snapshot provenance chưa đủ để đối chiếu AI.")
  }
  const evidenceHash = hashMarketAiEvidence(packet)
  const result = await admin.from("market_ai_conclusions").select("session_date,as_of,snapshot_id,policy_version,prompt_version,evidence_hash,status,posture,conclusion_payload,evidence_manifest").eq("session_date", packet.sessionDate).eq("evidence_hash", evidenceHash).order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (result.error) return fallback("none", "Chưa đọc được market AI snapshot.")
  if (!result.data) return fallback("none", "Chưa có market AI conclusion cho snapshot này.")
  if (result.data.as_of !== packet.asOf || result.data.snapshot_id !== packet.snapshotId || result.data.policy_version !== packet.policyVersion || result.data.prompt_version !== packet.promptVersion) return fallback("stale", "Market AI conclusion không còn khớp snapshot hiện tại.")
  const manifest = result.data.evidence_manifest as { packetVersion?: string; snapshotId?: string; sessionDate?: string; asOf?: string; evidenceHash?: string } | null
  if (!manifest || manifest.packetVersion !== packet.packetVersion || manifest.snapshotId !== packet.snapshotId || manifest.sessionDate !== packet.sessionDate || manifest.asOf !== packet.asOf || manifest.evidenceHash !== evidenceHash) return fallback("stale", "Market AI manifest không còn khớp snapshot hiện tại.")
  const evidenceIds = new Set<string>((result.data.conclusion_payload?.citations || []).map((item: { factId?: string }) => item.factId).filter(Boolean))
  return { status: result.data.status as MarketAiConclusionView["status"], payload: result.data.status === "succeeded" ? result.data.conclusion_payload as MarketAiConclusionPayload : null, evidence: packet.facts.filter((item) => evidenceIds.has(item.id)), asOf: packet.asOf, evidenceHash, message: result.data.status === "succeeded" ? "AI conclusion đã đối chiếu evidence hash." : "AI conclusion chưa ở trạng thái thành công; dùng tổng hợp định lượng." }
}
