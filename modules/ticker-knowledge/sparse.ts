import { createHash } from "node:crypto"

export const TICKER_KNOWLEDGE_SPARSE_ENCODER = "qeo-financial-lexical-hash" as const
export const TICKER_KNOWLEDGE_SPARSE_VERSION = "qeo-financial-lexical-hash-v1" as const

export interface TickerKnowledgeSparseVector {
  indices: number[]
  values: number[]
}

function normalizeLexicalText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?<=\d)[,](?=\d{3}(?:\D|$))/g, "")
}

function tokens(value: string) {
  return normalizeLexicalText(value).match(/[\p{L}\p{N}]+(?:\.\d+)?/gu) ?? []
}

function tokenIndex(token: string) {
  return createHash("sha256").update(token).digest().readUInt32BE(0) & 0x7fffffff
}

export function encodeTickerKnowledgeSparse(text: string): TickerKnowledgeSparseVector {
  const frequencies = new Map<number, number>()
  for (const token of tokens(text)) {
    const index = tokenIndex(token)
    frequencies.set(index, (frequencies.get(index) ?? 0) + 1)
  }

  const entries = [...frequencies.entries()].sort(([a], [b]) => a - b)
  return {
    indices: entries.map(([index]) => index),
    values: entries.map(([, frequency]) => 1 + Math.log(frequency)),
  }
}
