import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  freezeCouncilTickerKnowledge,
  type CouncilTickerKnowledgeSnapshotClient,
  type FrozenCouncilTickerKnowledge,
} from "@/modules/ai-council/ticker-knowledge-context"
import { buildTickerContext } from "@/modules/ticker-knowledge/context"
import type { TickerKnowledgeIndex } from "@/modules/ticker-knowledge/domain"
import { createServerTickerKnowledgeIndex } from "@/modules/ticker-knowledge/server"

const CONTEXT_QUERY_VERSION = "ai-council-ticker-knowledge-query-v2" as const

function enabled() {
  return process.env.AI_COUNCIL_TICKER_KNOWLEDGE_ENABLED?.trim().toLowerCase() === "true"
}

function endOfVietnamDate(date: string) {
  const parsed = new Date(`${date}T23:59:59.999+07:00`)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : date
}

function contextQuery(ticker: string) {
  return `${CONTEXT_QUERY_VERSION} ${ticker} historical Council decisions outcomes risks catalysts research views contradictions and reusable lessons`
}

function asSnapshotClient(supabase: SupabaseClient): CouncilTickerKnowledgeSnapshotClient {
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

  const getIndex = () => {
    index ??= createServerTickerKnowledgeIndex()
    return index
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
