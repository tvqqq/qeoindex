import "server-only"

import { createServerTickerKnowledgeIndex } from "./server.ts"
import { probeTickerKnowledgeReadiness } from "./production-acceptance.ts"

export function probeServerTickerKnowledgeProductionHealth(input: {
  ticker?: string
  queryText?: string
} = {}) {
  return probeTickerKnowledgeReadiness({
    index: createServerTickerKnowledgeIndex(),
    ticker: input.ticker,
    queryText: input.queryText,
  })
}
