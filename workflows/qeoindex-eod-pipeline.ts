import { sleep } from "workflow"

import { runQeoIndexEodOrchestrator } from "@/modules/eod"

export async function qeoindexEodPipeline(startedAtIso: string) {
  "use workflow"
  return runQeoIndexEodOrchestrator(startedAtIso, { sleepUntil: sleep })
}
