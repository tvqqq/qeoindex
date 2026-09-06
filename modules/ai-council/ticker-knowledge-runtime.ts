import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  freezeCouncilTickerKnowledge,
  type CouncilTickerKnowledgeSnapshotClient,
  type FrozenCouncilTickerKnowledge,
} from "@/modules/ai-council/ticker-knowledge-context"
import { getResearchOverviewData } from "@/modules/research/data"
import { buildTickerContext } from "@/modules/ticker-knowledge/context"
import type { TickerKnowledgeIndex, TickerKnowledgeItem } from "@/modules/ticker-knowledge/domain"
import { projectCurrentThesisKnowledge } from "@/modules/ticker-knowledge/projections"
import { createServerTickerKnowledgeIndex } from "@/modules/ticker-knowledge/server"

const CONTEXT_QUERY_VERSION = "ai-council-ticker-knowledge-query-v1" as const

function enabled() {
  return process.env.AI_COUNCIL_TICKER_KNOWLEDGE_ENABLED?.trim().toLowerCase() === "true"
}

function endOfVietnamDate(date: string) {
  const parsed = new Date(`${date}T23:59:59.999+07:00`)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : date
}

function itemIsAvailableAsOf(item: TickerKnowledgeItem, asOf: string) {
  const itemAsOf = item.provenance.asOf ?? item.provenance.publishedAt
  if (!itemAsOf) return true
  const itemMs = new Date(itemAsOf).getTime()
  const asOfMs = new Date(asOf).getTime()
  if (!Number.isFinite(itemMs) || !Number.isFinite(asOfMs)) return false
  return itemMs <= asOfMs
}

function contextQuery(ticker: string) {
  return `${CONTEXT_QUERY_VERSION} ${ticker} current thesis historical Council decisions outcomes risks catalysts research views contradictions and reusable lessons`
}

function asSnapshotClient(supabase: SupabaseClient): CouncilTickerKnowledgeSnapshotClient {
  // Keep Supabase's generated recursive query-builder generics outside the immutable snapshot boundary.
  // Runtime methods used here are intentionally limited to the narrow interface above.
  return supabase as unknown as CouncilTickerKnowledgeSnapshotClient
}

export interface AiCouncilTickerKnowledgeRuntime {
  enabled: boolean
  freeze(
    supabase: SupabaseClient,
    input: { runId: string; ticker: string; asOfDate: string },
  ): Promise<FrozenCouncilTickerKnowledge | null>
}

export function createAiCouncilTickerKnowledgeRuntime(): AiCouncilTickerKnowledgeRuntime {
  const isEnabled = enabled()
  let index: TickerKnowledgeIndex | null = null
  let thesisPromise: ReturnType<typeof getResearchOverviewData> | null = null

  const getIndex = () => {
    index ??= createServerTickerKnowledgeIndex()
    return index
  }

  const currentThesis = async (ticker: string, asOf: string): Promise<TickerKnowledgeItem[]> => {
    try {
      thesisPromise ??= getResearchOverviewData()
      const data = await thesisPromise
      const thesis = data.theses.find((row) => row.ticker === ticker.trim().toUpperCase())
      if (!thesis) return []
      const projected = projectCurrentThesisKnowledge(thesis)
      if (projected.knowledgeType !== "CURRENT_THESIS") return []
      return itemIsAvailableAsOf(projected, asOf) ? [projected] : []
    } catch {
      // Current thesis is mandatory when available, but a Notion outage must not fabricate
      // canonical thesis. Other frozen semantic history can still be retrieved and audited.
      return []
    }
  }

  return {
    enabled: isEnabled,
    async freeze(supabase, input) {
      if (!isEnabled) return null
      const asOf = endOfVietnamDate(input.asOfDate)
      const query = contextQuery(input.ticker)
      return freezeCouncilTickerKnowledge(asSnapshotClient(supabase), {
        runId: input.runId,
        ticker: input.ticker,
        asOfDate: input.asOfDate,
        query,
      }, {
        buildContext: async () => buildTickerContext({
          index: getIndex(),
          ticker: input.ticker,
          query,
          consumer: "AI_COUNCIL",
          mandatory: await currentThesis(input.ticker, asOf),
          // QEO-86 keeps exact report-evidence selection as a separate first-class layer.
          // Unified retrieval may add bounded report summaries/views but never raw report chunks.
          knowledgeTypes: ["COUNCIL_MEMORY", "COUNCIL_OUTCOME", "REPORT_SUMMARY", "BROKER_VIEW"],
          asOf,
          now: asOf,
        }),
      })
    },
  }
}
