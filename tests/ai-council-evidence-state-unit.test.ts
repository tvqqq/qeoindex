import assert from "node:assert/strict"
import test from "node:test"

import {
  validateCouncilEvidenceRefs,
  type AiCouncilEvidencePacketV2,
} from "../lib/ai-council-prompt-evidence.ts"

const packet = {
  observedIndicators: {
    kfsp_stock_rrg_state: {
      value: "Dẫn dắt",
      unit: "state",
      asOf: "2026-09-03",
    },
  },
  missingIndicators: [],
} as unknown as AiCouncilEvidencePacketV2

test("state evidence accepts its own canonical display unit", () => {
  const result = validateCouncilEvidenceRefs("bull", [{
    metricKey: "kfsp_stock_rrg_state",
    observedValue: "Dẫn dắt state",
    asOf: "2026-09-03",
    interpretation: "RRG cổ phiếu đang ở trạng thái dẫn dắt.",
  }], packet)

  assert.deepEqual(result, { valid: true, errors: [] })
})

test("state evidence still rejects unrelated labels", () => {
  const result = validateCouncilEvidenceRefs("bull", [{
    metricKey: "kfsp_stock_rrg_state",
    observedValue: "Dẫn dắt quadrant",
    asOf: "2026-09-03",
    interpretation: "RRG cổ phiếu đang ở trạng thái dẫn dắt.",
  }], packet)

  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes("does not match observed")))
})
