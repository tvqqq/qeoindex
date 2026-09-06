import "server-only"

import { getResearchDataFresh } from "@/modules/research/data"

import { createServerTickerKnowledgeIndex } from "./server.ts"
import { rebuildCurrentThesisKnowledge, type CurrentThesisRebuildResult } from "./notion-sync.ts"

export async function rebuildCurrentThesisKnowledgeFromCanonicalNotion(params: {
  maxTheses?: number
  tickers?: readonly string[]
} = {}): Promise<CurrentThesisRebuildResult> {
  const data = await getResearchDataFresh()
  if (!data.connection.notionLive) {
    throw new Error("Canonical Notion Stock Thesis is unavailable; existing ticker knowledge projections were left unchanged")
  }

  const index = createServerTickerKnowledgeIndex()
  return rebuildCurrentThesisKnowledge({
    index,
    loadCanonicalTheses: async () => data.theses,
    maxTheses: params.maxTheses,
    tickers: params.tickers,
  })
}
